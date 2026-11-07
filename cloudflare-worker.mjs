import { schema } from './cloudflare-schema.mjs';
import { assets } from './cloudflare-assets.mjs';
import { services } from './public/schema.js';
import { validateProduct,validateEnquiry,publicProduct } from './lib/validation.mjs';
import { createSender } from './lib/whatsapp.mjs';
const encoder=new TextEncoder(),DAY=86400000,ready=new WeakMap();
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
export async function digest(s){return hex(await crypto.subtle.digest('SHA-256',encoder.encode(s)));}
export function equal(a,b){if(typeof a!=='string'||typeof b!=='string')return false;let n=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)n|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return n===0;}
async function hmac(secret,data){const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',key,data));}
export class D1Store {
  constructor(db){this.db=db;}
  statement(sql,...values){return this.db.prepare(sql).bind(...values);}
  async get(sql,...values){return this.statement(sql,...values).first();}
  async all(sql,...values){return (await this.statement(sql,...values).all()).results;}
  async run(sql,...values){return this.statement(sql,...values).run();}
  async batch(statements){return this.db.batch(statements.map(([sql,...values])=>this.statement(sql,...values)));}
  async allow(key,max,windowMs,now=Date.now()){
    const row=await this.get(`INSERT INTO limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING count`,key,now+windowMs,now,now);
    return row.count<=max;
  }
  async addLead(data,now=Date.now()){
    const id=crypto.randomUUID();
    await this.batch([
      ['INSERT INTO leads(id,name,phone,email,service,message,created_at,details_json) VALUES(?,?,?,?,?,?,?,?)',id,data.name,data.phone,data.email,data.service,data.message,now,JSON.stringify(data.details)],
      ['INSERT INTO jobs(lead_id,kind,due_at) VALUES(?,?,?)',id,'new',now],
      ['INSERT INTO jobs(lead_id,kind,due_at) VALUES(?,?,?)',id,'reminder',now+7*DAY]
    ]);return {id};
  }
  async setStatus(id,status,reason='dashboard',now=Date.now()){
    const statements=[['UPDATE leads SET status=?,closed_at=?,closure_reason=? WHERE id=?',status,status==='Done'?now:null,status==='Done'?reason:null,id]];
    if(status==='Done')statements.push(["UPDATE jobs SET state='cancelled' WHERE lead_id=? AND state IN ('pending','retry','blocked','failed','unknown')",id]);
    const result=await this.batch(statements);return !!result[0].meta.changes;
  }
  async claim(now=Date.now()){
    const token=crypto.randomUUID();
    // Claim and attempt log are in the same D1 transaction. Concurrent isolates
    // cannot claim the same pending job. The token also protects completion writes.
    const results=await this.batch([
      ["UPDATE jobs SET state='sending',claim_token=?,claimed_at=?,attempts=attempts+1 WHERE id=(SELECT j.id FROM jobs j JOIN leads l ON l.id=j.lead_id WHERE j.state IN ('pending','retry') AND j.due_at<=? AND l.status!='Done' ORDER BY j.due_at,j.id LIMIT 1) RETURNING *",token,now,now],
      ["INSERT INTO attempts(job_id,started_at,outcome,claim_token) SELECT id,?,'sending',? FROM jobs WHERE claim_token=?",now,token,token]
    ]);
    const job=results[0].results[0];if(!job)return null;
    const lead=await this.get('SELECT name,phone,service,message,status FROM leads WHERE id=?',job.lead_id);
    return {...job,...lead};
  }
  async finish(job,result,now=Date.now()){
    const state=result.outcome==='accepted'?'sent':result.outcome==='blocked'?'blocked':result.outcome==='retry'&&job.attempts<5?'retry':result.outcome==='unknown'?'unknown':'failed';
    await this.batch([
      ['UPDATE attempts SET outcome=?,provider_id=?,http_status=?,error_code=? WHERE claim_token=?',result.outcome,result.providerId||null,result.httpStatus||null,result.errorCode||null,job.claim_token],
      ["UPDATE jobs SET state=CASE WHEN ? IN ('retry','blocked') AND EXISTS(SELECT 1 FROM leads WHERE id=lead_id AND status='Done') THEN 'cancelled' ELSE ? END,due_at=? WHERE id=? AND claim_token=? AND state='sending'",state,state,now+Math.min(3600000,60000*2**job.attempts),job.id,job.claim_token]
    ]);
  }
  async recover(now=Date.now(),enabled=false){
    const statements=[
      ["UPDATE attempts SET outcome='unknown',error_code='worker_interrupted' WHERE outcome='sending' AND started_at<?",now-120000],
      ["UPDATE jobs SET state='unknown' WHERE state='sending' AND claimed_at<?",now-120000],
      ["UPDATE jobs SET state='cancelled' WHERE state IN ('pending','retry','blocked') AND lead_id IN (SELECT id FROM leads WHERE status='Done')"],
      ['DELETE FROM limits WHERE expires_at<?',now]
    ];
    if(enabled)statements.push(["UPDATE jobs SET state='pending',attempts=0 WHERE state='blocked' AND lead_id IN (SELECT id FROM leads WHERE status!='Done')"]);
    await this.batch(statements);
  }
  async webhook(payload,owner,phoneId,now=Date.now()){
    if(payload.object!=='whatsapp_business_account')return;
    const statements=[];
    for(const entry of payload.entry||[])for(const change of entry.changes||[]){
      const v=change.value;if(change.field!=='messages'||v?.metadata?.phone_number_id!==phoneId)continue;
      for(const s of v.statuses||[])if(typeof s.id==='string'&&['sent','delivered','read','failed'].includes(s.status)&&/^\d+$/.test(String(s.timestamp)))statements.push(['INSERT OR IGNORE INTO delivery_events VALUES(?,?,?,?)',s.id,s.status,Number(s.timestamp)*1000,String(s.errors?.[0]?.code||'')||null]);
      for(const m of v.messages||[]){
        if(m.from!==owner||typeof m.id!=='string')continue;
        const text=(m.text?.body||'').trim(),explicit=/^(?:done|resolved|replied)\s+([a-f0-9-]{36})$/i.exec(text);
        let id=explicit?.[1]?.toLowerCase();
        if(!id&&/^(done|resolved|replied)$/i.test(text)&&m.context?.id)id=(await this.get('SELECT j.lead_id FROM attempts a JOIN jobs j ON j.id=a.job_id WHERE a.provider_id=?',m.context.id))?.lead_id;
        const token=crypto.randomUUID();statements.push(['INSERT OR IGNORE INTO webhook_events VALUES(?,?,?)',m.id,now,token]);
        if(id){
          statements.push(["UPDATE leads SET status='Done',closed_at=?,closure_reason='owner_webhook' WHERE id=? AND EXISTS(SELECT 1 FROM webhook_events WHERE id=? AND token=?)",now,id,m.id,token]);
          statements.push(["UPDATE jobs SET state='cancelled' WHERE lead_id=? AND state IN ('pending','retry','blocked','failed','unknown') AND EXISTS(SELECT 1 FROM webhook_events WHERE id=? AND token=?)",id,m.id,token]);
        }
      }
    }
    // A batch is atomic. Bound webhook work to avoid unbounded resource use.
    if(statements.length>40)throw Error('Webhook batch too large');
    if(statements.length)await this.batch(statements);
  }
}
async function getStore(env){
  if(!env.DB)throw Error('Database binding missing');
  if(!ready.has(env.DB))ready.set(env.DB,env.DB.batch(schema.map(sql=>env.DB.prepare(sql))).catch(e=>{ready.delete(env.DB);throw e;}));
  await ready.get(env.DB);return new D1Store(env.DB);
}
export async function drain(store,env,limit=1){
  const send=createSender(env);let processed=0;
  while(processed<limit){const job=await store.claim();if(!job)break;
    // Close before claim, or before this final read, suppresses notification.
    if(job.status==='Done'){await store.batch([["UPDATE jobs SET state='cancelled' WHERE id=? AND claim_token=?",job.id,job.claim_token],["UPDATE attempts SET outcome='cancelled' WHERE claim_token=?",job.claim_token]]);continue;}
    await store.finish(job,await send(job));processed++;
  }return {processed};
}
const security={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Cache-Control':'no-store','Strict-Transport-Security':'max-age=31536000','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
function response(status,data,type='application/json',extra={}){return new Response(type==='application/json'?JSON.stringify(data):data,{status,headers:{...security,'Content-Type':type,...extra}});}
async function readBody(request,raw=false){
  if(Number(request.headers.get('content-length')||0)>65536)throw Error('Request too large');
  const reader=request.body?.getReader();let length=0;const chunks=[];
  if(reader)while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>65536){await reader.cancel();throw Error('Request too large');}chunks.push(value);}
  const all=new Uint8Array(length);let offset=0;for(const b of chunks){all.set(b,offset);offset+=b.length;}
  return raw?all:JSON.parse(new TextDecoder().decode(all)||'{}');
}
async function authenticated(request,env){
  if(!env.SESSION_SECRET||env.SESSION_SECRET.length<32)return false;
  const cookie=/(?:^|;\s*)gqx=([^;]+)/.exec(request.headers.get('cookie')||'')?.[1]||'',parts=cookie.split('.');
  if(parts.length!==3||!/^\d+$/.test(parts[0])||!/^[a-f0-9-]{36}$/.test(parts[1])||Number(parts[0])<=Date.now())return false;
  return equal(parts[2],await hmac(env.SESSION_SECRET,encoder.encode(parts[0]+'.'+parts[1])));
}
export async function handle(request,env,ctx={waitUntil:()=>{}}){
  const url=new URL(request.url),path=url.pathname,method=request.method;
  const file=assets[path];if(method==='GET'&&file)return response(200,file.body,file.type);
  try{
    const store=await getStore(env);
    if(method==='GET'&&path==='/health'){await store.get('SELECT 1 ok');return response(200,{ok:true});}
    if(path==='/webhooks/whatsapp'){
      if(method==='GET')return env.WEBHOOK_VERIFY_TOKEN&&url.searchParams.get('hub.mode')==='subscribe'&&equal(url.searchParams.get('hub.verify_token')||'',env.WEBHOOK_VERIFY_TOKEN)?response(200,url.searchParams.get('hub.challenge')||'','text/plain'):response(403,{error:'Verification failed'});
      if(method==='POST'){
        const raw=await readBody(request,true);if(!env.META_APP_SECRET||!equal(request.headers.get('x-hub-signature-256')||'','sha256='+await hmac(env.META_APP_SECRET,raw)))return response(401,{error:'Invalid signature'});
        await store.webhook(JSON.parse(new TextDecoder().decode(raw)),env.WHATSAPP_OWNER_NUMBER,env.WHATSAPP_PHONE_NUMBER_ID);return response(200,{ok:true});
      }
    }
    if(path==='/api/cron'&&method==='POST'){
      if(!env.CRON_SECRET||!equal(request.headers.get('authorization')||'','Bearer '+env.CRON_SECRET))return response(401,{error:'Unauthorized'});
      await store.recover(Date.now(),env.WHATSAPP_ENABLED==='true');return response(200,await drain(store,env));
    }
    if(!['GET','HEAD'].includes(method)){
      if(request.headers.get('origin')!==(env.PUBLIC_URL?new URL(env.PUBLIC_URL).origin:url.origin))return response(403,{error:'Invalid origin'});
      if(!(request.headers.get('content-type')||'').startsWith('application/json'))return response(415,{error:'Use JSON'});
    }
    const ip=await digest(request.headers.get('cf-connecting-ip')||'unknown');
    if(path==='/api/login'&&method==='POST'){
      if(!/^[a-f0-9]{64}$/.test(env.ADMIN_KEY_HASH||'')||!env.SESSION_SECRET||env.SESSION_SECRET.length<32)return response(503,{error:'Admin access needs configuration. Ask the owner to finish setup.'});
      if(!await store.allow('login:'+ip,10,900000))return response(429,{error:'Too many attempts. Try later.'});
      const input=await readBody(request);if(typeof input.password!=='string'||input.password.length<32||input.password.length>512||!equal(await digest(input.password),env.ADMIN_KEY_HASH))return response(401,{error:'Incorrect password'});
      const value=`${Date.now()+28800000}.${crypto.randomUUID()}`,signature=await hmac(env.SESSION_SECRET,encoder.encode(value));
      return response(200,{ok:true},'application/json',{'Set-Cookie':`gqx=${value}.${signature}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`});
    }
    if(path==='/api/logout'&&method==='POST')return response(200,{ok:true},'application/json',{'Set-Cookie':'gqx=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'});
    if(path==='/api/products'&&method==='GET')return response(200,{products:(await store.all('SELECT * FROM products WHERE active=1 ORDER BY created_at DESC,id')).map(publicProduct)});
    if(path==='/api/enquiries'&&method==='POST'){
      if(!await store.allow('form:'+ip,20,3600000))return response(429,{error:'Too many enquiries. Please try later.'});
      const input=await readBody(request);if(input.website)return response(200,{ok:true});
      // Fetch the authoritative product once, then reuse the existing synchronous validator.
      const product=typeof input.details?.productId==='string'?await store.get('SELECT * FROM products WHERE id=? AND active=1',input.details.productId):null;
      let data;try{data=validateEnquiry(input,{get:()=>product});}catch(e){return response(400,{error:e.message});}
      const lead=await store.addLead(data);
      // Durable outbox survives a cancelled waitUntil; the cron recovers stale sends.
      ctx.waitUntil(drain(store,env,1).catch(()=>{}));return response(201,lead);
    }
    if(path.startsWith('/api/admin/')){
      if(!await authenticated(request,env))return response(401,{error:'Please sign in'});
      if(path==='/api/admin/products'&&method==='GET')return response(200,{products:(await store.all('SELECT * FROM products ORDER BY created_at DESC,id')).map(publicProduct)});
      const pm=/^\/api\/admin\/products\/([a-f0-9-]{36})$/.exec(path);
      if((path==='/api/admin/products'&&method==='POST')||(pm&&method==='PUT')){
        let p;try{p=validateProduct(await readBody(request));}catch(e){return response(400,{error:e.message});}
        const id=pm?.[1]||crypto.randomUUID(),now=Date.now();if(pm&&!await store.get('SELECT id FROM products WHERE id=?',id))return response(404,{error:'Product not found'});
        const args=[p.name,p.description,p.sku,p.image_url,p.price_paise,p.discount_percent,JSON.stringify(p.sizes),JSON.stringify(p.colors),p.availability,p.active?1:0];
        if(pm)await store.run('UPDATE products SET name=?,description=?,sku=?,image_url=?,price_paise=?,discount_percent=?,sizes_json=?,colors_json=?,availability=?,active=?,updated_at=? WHERE id=?',...args,now,id);
        else await store.run('INSERT INTO products(name,description,sku,image_url,price_paise,discount_percent,sizes_json,colors_json,availability,active,created_at,updated_at,id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',...args,now,now,id);
        return response(pm?200:201,{product:publicProduct(await store.get('SELECT * FROM products WHERE id=?',id))});
      }
      if(path==='/api/admin/leads'&&method==='GET'){
        const page=Math.max(0,Math.min(100000,Math.floor(Number(url.searchParams.get('page'))||0))),status=url.searchParams.get('status')||'',q=(url.searchParams.get('q')||'').slice(0,100),service=url.searchParams.get('service')||'';
        if((status&&!['New','Contacted','Done'].includes(status))||(service&&!Object.hasOwn(services,service)))return response(400,{error:'Invalid filter'});
        const where=" WHERE (?='' OR status=?) AND (?='' OR instr(lower(name||' '||phone||' '||message||' '||details_json||' '||admin_notes),lower(?))>0) AND (?='' OR service=?)",args=[status,status,q,q,service,service];
        return response(200,{leads:await store.all('SELECT * FROM leads'+where+' ORDER BY created_at DESC LIMIT 50 OFFSET ?',...args,page*50),total:(await store.get('SELECT count(*) n FROM leads'+where,...args)).n,counts:await store.all('SELECT status,count(*) count FROM leads GROUP BY status'),whatsappEnabled:env.WHATSAPP_ENABLED==='true'});
      }
      const match=/^\/api\/admin\/leads\/([a-f0-9-]{36})(?:\/(notes|attempts))?$/.exec(path);
      if(match&&method==='GET'&&match[2]==='attempts')return response(200,{jobs:await store.all('SELECT id,lead_id,kind,state,due_at,attempts FROM jobs WHERE lead_id=?',match[1]),attempts:await store.all('SELECT a.id,a.job_id,a.started_at,a.outcome,a.provider_id,a.http_status,a.error_code,j.kind FROM attempts a JOIN jobs j ON j.id=a.job_id WHERE j.lead_id=? ORDER BY a.id DESC',match[1]),delivery:await store.all('SELECT d.* FROM delivery_events d JOIN attempts a ON a.provider_id=d.provider_id JOIN jobs j ON j.id=a.job_id WHERE j.lead_id=? ORDER BY d.event_at DESC',match[1])});
      if(match&&method==='PATCH'){
        const input=await readBody(request);
        if(match[2]==='notes'){if(typeof input.notes!=='string'||input.notes.length>5000)return response(400,{error:'Notes must be at most 5000 characters'});const r=await store.run('UPDATE leads SET admin_notes=? WHERE id=?',input.notes,match[1]);return response(r.meta.changes?200:404,{ok:!!r.meta.changes});}
        if(!match[2]){if(!['New','Contacted','Done'].includes(input.status))return response(400,{error:'Invalid status'});const ok=await store.setStatus(match[1],input.status);return response(ok?200:404,{ok});}
      }
    }return response(404,{error:'Not found'});
  }catch{return response(503,{error:'The service could not process this request. Please try again.'});}
}
export default {fetch:handle,async scheduled(event,env,ctx){const store=await getStore(env);await store.recover(Date.now(),env.WHATSAPP_ENABLED==='true');await drain(store,env,1);}};
