import { readFileSync,writeFileSync } from 'node:fs';
const names={'/':'index.html','/admin':'admin.html','/app.js':'app.js','/admin.js':'admin.js','/products-admin.js':'products-admin.js','/schema.js':'schema.js','/style.css':'style.css','/fit.css':'fit.css'};
const assets=Object.fromEntries(Object.entries(names).map(([route,name])=>[route,{body:readFileSync(new URL('../public/'+name,import.meta.url),'utf8'),type:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html; charset=utf-8'}]));
writeFileSync(new URL('../cloudflare-assets.mjs',import.meta.url),'// Generated from public/ by scripts/build-cloudflare.mjs. Contains no credentials.\nexport const assets = '+JSON.stringify(assets)+';\n');
console.log('Built Cloudflare public assets.');
