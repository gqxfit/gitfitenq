import { services } from '/schema.js';
const $=s=>document.querySelector(s),form=$('#enquiry');let products=[];
const money=paise=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(paise/100);
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
// Split the existing form without disabling controls or losing their values.
let stage=0;
form.noValidate=true;
const contactStep=el('div');contactStep.id='contact-step';
const serviceLabel=$('#service').parentElement,description=$('#service-description'),preferences=$('#service-fields');
for(const child of [...form.children])if(![serviceLabel,description,preferences].includes(child))contactStep.append(child);
form.append(contactStep);description.after(preferences);
const progress=el('div',undefined,'form-progress');progress.append(el('span','1 · Your preferences'),el('span','2 · Contact details'));form.prepend(progress);
const selectedSummary=el('div',undefined,'selected-summary');contactStep.prepend(selectedSummary);
const stepActions=el('div',undefined,'step-actions'),back=el('button','← Back','quiet'),next=el('button','Continue →');back.type=next.type='button';stepActions.append(back,next);form.append(stepActions);
form.append($('#feedback'));
function validVisible(container){for(const control of container.querySelectorAll('input,select,textarea'))if(control.getClientRects().length&&!control.reportValidity())return false;return true;}
function showStage(value){stage=value;contactStep.hidden=!value;serviceLabel.hidden=!!value;description.hidden=!!value;preferences.hidden=!!value||!services[$('#service').value];next.hidden=!!value;back.hidden=!value;progress.children[0].classList.toggle('current',!value);progress.children[1].classList.toggle('current',!!value);selectedSummary.textContent=$('#service').value;$('#feedback').textContent='';}
next.onclick=()=>{if(!validVisible(form))return;if(form.service.value==='GQX Fit clothing'&&!form.elements.productId?.value){$('#feedback').textContent='Choose an available product, or select Other for a general clothing question.';return;}showStage(1);contactStep.querySelector('input').focus();};
back.onclick=()=>showStage(0);showStage(0);
for(const [name,info] of Object.entries(services)) {
  $('#service').append(el('option',name));
  const button=el('button',undefined,'service-card');button.type='button';button.append(el('span',info.tag,'step'),el('h3',name),el('p',info.description),el('span','Explore ↗','card-link'));
  button.onclick=()=>choose(name);$('#service-cards').append(button);
}
function choose(service,productId) {
  form.hidden=false;$('#success').hidden=true;$('#service').value=service;renderFields(productId);showStage(0);$('#enquire').scrollIntoView({behavior:'smooth'});$('#service').focus({preventScroll:true});
}
const trainingGoals=['Fat loss','Strength','Beginner fitness','Specialised fitness support'];
for(const goal of trainingGoals){const button=el('button',goal,'goal-choice');button.type='button';button.onclick=()=>{choose('Online training');form.elements.goal.value=goal;};$('#training-goals').append(button);}
function field(key,label,type='text',options=null,placeholder='',required=true) {
  const wrapper=el('label',label),input=el(type==='select'?'select':'input');input.name=key;input.required=required;
  if(type==='select') {const blank=el('option','Choose an option');blank.value='';input.append(blank);for(const value of options)input.append(el('option',value));}
  else {input.type=type==='pincode'?'text':type;input.maxLength=200;input.placeholder=placeholder||'';if(type==='pincode'){input.pattern='[1-9][0-9]{5}';input.inputMode='numeric';input.maxLength=6;}if(type==='number'){input.min='1';input.max=key==='quantity'?'50':'10000';input.step='1';}}
  wrapper.append(input);$('#dynamic-fields').append(wrapper);return input;
}
function renderFields(productId) {
  const service=$('#service').value,info=services[service];$('#dynamic-fields').replaceChildren();$('#service-fields').hidden=!!stage||!info;$('#service-description').textContent=info?.description||'';$('#service-step').textContent=info?.tag||'GQX FIT / ENQUIRY';
  for(const button of $('#service-cards').children){const selected=button.querySelector('h3').textContent===service;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));}
  if(!info)return;
  for(const f of info.fields)field(...(f[0]==='goal'?[f[0],f[1],f[2],['Fat loss','Strength','Beginner fitness','Specialised fitness support'],...f.slice(4)]:f));
  if(service==='GQX Fit clothing') {
    const select=field('productId','Product','select',[]);
    for(const p of products.filter(p=>p.availability!=='Out of stock')) {const option=el('option',`${p.name} — ${money(p.sale_paise)}${p.availability==='Preorder'?' (preorder)':''}`);option.value=p.id;select.append(option);}
    const holder=el('div');holder.id='variant-fields';$('#dynamic-fields').append(holder);
    const quote=el('p',undefined,'price-summary');quote.id='quote';$('#dynamic-fields').append(quote);
    select.onchange=()=>renderVariants(select.value);if(productId)select.value=productId;renderVariants(select.value);
    if(!products.some(p=>p.availability!=='Out of stock')) {select.disabled=true;$('#dynamic-fields').append(el('p','No clothing products are available right now. Please use Other for general clothing questions.','notice'));}
    field('pincode','Delivery PIN code','pincode');
  }
}
function renderVariants(id) {
  const target=$('#variant-fields');target.replaceChildren();$('#quote').textContent='';const p=products.find(p=>p.id===id);if(!p)return;
  for(const [key,label,options] of [['size','Size',p.sizes],['color','Colour',p.colors]]){const input=field(key,label,'select',options);target.append(input.parentElement);}
  const qty=field('quantity','Quantity','number');qty.value='1';target.append(qty.parentElement);
  const update=()=>{$('#quote').textContent=`${money(p.sale_paise)} each · Estimated total ${money(p.sale_paise*(Number(qty.value)||1))}${p.discount_percent?` · ${p.discount_percent}% off`:''}. Delivery charges confirmed by the team.`;};qty.oninput=update;update();
}
async function loadCatalog() {
  try {const r=await fetch('/api/products');if(!r.ok)throw Error();products=(await r.json()).products;
    if(!products.length)$('#catalog-feedback').textContent='Our collection will appear here when products are published. For clothing questions, choose Other below.';
    $('#catalog').replaceChildren(...products.map(p=>{
      const card=el('article',undefined,'product-card'),visual=el('div',undefined,'product-visual'),placeholder=el('div','GQX FIT','product-placeholder');visual.append(placeholder);
      if(p.image_url){const img=el('img');img.src=p.image_url;img.alt=p.name;img.loading='lazy';img.referrerPolicy='no-referrer';img.onerror=()=>{img.remove();placeholder.hidden=false;};placeholder.hidden=true;visual.append(img);}
      if(p.discount_percent)visual.append(el('span',`${p.discount_percent}% OFF`,'discount-label'));
      const content=el('div',undefined,'product-content');content.append(el('small',p.availability),el('h3',p.name),el('p',p.description));
      const price=el('p',undefined,'product-price');price.append(el('strong',money(p.sale_paise)));if(p.discount_percent)price.append(' ',el('del',money(p.price_paise)));content.append(price,el('small',`Sizes: ${p.sizes.join(', ')} · Colours: ${p.colors.join(', ')}`));
      const button=el('button',p.availability==='Out of stock'?'Out of stock':'Enquire about this ↗');button.disabled=p.availability==='Out of stock';button.onclick=()=>choose('GQX Fit clothing',p.id);content.append(button);card.append(visual,content);return card;
    }));if($('#service').value==='GQX Fit clothing')renderFields();
  }catch{$('#catalog-feedback').textContent='Could not load the collection. Refresh to try again, or send a general enquiry using Other.';}
}
$('#start-training').onclick=()=>choose('Online training');
$('#service').onchange=()=>renderFields();form.contactPreference.onchange=()=>{form.email.required=form.contactPreference.value==='Email';};
form.onsubmit=async e=>{
  e.preventDefault();if(stage===0){next.click();return;}if(!validVisible(contactStep))return;if(form.service.value==='GQX Fit clothing'&&!form.elements.productId?.value){showStage(0);$('#feedback').textContent='Choose an available product, or use Other for general questions.';return;}
  const button=form.querySelector('button[type=submit]');button.disabled=true;$('#feedback').textContent='Step 1 of 2: saving your enquiry. WhatsApp opens next…';
  const values=Object.fromEntries(new FormData(form)),data={};for(const key of ['name','phone','email','service','message','website'])data[key]=values[key]||'';
  data.consent=form.consent.checked;data.details=Object.fromEntries(Object.entries(values).filter(([key])=>!['name','phone','email','service','message','website','consent'].includes(key)));
  // Reserve the tab during the user gesture so mobile popup blockers allow it.
  const whatsappTab=window.open('about:blank','_blank');
  if(whatsappTab){whatsappTab.opener=null;whatsappTab.document.title='Saving your GQX Fit enquiry';whatsappTab.document.body.textContent='Saving your enquiry. WhatsApp will open after it is saved.';}
  try{const r=await fetch('/api/enquiries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await r.json();if(!r.ok)throw Error(result.error);if(!result.id)throw Error('Could not confirm your enquiry was saved. Please try again.');
    const lines=['GQX Fit enquiry',`Reference: ${result.id}`,`Service: ${data.service}`,`Name: ${data.name}`,`Phone: ${data.phone}`];
    if(data.email)lines.push(`Email: ${data.email}`);
    for(const control of form.querySelectorAll('input,select,textarea')){if(!(control.name in data.details)||!control.value)continue;const label=control.closest('label')?.childNodes[0]?.textContent?.trim()||control.name;const value=control.tagName==='SELECT'?control.selectedOptions[0]?.textContent:control.value;lines.push(`${label}: ${value}`);}
    if($('#quote')?.textContent)lines.push($('#quote').textContent);
    if(data.message)lines.push(`Message: ${data.message}`);
    const whatsappUrl='https://wa.me/918122832764?text='+encodeURIComponent(lines.join('\n'));
    $('#whatsapp-link').href=whatsappUrl;
    if(whatsappTab)whatsappTab.location.replace(whatsappUrl);
    form.hidden=true;$('#success').hidden=false;$('#reference').textContent=`Reference: ${result.id}`;$('#success').focus();}
  catch(e){if(whatsappTab&&!whatsappTab.closed)whatsappTab.close();$('#feedback').textContent=e.message||'Could not send. Please try again.';}finally{button.disabled=false;}
};
$('#another').onclick=()=>{form.reset();form.email.required=false;form.hidden=false;$('#success').hidden=true;$('#feedback').textContent='';renderFields();showStage(0);};loadCatalog();
