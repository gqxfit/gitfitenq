import { services } from '../public/schema.js';
export function validateProduct(input) {
  const result={};
  for(const [key,max] of Object.entries({name:120,description:2000,image_url:1000,sku:60})) {
    if(typeof input[key]!=='string'||input[key].trim().length>max) throw Error(`Check product ${key}`);
    result[key]=input[key].trim();
  }
  if(!result.name) throw Error('Product name is required');
  if(result.image_url) {let u;try{u=new URL(result.image_url);}catch{throw Error('Use a valid HTTPS image URL');}if(u.protocol!=='https:'||u.username||u.password)throw Error('Use a valid HTTPS image URL');}
  if(typeof input.price!=='number'||!Number.isFinite(input.price)||input.price<0||input.price>1000000 || Math.abs(input.price*100-Math.round(input.price*100))>0.000001) throw Error('Enter a price with up to two decimal places');
  result.price_paise=Math.round(input.price*100);
  if(!Number.isInteger(input.discount_percent)||input.discount_percent<0||input.discount_percent>100) throw Error('Discount must be a whole percentage from 0 to 100');
  result.discount_percent=input.discount_percent;
  for(const key of ['sizes','colors']) {
    if(!Array.isArray(input[key])||input[key].length<1||input[key].length>20||input[key].some(x=>typeof x!=='string'||!x.trim()||x.trim().length>40)) throw Error(`Add 1–20 ${key}`);
    result[key]=[...new Set(input[key].map(x=>x.trim()))];
  }
  if(!['Available','Preorder','Out of stock'].includes(input.availability)||typeof input.active!=='boolean') throw Error('Check availability and visibility');
  result.availability=input.availability;result.active=input.active;return result;
}
export function publicProduct(row) {
  return {...row,sizes:JSON.parse(row.sizes_json),colors:JSON.parse(row.colors_json),active:!!row.active,sale_paise:Math.round(row.price_paise*(100-row.discount_percent)/100),currency:'INR',sizes_json:undefined,colors_json:undefined};
}
export function validateEnquiry(input,store) {
  const data={};
  for(const [key,max] of Object.entries({name:100,phone:20,email:254,service:60,message:2000})) {
    const value=input[key]??'';
    if(typeof value!=='string'||value.trim().length>max)throw Error(`Check ${key}`);
    data[key]=value.trim();
  }
  if(!data.name||!/^\+?[1-9]\d{6,14}$/.test(data.phone)||(data.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))||input.consent!==true||!Object.hasOwn(services,data.service)) throw Error('Check your contact details, service and consent');
  const details=input.details;
  if(!details||Array.isArray(details)||typeof details!=='object')throw Error('Complete your enquiry details');
  const clean={};
  function field(key,label,type,options,placeholder,required=true) {
    const value=details[key];
    if(value===undefined||value==='') {if(required)throw Error(`${label} is required`);return;}
    if(typeof value!=='string'||!value.trim()||value.length>200)throw Error(`Check ${label}`);
    const v=value.trim();
    if(type==='select'&&!options.includes(v))throw Error(`Choose a valid ${label}`);
    if(type==='number'&&(!/^\d+$/.test(v)||Number(v)<1||Number(v)>10000))throw Error(`Check ${label}`);
    if(type==='pincode'&&!/^[1-9]\d{5}$/.test(v))throw Error('Enter a six-digit Indian PIN code');
    if(type==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v))throw Error(`Check ${label}`);
    clean[key]=v;
  }
  field('city','City','text');field('contactPreference','Preferred contact','select',['WhatsApp','Phone','Email']);
  if(clean.contactPreference==='Email'&&!data.email)throw Error('Add an email address for email contact');
  for(const f of services[data.service].fields)field(...f);
  if(data.service==='GQX Fit clothing') {
    const row=typeof details.productId==='string'?store.get('SELECT * FROM products WHERE id=? AND active=1',details.productId):null;
    if(!row||row.availability==='Out of stock')throw Error('This product is unavailable. Please choose another product.');
    const product=publicProduct(row);
    field('size','Size','select',product.sizes);field('color','Colour','select',product.colors);
    field('quantity','Quantity','number');if(Number(clean.quantity)>50)throw Error('For more than 50 items, contact the team through Other');
    field('pincode','Delivery PIN code','pincode');
    clean.product={id:product.id,name:product.name,sku:product.sku,currency:'INR',list_price_paise:product.price_paise,discount_percent:product.discount_percent,unit_price_paise:product.sale_paise,total_paise:product.sale_paise*Number(clean.quantity),availability:product.availability};
  }
  data.details={...clean,consentVersion:'gqx-fit-enquiry-v1'};return data;
}
