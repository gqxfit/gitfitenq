import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import worker,{D1Store,handle,digest,drain} from '../cloudflare-worker.mjs';
import {schema} from '../cloudflare-schema.mjs';
class MockD1 {
  constructor(){this.raw=new DatabaseSync(':memory:');}
  prepare(sql){const db=this;return {sql,values:[],bind(...values){return {...this,values};},async first(){return db.raw.prepare(this.sql).get(...this.values)||null;},async all(){return {results:db.raw.prepare(this.sql).all(...this.values)};},async run(){const r=db.raw.prepare(this.sql).run(...this.values);return {success:true,meta:{changes:Number(r.changes)}};}};}
  async batch(statements){this.raw.exec('BEGIN IMMEDIATE');try{const results=statements.map(s=>{const p=this.raw.prepare(s.sql);if(p.columns().length)return {success:true,results:p.all(...s.values),meta:{changes:1}};const r=p.run(...s.values);return {success:true,results:[],meta:{changes:Number(r.changes)}};});this.raw.exec('COMMIT');return results;}catch(e){this.raw.exec('ROLLBACK');throw e;}}
}
async function make(){const db=new MockD1();await db.batch(schema.map(sql=>db.prepare(sql)));return {db,s:new D1Store(db)};}
const data={name:'Cloud customer',phone:'+919876543210',email:'',service:'Other',message:'Hello',details:{city:'Chennai',contactPreference:'WhatsApp',interest:'Training'}};
test('D1 atomic outbox handles concurrent claims, due time and closure',async()=>{
  const {db,s}=await make(),now=Date.now();const lead=await s.addLead(data,now);const jobs=await Promise.all([s.claim(now),s.claim(now)]);assert.equal(jobs.filter(Boolean).length,1);await s.finish(jobs.find(Boolean),{outcome:'accepted',providerId:'wamid.1'},now);assert.equal(await s.claim(now+7*86400000-1),null);const reminder=await s.claim(now+7*86400000);assert.equal(reminder.kind,'reminder');await s.finish(reminder,{outcome:'accepted',providerId:'wamid.2'});assert.equal(await s.claim(now+9*86400000),null);await s.setStatus(lead.id,'Done');await s.setStatus(lead.id,'New');assert.equal(await s.claim(now+10*86400000),null);db.raw.close();
});
test('D1 interrupted sends are unknown; closed jobs and duplicate webhooks never rearm',async()=>{
  const {db,s}=await make(),now=Date.now(),lead=await s.addLead(data,now);await s.claim(now);await s.recover(now+121000);assert.equal((await s.get("SELECT state FROM jobs WHERE kind='new'")).state,'unknown');assert.equal((await s.get('SELECT outcome FROM attempts')).outcome,'unknown');
  const payload={object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'123'},messages:[{id:'event1',from:'owner',text:{body:'done '+lead.id}}]}}]}]};
  await s.webhook(payload,'owner','123');assert.equal((await s.get('SELECT status FROM leads WHERE id=?',lead.id)).status,'Done');await s.setStatus(lead.id,'New');await s.webhook(payload,'owner','123');assert.equal((await s.get('SELECT status FROM leads WHERE id=?',lead.id)).status,'New');assert.equal(await s.claim(now+8*86400000),null);db.raw.close();
});
test('D1 completion after concurrent Done does not leave retries or blocked jobs eligible',async()=>{
  const {db,s}=await make(),lead=await s.addLead(data),job=await s.claim();await s.setStatus(lead.id,'Done');await s.finish(job,{outcome:'retry'});assert.equal((await s.get('SELECT state FROM jobs WHERE id=?',job.id)).state,'cancelled');db.raw.close();
});
test('new enquiry can be notified immediately without being displaced by another queued lead',async()=>{
  const {db,s}=await make(),older=await s.addLead(data,Date.now()-1000),newer=await s.addLead(data);
  await drain(s,{WHATSAPP_ENABLED:'false'},1,newer.id);
  assert.equal((await s.get("SELECT state FROM jobs WHERE lead_id=? AND kind='new'",older.id)).state,'pending');
  assert.equal((await s.get("SELECT state FROM jobs WHERE lead_id=? AND kind='new'",newer.id)).state,'blocked');db.raw.close();
});
test('Cloudflare authentication, static routes, product creation and service details',async()=>{
  const {db}=await make(),key='a-random-test-login-key-at-least-32-characters',env={DB:db,ADMIN_KEY_HASH:await digest(key),SESSION_SECRET:'s'.repeat(64),CRON_SECRET:'c'.repeat(64)},origin='https://test.workers.dev';
  const call=(path,method='GET',value,headers={})=>handle(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1',...headers},...(value!==undefined?{body:JSON.stringify(value)}:{})}),env,{waitUntil:p=>p});
  try{
    assert.equal((await call('/')).status,200);assert.equal((await call('/health')).status,200);assert.equal((await call('/api/admin/leads')).status,401);assert.equal((await call('/api/login','POST',{password:'wrong'})).status,401);
    const login=await call('/api/login','POST',{password:key});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];assert.match(login.headers.get('set-cookie'),/Secure/);
    const p={name:'Test tee',description:'GQX Fit',sku:'TEE',image_url:'',price:999,discount_percent:10,sizes:['M'],colors:['Black'],availability:'Available',active:true};const created=await call('/api/admin/products','POST',p,{Cookie:cookie});assert.equal(created.status,201);const product=(await created.json()).product;assert.equal(product.sale_paise,89910);
    const lead=await call('/api/enquiries','POST',{...data,consent:true,service:'GQX Fit clothing',details:{...data.details,productId:product.id,size:'M',color:'Black',quantity:'2',pincode:'600001'}});assert.equal(lead.status,201);const id=(await lead.json()).id;
    const list=await (await call('/api/admin/leads','GET',undefined,{Cookie:cookie})).json();assert.equal(list.total,1);assert.equal(JSON.parse(list.leads[0].details_json).product.total_paise,179820);
    const close=await call('/api/admin/leads/'+id,'PATCH',{status:'Done'},{Cookie:cookie});assert.equal(close.status,200);
    assert.equal((await call('/api/cron','POST',{}, {Authorization:'Bearer '+env.CRON_SECRET})).status,200);
    assert.equal((await call('/api/admin/products','POST',p)).status,401);
  }finally{db.raw.close();}
});
test('Cloudflare login fails closed without secrets; rate limits use persistent counters',async()=>{
  const {db,s}=await make();assert.equal((await handle(new Request('https://test.workers.dev/api/login',{method:'POST',headers:{Origin:'https://test.workers.dev','Content-Type':'application/json'},body:'{}'}),{DB:db})).status,503);assert.equal(await s.allow('test',1,1000,1000),true);assert.equal(await s.allow('test',1,1000,1001),false);assert.equal(await s.allow('test',1,1000,2001),true);db.raw.close();
});
