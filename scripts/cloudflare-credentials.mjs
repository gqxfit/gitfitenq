import {randomBytes,createHash} from 'node:crypto';
import {writeFileSync,existsSync} from 'node:fs';
const target=new URL('../.env.cloudflare',import.meta.url);
if(existsSync(target))throw Error('Credentials already exist. Keep the existing private file; do not accidentally reset live access.');
const password=randomBytes(24).toString('base64url'),hash=createHash('sha256').update(password).digest('hex');
writeFileSync(target,`# PRIVATE. Never upload this file.\n# ADMIN_LOGIN_KEY is the password for /admin; the other values go into Worker secrets.\nADMIN_LOGIN_KEY=${password}\nADMIN_KEY_HASH=${hash}\nSESSION_SECRET=${randomBytes(32).toString('hex')}\nCRON_SECRET=${randomBytes(32).toString('hex')}\n`,{mode:0o600});
console.log('Private Cloudflare login and secrets saved in .env.cloudflare. Open that file locally. No values printed.');
