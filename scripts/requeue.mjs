// Run only while the app is stopped, on the host containing the persistent database.
import { createStore } from '../lib/store.mjs';
const [id,ack]=process.argv.slice(2);
if(!/^\d+$/.test(id||'')||ack!=='--accept-duplicate-risk') throw new Error('Usage: node --env-file=.env scripts/requeue.mjs JOB_ID --accept-duplicate-risk');
const s=createStore(process.env.DB_PATH||'./data/gqx.db');
const job=s.get('SELECT j.*,l.status FROM jobs j JOIN leads l ON l.id=j.lead_id WHERE j.id=?',Number(id));
if(!job||job.status==='Done'||!['failed','unknown','blocked'].includes(job.state)) throw new Error('Only failed, unknown or blocked jobs on open enquiries may be retried.');
s.run("UPDATE jobs SET state='pending',attempts=0,due_at=? WHERE id=?",Date.now(),Number(id));
console.log('Job requeued. Previous attempt logs retained. Restart the app.');s.db.close();
