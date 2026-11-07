import { DatabaseSync,backup } from 'node:sqlite';
const target=process.argv[2];if(!target)throw new Error('Provide a backup destination outside the database directory.');
const db=new DatabaseSync(process.env.DB_PATH||'./data/gqx.db');
await backup(db,target);db.close();console.log('Consistent database backup written. Keep backups private.');
