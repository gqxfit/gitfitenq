import http from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, timingSafeEqual, scryptSync, randomBytes, randomUUID } from 'node:crypto';
import { validateEnquiry,validateProduct,publicProduct } from './lib/validation.mjs';
import { services } from './public/schema.js';
import { createStore } from './lib/store.mjs';
import { createSender, createWorker } from './lib/whatsapp.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
export function equal(a,b) { const x=Buffer.from(String(a)),y=Buffer.from(String(b)); return x.length===y.length && timingSafeEqual(x,y); }
export function createApp(env=process.env,{store=createStore(env.DB_PATH||'./data/gqx.db'),sender=createSender(env)}={}) {
  const origin=new URL(env.PUBLIC_URL||env.RENDER_EXTERNAL_URL||'http://localhost:3000').origin;
  if(!env.SESSION_SECRET || env.SESSION_SECRET.length<32 || !env.CRON_SECRET || env.CRON_SECRET.length<32 || !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(env.ADMIN_PASSWORD_HASH||'')) throw new Error('Configure ADMIN_PASSWORD_HASH and independent SESSION_SECRET / CRON_SECRET (32+ characters).');
  if(env.NODE_ENV==='production' && !origin.startsWith('https://')) throw new Error('Production requires HTTPS PUBLIC_URL');
  if(env.WHATSAPP_ENABLED==='true') {
    for(const k of ['WHATSAPP_TOKEN','WHATSAPP_PHONE_NUMBER_ID','WHATSAPP_OWNER_NUMBER','WHATSAPP_API_VERSION','WHATSAPP_TEMPLATE_NEW','WHATSAPP_TEMPLATE_REMINDER','META_APP_SECRET','WEBHOOK_VERIFY_TOKEN']) if(!env[k]) throw new Error(`Missing ${k}`);
    if(!/^v\d+\.\d+$/.test(env.WHATSAPP_API_VERSION)||!/^\d{7,15}$/.test(env.WHATSAPP_OWNER_NUMBER)||!/^\d+$/.test(env.WHATSAPP_PHONE_NUMBER_ID)) throw new Error('Invalid WhatsApp configuration');
  }
  const drain=createWorker(store,sender);
  if(env.WHATSAPP_ENABLED==='true') store.run("UPDATE jobs SET state='pending',attempts=0 WHERE state='blocked' AND lead_id IN (SELECT id FROM leads WHERE status!='Done')");
  const sign=s=>createHmac('sha256',env.SESSION_SECRET).update(s).digest('hex');
  const sessions=req=> {
    const token=/(?:^|;\s*)gqx=([^;]+)/.exec(req.headers.cookie||'')?.[1]||'';
    const [expires,nonce,sig]=token.split('.');
    return /^\d+$/.test(expires||'') && /^[a-f0-9]{32}$/.test(nonce||'') && Number(expires)>Date.now() && equal(sig||'',sign(`${expires}.${nonce}`));
  };
  async function body(req,raw=false) {
    let size=0; const chunks=[];
    for await(const chunk of req) {size+=chunk.length;if(size>65536) {const e=new Error('Request too large');e.status=413;throw e;}chunks.push(chunk);}
    const data=Buffer.concat(chunks);return raw?data:JSON.parse(data.toString()||'{}');
  }
  const server=http.createServer(async(req,res)=> {
    const security={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
    if(origin.startsWith('https://')) security['Strict-Transport-Security']='max-age=31536000';
    const reply=(status,data,type='application/json')=> {res.writeHead(status,{...security,'Content-Type':type});res.end(type==='application/json'?JSON.stringify(data):data);};
    try {
      const url=new URL(req.url,origin),path=url.pathname;
      if(req.method==='GET' && path==='/health') return reply(200,{ok:true});
      if(req.method==='GET' && path==='/api/products') return reply(200,{products:store.all('SELECT * FROM products WHERE active=1 ORDER BY created_at DESC,id').map(publicProduct)});
      if(path==='/webhooks/whatsapp') {
        if(req.method==='GET') return env.WEBHOOK_VERIFY_TOKEN && url.searchParams.get('hub.mode')==='subscribe' && equal(url.searchParams.get('hub.verify_token')||'',env.WEBHOOK_VERIFY_TOKEN)?reply(200,url.searchParams.get('hub.challenge')||'','text/plain'):reply(403,{error:'Verification failed'});
        if(req.method==='POST') {
          const raw=await body(req,true),expected='sha256='+createHmac('sha256',env.META_APP_SECRET||'').update(raw).digest('hex');
          if(!env.META_APP_SECRET||!equal(req.headers['x-hub-signature-256']||'',expected)) return reply(401,{error:'Invalid signature'});
          store.webhook(JSON.parse(raw),env.WHATSAPP_OWNER_NUMBER,env.WHATSAPP_PHONE_NUMBER_ID);
          return reply(200,{ok:true});
        }
      }
      if(path==='/api/cron' && req.method==='POST') {
        if(!equal(req.headers.authorization||'',`Bearer ${env.CRON_SECRET}`)) return reply(401,{error:'Unauthorized'});
        return reply(200,await drain());
      }
      if(req.method!=='GET' && req.method!=='HEAD') {
        if(req.headers.origin!==origin) return reply(403,{error:'Invalid origin'});
        if(!(req.headers['content-type']||'').startsWith('application/json')) return reply(415,{error:'Use JSON'});
      }
      // Trust the socket address only. Reverse proxies must enforce public IP rate limits separately.
      const ip=req.socket.remoteAddress||'unknown';
      if(path==='/api/login' && req.method==='POST') {
        if(!store.allow('login:'+ip,10,15*60000)) return reply(429,{error:'Too many attempts. Try later.'});
        const input=await body(req),[salt,hash]=env.ADMIN_PASSWORD_HASH.split(':');
        const password=typeof input.password==='string'?input.password:'';
        if(password.length>512 || !equal(scryptSync(password,salt,64).toString('hex'),hash)) return reply(401,{error:'Incorrect password'});
        const value=`${Date.now()+8*3600000}.${randomBytes(16).toString('hex')}`;
        res.setHeader('Set-Cookie',`gqx=${value}.${sign(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${origin.startsWith('https://')?'; Secure':''}`);
        return reply(200,{ok:true});
      }
      if(path==='/api/logout' && req.method==='POST') {res.setHeader('Set-Cookie','gqx=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return reply(200,{ok:true});}
      if(path==='/api/enquiries' && req.method==='POST') {
        if(!store.allow('form:'+ip,10,3600000)) return reply(429,{error:'Too many enquiries. Please try later.'});
        const input=await body(req);
        if(input.website) return reply(200,{ok:true});
        let data;try{data=validateEnquiry(input,store);}catch(e){return reply(400,{error:e.message});}
        const lead=store.addLead(data);
        reply(201,{id:lead.id}); void drain().catch(()=>console.error('Worker failed; inspect dashboard.')); return;
      }
      if(path.startsWith('/api/admin/')) {
        if(!sessions(req)) return reply(401,{error:'Please sign in'});
        if(path==='/api/admin/products' && req.method==='GET') return reply(200,{products:store.all('SELECT * FROM products ORDER BY created_at DESC,id').map(publicProduct)});
        const productMatch=/^\/api\/admin\/products\/([a-f0-9-]{36})$/.exec(path);
        if((path==='/api/admin/products'&&req.method==='POST')||(productMatch&&req.method==='PUT')) {
          let p;try{p=validateProduct(await body(req));}catch(e){return reply(400,{error:e.message});}
          const id=productMatch?.[1]||randomUUID(),now=Date.now();
          if(productMatch&&!store.get('SELECT id FROM products WHERE id=?',id))return reply(404,{error:'Product not found'});
          const args=[p.name,p.description,p.sku,p.image_url,p.price_paise,p.discount_percent,JSON.stringify(p.sizes),JSON.stringify(p.colors),p.availability,p.active?1:0];
          if(productMatch)store.run('UPDATE products SET name=?,description=?,sku=?,image_url=?,price_paise=?,discount_percent=?,sizes_json=?,colors_json=?,availability=?,active=?,updated_at=? WHERE id=?',...args,now,id);
          else store.run('INSERT INTO products(name,description,sku,image_url,price_paise,discount_percent,sizes_json,colors_json,availability,active,created_at,updated_at,id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',...args,now,now,id);
          return reply(productMatch?200:201,{product:publicProduct(store.get('SELECT * FROM products WHERE id=?',id))});
        }
        if(path==='/api/admin/leads' && req.method==='GET') {
          const page=Math.max(0,Math.min(100000,Number(url.searchParams.get('page'))||0));
          const filter=url.searchParams.get('status')||'',q=(url.searchParams.get('q')||'').slice(0,100);
          if(filter && !['New','Contacted','Done'].includes(filter)) return reply(400,{error:'Invalid filter'});
          const service=url.searchParams.get('service')||'';
          if(service&&!Object.hasOwn(services,service))return reply(400,{error:'Invalid service'});
          const where=" WHERE (?='' OR status=?) AND (?='' OR instr(lower(name||' '||phone||' '||message||' '||details_json||' '||admin_notes),lower(?))>0) AND (?='' OR service=?)",args=[filter,filter,q,q,service,service];
          return reply(200,{leads:store.all('SELECT * FROM leads'+where+' ORDER BY created_at DESC LIMIT 50 OFFSET ?',...args,page*50),total:store.get('SELECT count(*) n FROM leads'+where,...args).n,counts:store.all('SELECT status,count(*) count FROM leads GROUP BY status'),whatsappEnabled:env.WHATSAPP_ENABLED==='true'});
        }
        const notes=/^\/api\/admin\/leads\/([a-f0-9-]{36})\/notes$/.exec(path);
        if(notes&&req.method==='PATCH') {const input=await body(req);if(typeof input.notes!=='string'||input.notes.length>5000)return reply(400,{error:'Notes must be at most 5000 characters'});const r=store.run('UPDATE leads SET admin_notes=? WHERE id=?',input.notes,notes[1]);return reply(r.changes?200:404,{ok:!!r.changes});}
        const match=/^\/api\/admin\/leads\/([a-f0-9-]{36})(\/attempts)?$/.exec(path);
        if(match && req.method==='GET' && match[2]) return reply(200,{jobs:store.all('SELECT * FROM jobs WHERE lead_id=?',match[1]),attempts:store.all('SELECT a.*,j.kind FROM attempts a JOIN jobs j ON j.id=a.job_id WHERE j.lead_id=? ORDER BY a.id DESC',match[1]),delivery:store.all('SELECT d.* FROM delivery_events d JOIN attempts a ON a.provider_id=d.provider_id JOIN jobs j ON j.id=a.job_id WHERE j.lead_id=? ORDER BY d.event_at DESC',match[1])});
        if(match && !match[2] && req.method==='PATCH') {const input=await body(req);if(!['New','Contacted','Done'].includes(input.status)) return reply(400,{error:'Invalid status'});return reply(store.setStatus(match[1],input.status)?200:404,{ok:true});}
      }
      const files={'/':'index.html','/admin':'admin.html','/app.js':'app.js','/admin.js':'admin.js','/schema.js':'schema.js','/products-admin.js':'products-admin.js','/style.css':'style.css','/fit.css':'fit.css'};
      if(req.method==='GET' && files[path]) return reply(200,readFileSync(resolve(root,'public',files[path])),path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html; charset=utf-8');
      reply(404,{error:'Not found'});
    } catch(e) {reply(e.status||400,{error:e.status===413?'Request too large':'Request could not be processed'});}
  });
  server.requestTimeout=30000;server.headersTimeout=10000;
  return {server,store,drain};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const {server,drain}=createApp();
  server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('GQX server ready'));
  let timer;
  if(process.env.INTERNAL_SCHEDULER!=='false') {void drain();timer=setInterval(()=>void drain().catch(()=>console.error('Scheduled worker failed')),60000);}
  const stop=()=>{clearInterval(timer);server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),20000).unref();};
  process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
