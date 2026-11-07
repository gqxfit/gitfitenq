import { Readable } from 'node:stream';
// Direct route invocation for environments that prohibit loopback connections.
// CI uses real HTTP unless GQX_TEST_IN_PROCESS=true is explicitly selected.
export function routeFetch(server) {
  return async (url,options={})=>new Promise((resolve,reject)=>{
    const u=new URL(url),req=Readable.from(options.body?[Buffer.from(options.body)]:[]);
    req.url=u.pathname+u.search;req.method=options.method||'GET';req.headers=Object.fromEntries([...new Headers(options.headers).entries()]);req.socket={remoteAddress:'127.0.0.1'};
    const headers=new Headers();let status=200;
    const res={setHeader:(key,value)=>headers.set(key,value),writeHead:(code,values)=>{status=code;for(const [key,value] of Object.entries(values))headers.set(key,value);},end:value=>{
      const text=Buffer.isBuffer(value)?value.toString():String(value||'');resolve({status,ok:status>=200&&status<300,headers,json:async()=>JSON.parse(text),text:async()=>text});
    }};
    req.on('error',reject);server.emit('request',req,res);
  });
}
