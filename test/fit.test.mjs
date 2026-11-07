import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../lib/store.mjs';
import { validateProduct,validateEnquiry,publicProduct } from '../lib/validation.mjs';
import { services } from '../public/schema.js';
import { createApp } from '../server.mjs';
import { scryptSync } from 'node:crypto';
import { routeFetch } from './transport.mjs';
const common={name:'Customer',phone:'+919876543210',email:'',message:'',consent:true,details:{city:'Bengaluru',contactPreference:'WhatsApp'}};
export const productInput={name:'Training tee',description:'Lightweight',sku:'TEE-01',image_url:'https://example.com/tee.jpg',price:999.99,discount_percent:15,sizes:['S','M','L'],colors:['Black','Olive'],availability:'Available',active:true};
function insertProduct(s,input=productInput){const p=validateProduct(input);s.run('INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)','product-1',p.name,p.description,p.sku,p.image_url,p.price_paise,p.discount_percent,JSON.stringify(p.sizes),JSON.stringify(p.colors),p.availability,p.active?1:0,1000,1000);return publicProduct(s.get('SELECT * FROM products WHERE id=?','product-1'));}
test('all five GQX Fit services and Other validate their own required details',()=>{
  const s=createStore(':memory:');insertProduct(s);
  for(const [service,schema] of Object.entries(services)){
    const details={...common.details};
    for(const [key,,type,options,,required=true] of schema.fields){if(!required)continue;details[key]=type==='select'?options[0]:type==='number'?'12':type==='pincode'?'560001':'Test details';}
    if(service==='GQX Fit clothing')Object.assign(details,{productId:'product-1',size:'M',color:'Black',quantity:'2',pincode:'560001'});
    const data=validateEnquiry({...common,service,details},s),lead=s.addLead(data);assert.equal(lead.service,service);assert.equal(JSON.parse(lead.details_json).city,'Bengaluru');
    const incomplete={...details};delete incomplete.city;assert.throws(()=>validateEnquiry({...common,service,details:incomplete},s),/City/);
  }assert.equal(s.get('SELECT count(*) n FROM leads').n,6);assert.equal(s.get('SELECT count(*) n FROM jobs').n,12);s.db.close();
});
test('clothing stores server-priced snapshot; rejects spoofed sizes, hidden and unavailable products',()=>{
  const s=createStore(':memory:'),p=insertProduct(s);assert.equal(p.sale_paise,84999);
  const submission={...common,service:'GQX Fit clothing',details:{...common.details,productId:p.id,size:'M',color:'Black',quantity:'2',pincode:'560001',unitPrice:'1',total:'1'}};
  const data=validateEnquiry(submission,s),lead=s.addLead(data);assert.equal(data.details.product.total_paise,169998);assert.equal(data.details.unitPrice,undefined);
  s.run('UPDATE products SET price_paise=100 WHERE id=?',p.id);assert.equal(JSON.parse(s.get('SELECT details_json FROM leads WHERE id=?',lead.id).details_json).product.unit_price_paise,84999);
  assert.throws(()=>validateEnquiry({...submission,details:{...submission.details,size:'XXXL'}},s),/Size/);
  assert.throws(()=>validateEnquiry({...submission,details:{...submission.details,quantity:'0'}},s),/Quantity/);
  s.run("UPDATE products SET availability='Out of stock' WHERE id=?",p.id);assert.throws(()=>validateEnquiry(submission,s),/unavailable/);
  s.run("UPDATE products SET availability='Available',active=0 WHERE id=?",p.id);assert.throws(()=>validateEnquiry(submission,s),/unavailable/);s.db.close();
});
test('product validation rejects invalid discounts, image protocols and sub-paise prices',()=>{
  for(const change of [{discount_percent:101},{discount_percent:-1},{price:12.345},{price:-2},{image_url:'javascript:alert(1)'},{image_url:'http://example.com/image.jpg'},{sizes:[]}])assert.throws(()=>validateProduct({...productInput,...change}));
  assert.equal(validateProduct({...productInput,discount_percent:100}).discount_percent,100);
});
test('service-specific validation rejects missing fields, invalid PINs and email contact without email',()=>{
  const s=createStore(':memory:');
  assert.throws(()=>validateEnquiry({...common,service:'Meal box',details:{...common.details,area:'Local',pincode:'000000'}},s),/PIN/);
  assert.throws(()=>validateEnquiry({...common,service:'Online training'},s),/goal/i);
  assert.throws(()=>validateEnquiry({...common,service:'Other',details:{...common.details,interest:'Test',contactPreference:'Email'}},s),/email address/);
  assert.throws(()=>validateEnquiry({...common,service:'Unknown'},s));s.db.close();
});
test('legacy schema migrates without losing old enquiries or statuses',()=>{
  const dir=mkdtempSync(join(tmpdir(),'gqx-migration-')),path=join(dir,'legacy.db');
  try{const db=new DatabaseSync(path);db.exec("CREATE TABLE leads(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL,email TEXT NOT NULL,service TEXT NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'New',created_at INTEGER NOT NULL,closed_at INTEGER,closure_reason TEXT); INSERT INTO leads VALUES('legacy','Existing customer','1234567890','','Brand & design','Old enquiry','Contacted',1000,NULL,NULL)");db.close();const s=createStore(path);const lead=s.get("SELECT * FROM leads WHERE id='legacy'");assert.equal(lead.status,'Contacted');assert.equal(lead.details_json,'{}');assert.equal(lead.admin_notes,'');assert.equal(s.all('SELECT * FROM products').length,0);s.db.close();}finally{rmSync(dir,{recursive:true,force:true});}
});
test('Render origin fallback and all public module/style routes work without local secrets',async()=>{
  const salt='b'.repeat(32),s=createStore(':memory:');
  const env={NODE_ENV:'production',RENDER_EXTERNAL_URL:'https://gqx-fit-test.onrender.com',ADMIN_PASSWORD_HASH:salt+':'+scryptSync('only a test password',salt,64).toString('hex'),SESSION_SECRET:'s'.repeat(40),CRON_SECRET:'c'.repeat(40)};
  const app=createApp(env,{store:s,sender:async()=>({outcome:'blocked'})}),fetch=routeFetch(app.server);
  try{const home=await fetch(env.RENDER_EXTERNAL_URL+'/');assert.equal(home.status,200);assert.match(await home.text(),/GQX Fit/);
    for(const path of ['/admin','/app.js','/admin.js','/schema.js','/products-admin.js','/fit.css','/style.css']){const response=await fetch(env.RENDER_EXTERNAL_URL+path);assert.equal(response.status,200,path);if(path.endsWith('.js'))assert.equal(response.headers.get('content-type'),'text/javascript');}
    const response=await fetch(env.RENDER_EXTERNAL_URL+'/api/enquiries',{method:'POST',headers:{Origin:'http://localhost:3000','Content-Type':'application/json'},body:'{}'});assert.equal(response.status,403);
  }finally{s.db.close();}
});
