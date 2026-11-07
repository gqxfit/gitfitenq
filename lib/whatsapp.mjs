export function createSender(env,fetcher=fetch) {
  return async job=> {
    const template=job.kind==='new'?env.WHATSAPP_TEMPLATE_NEW:env.WHATSAPP_TEMPLATE_REMINDER;
    if(env.WHATSAPP_ENABLED!=='true') return {outcome:'blocked',errorCode:'whatsapp_disabled'};
    const parameters=[job.lead_id,job.name,job.phone,job.service].map(text=>({type:'text',text:String(text).replace(/[\r\n\t]+/g,' ')}));
    try {
      const r=await fetcher(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,{
        method:'POST',headers:{Authorization:`Bearer ${env.WHATSAPP_TOKEN}`,'Content-Type':'application/json'},
        body:JSON.stringify({messaging_product:'whatsapp',to:env.WHATSAPP_OWNER_NUMBER,type:'template',template:{name:template,language:{code:env.WHATSAPP_TEMPLATE_LANGUAGE||'en'},components:[{type:'body',parameters}]}}),signal:AbortSignal.timeout(15000)
      });
      const body=await r.json().catch(()=>null);
      if(r.ok && body?.messages?.[0]?.id) return {outcome:'accepted',providerId:body.messages[0].id,httpStatus:r.status};
      // Only an explicit Meta rejection is safe to retry. Server/proxy timeouts are ambiguous.
      const outcome=r.status===429 && body?.error?'retry':r.status>=500 || r.ok?'unknown':'failed';
      return {outcome,httpStatus:r.status,errorCode:String(body?.error?.code||'invalid_response')};
    } catch { return {outcome:'unknown',errorCode:'network_or_timeout'}; }
  };
}
export function createWorker(store,send) {
  let active=false;
  return async function drain(limit=20) {
    if(active) return {busy:true}; active=true; let processed=0;
    try {
      while(processed<limit) {
        const job=store.claim(); if(!job) break;
        // All mutations and claims run on the single process event loop. Done before claim cancels send.
        store.finish(job,await send(job)); processed++;
      }
      return {processed};
    } finally {active=false;}
  };
}
