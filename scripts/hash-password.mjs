import { randomBytes, scryptSync } from 'node:crypto';
const password = process.argv[2];
if (!password || password.length < 14) throw new Error('Provide a password of at least 14 characters.');
const salt = randomBytes(16).toString('hex');
console.log(`${salt}:${scryptSync(password, salt, 64).toString('hex')}`);
