import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac,scryptSync } from 'node:crypto';
import { createStore,DAY } from '../lib/store.mjs';
import { createWorker,createSender } from '../lib/whatsapp.mjs';
import { createApp } from '../server.mjs';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routeFetch } from './transport.mjs';
const input={name:'Test <script>',phone:'+919876543210',email:'',service:'Other',message:'A test project',details:{city:'Bengaluru',contactPreference:'WhatsApp',interest:'General fitness question'}};
test('seven-day threshold, single claim, completion and reopen do not repeat',()=>{
  const s=createStore(':memory:'),now=1000,l=s.addLead(input,now);
  const first=s.claim(now);assert.equal(first.kind,'new');assert.equal(s.claim(now),null);
  s.finish(first,{outcome:'accepted',providerId:'new-1'},now);
  assert.equal(s.claim(now+7*DAY-1),null);
  const reminder=s.claim(now+7*DAY);assert.equal(reminder.kind,'reminder');s.finish(reminder,{outcome:'accepted',providerId:'reminder-1'},now);
  assert.equal(s.claim(now+9*DAY),null);s.setStatus(l.id,'Done');s.setStatus(l.id,'New');assert.equal(s.claim(now+10*DAY),null);s.db.close();
});
test('Done cancels pending jobs and webhook only closes authenticated owner references',()=>{
  const s=createStore(':memory:'),l=s.addLead(input),first=s.claim();s.finish(first,{outcome:'accepted',providerId:'wamid.1'});
  const payload=(from,text,context)=>({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'123'},messages:[{id:Math.random().toString(),from,text:{body:text},context:{id:context}}]}}]}]});
  s.webhook(payload('bad','done '+l.id),'owner','123');assert.equal(s.get('SELECT status FROM leads WHERE id=?',l.id).status,'New');
  s.webhook(payload('owner','hello','wamid.1'),'owner','123');assert.equal(s.get('SELECT status FROM leads WHERE id=?',l.id).status,'New');
  s.webhook(payload('owner','done','wamid.1'),'owner','123');assert.equal(s.get('SELECT status FROM leads WHERE id=?',l.id).status,'Done');assert.equal(s.claim(Date.now()+8*DAY),null);s.db.close();
});
test('closure before first send cancels both jobs',()=>{const s=createStore(':memory:'),l=s.addLead(input);s.setStatus(l.id,'Done');s.setStatus(l.id,'Contacted');assert.equal(s.claim(Date.now()+8*DAY),null);s.db.close();});
test('explicit rejections retry with backoff; ambiguity never automatically retries',async()=>{
  const s=createStore(':memory:');s.addLead(input);let calls=0;
  const worker=createWorker(s,async()=>{calls++;return {outcome:'unknown',errorCode:'timeout'};});
  await Promise.all([worker(),worker()]);assert.equal(calls,1);assert.equal(s.get("SELECT state FROM jobs WHERE kind='new'").state,'unknown');assert.equal(s.claim(Date.now()+DAY),null);
  const job=s.claim(Date.now()+8*DAY);s.finish(job,{outcome:'retry'},Date.now());assert.equal(s.claim(),null);assert.equal(s.claim(Date.now()+3600000).attempts,2);s.db.close();
});
test('Meta payload uses approved template parameters; network error is unknown',async()=>{
  const env={WHATSAPP_ENABLED:'true',WHATSAPP_API_VERSION:'v99.0',WHATSAPP_PHONE_NUMBER_ID:'123',WHATSAPP_OWNER_NUMBER:'919876543210',WHATSAPP_TEMPLATE_NEW:'new'};
  const send=createSender(env,async(url,init)=>{assert.ok(url.includes('/v99.0/123/messages'));const b=JSON.parse(init.body);assert.equal(b.template.components[0].parameters.length,4);return {ok:true,status:200,json:async()=>({messages:[{id:'wamid.x'}]})};});
  assert.equal((await send({kind:'new',lead_id:'id',...input})).outcome,'accepted');
  assert.equal((await createSender(env,async()=>{throw Error();})({kind:'new',...input})).outcome,'unknown');
});
test('disk persistence and crash recovery preserve leads without resending uncertain jobs',()=>{
  const dir=mkdtempSync(join(tmpdir(),'gqx-test-')),path=join(dir,'test.db');
  try {
    const s=createStore(path),lead=s.addLead(input,1000);s.claim(1000);s.db.close();
    const reopened=createStore(path);assert.equal(reopened.get('SELECT name FROM leads WHERE id=?',lead.id).name,input.name);assert.equal(reopened.get("SELECT state FROM jobs WHERE kind='new'").state,'unknown');assert.equal(reopened.get('SELECT outcome FROM attempts').outcome,'unknown');assert.equal(reopened.claim(2000),null);reopened.db.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('rate-limit retries stop after five attempts and disabled jobs stay blocked',()=>{
  const s=createStore(':memory:');s.addLead(input,1000);
  for(let i=1;i<=5;i++){const t=1000+i*3600000,j=s.claim(t);assert.equal(j.attempts,i);s.finish(j,{outcome:'retry'},t);}
  assert.equal(s.get("SELECT state FROM jobs WHERE kind='new'").state,'failed');assert.equal(s.claim(DAY),null);
  const reminder=s.claim(8*DAY);s.finish(reminder,{outcome:'blocked'},8*DAY);assert.equal(s.claim(9*DAY),null);s.db.close();
});
test('HTTP authentication, origin protection, signed webhooks and durable submission',async()=>{
  const salt='a'.repeat(32),password='a long test password';
  const env={PUBLIC_URL:'http://localhost:3000',SESSION_SECRET:'s'.repeat(40),CRON_SECRET:'c'.repeat(40),ADMIN_PASSWORD_HASH:salt+':'+scryptSync(password,salt,64).toString('hex'),META_APP_SECRET:'meta',WEBHOOK_VERIFY_TOKEN:'verify',WHATSAPP_OWNER_NUMBER:'owner',WHATSAPP_PHONE_NUMBER_ID:'123'};
  const store=createStore(':memory:'),app=createApp(env,{store,sender:async()=>({outcome:'accepted',providerId:'wamid.test'})});
  const inProcess=process.env.GQX_TEST_IN_PROCESS==='true';
  if(!inProcess)await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base=inProcess?'http://localhost:3000':`http://127.0.0.1:${app.server.address().port}`,fetch=inProcess?routeFetch(app.server):globalThis.fetch;
  const json={'Content-Type':'application/json',Origin:env.PUBLIC_URL};
  try {
    assert.equal((await fetch(base+'/api/admin/leads')).status,401);
    assert.equal((await fetch(base+'/api/enquiries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,consent:true})})).status,403);
    const r=await fetch(base+'/api/enquiries',{method:'POST',headers:json,body:JSON.stringify({...input,consent:true})});assert.equal(r.status,201);const {id}=await r.json();
    const login=await fetch(base+'/api/login',{method:'POST',headers:json,body:JSON.stringify({password})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];assert.ok(login.headers.get('set-cookie').includes('HttpOnly'));
    const list=await fetch(base+'/api/admin/leads',{headers:{Cookie:cookie}});assert.equal((await list.json()).total,1);
    const p={name:'GQX Fit tee',description:'Training tee',sku:'GQX01',image_url:'',price:1000,discount_percent:20,sizes:['M','L'],colors:['Black'],availability:'Available',active:false};
    const createProduct=payload=>fetch(base+'/api/admin/products',{method:'POST',headers:{...json,Cookie:cookie},body:JSON.stringify(payload)});
    assert.equal((await fetch(base+'/api/admin/products',{method:'POST',headers:json,body:JSON.stringify(p)})).status,401);
    const created=await createProduct(p);assert.equal(created.status,201);const product=(await created.json()).product;
    assert.equal((await (await fetch(base+'/api/products')).json()).products.length,0);
    assert.equal((await fetch(base+'/api/admin/products/'+product.id,{method:'PUT',headers:{...json,Cookie:cookie},body:JSON.stringify({...p,active:true})})).status,200);
    const catalog=(await (await fetch(base+'/api/products')).json()).products;assert.equal(catalog.length,1);assert.equal(catalog[0].sale_paise,80000);
    const clothing=await fetch(base+'/api/enquiries',{method:'POST',headers:json,body:JSON.stringify({...input,service:'GQX Fit clothing',consent:true,details:{city:'Bengaluru',contactPreference:'WhatsApp',productId:product.id,size:'M',color:'Black',quantity:'2',pincode:'560001',total:1}})});assert.equal(clothing.status,201);const clothingId=(await clothing.json()).id;
    const filtered=await fetch(base+'/api/admin/leads?service=GQX%20Fit%20clothing',{headers:{Cookie:cookie}}),filteredData=await filtered.json();assert.equal(filteredData.total,1);assert.equal(JSON.parse(filteredData.leads[0].details_json).product.total_paise,160000);
    assert.equal((await fetch(base+`/api/admin/leads/${clothingId}/notes`,{method:'PATCH',headers:{...json,Cookie:cookie},body:JSON.stringify({notes:'Call about size'})})).status,200);
    assert.equal(store.get('SELECT admin_notes FROM leads WHERE id=?',clothingId).admin_notes,'Call about size');
    assert.equal((await createProduct({...p,discount_percent:101})).status,400);
    assert.equal((await fetch(base+'/api/cron',{method:'POST'})).status,401);
    const raw=JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'123'},messages:[{id:'inbound-1',from:'owner',text:{body:'done '+id}}]}}]}]});
    assert.equal((await fetch(base+'/webhooks/whatsapp',{method:'POST',body:raw})).status,401);
    const signed=await fetch(base+'/webhooks/whatsapp',{method:'POST',body:raw,headers:{'x-hub-signature-256':'sha256='+createHmac('sha256','meta').update(raw).digest('hex')}});assert.equal(signed.status,200);assert.equal(store.get('SELECT status FROM leads WHERE id=?',id).status,'Done');
    assert.equal((await fetch(base+'/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=hello')).status,200);
  } finally {if(!inProcess)await new Promise(r=>app.server.close(r));store.db.close();}
});
