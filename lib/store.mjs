import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
export const DAY = 86400000;
export function createStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS leads(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL,email TEXT NOT NULL,service TEXT NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'New' CHECK(status IN ('New','Contacted','Done')),created_at INTEGER NOT NULL,closed_at INTEGER,closure_reason TEXT);
    CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY,lead_id TEXT NOT NULL REFERENCES leads(id),kind TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',due_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,UNIQUE(lead_id,kind));
    CREATE TABLE IF NOT EXISTS attempts(id INTEGER PRIMARY KEY,job_id INTEGER NOT NULL REFERENCES jobs(id),started_at INTEGER NOT NULL,outcome TEXT NOT NULL,provider_id TEXT,http_status INTEGER,error_code TEXT);
    CREATE TABLE IF NOT EXISTS webhook_events(id TEXT PRIMARY KEY,received_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS delivery_events(provider_id TEXT NOT NULL,status TEXT NOT NULL,event_at INTEGER NOT NULL,error_code TEXT,UNIQUE(provider_id,status,event_at));
    CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS jobs_due ON jobs(state,due_at);
    CREATE INDEX IF NOT EXISTS attempts_provider ON attempts(provider_id);`);
  // Additive migration preserves every enquiry from the original app.
  if(!db.prepare('PRAGMA table_info(leads)').all().some(c=>c.name==='details_json')) db.exec("ALTER TABLE leads ADD COLUMN details_json TEXT NOT NULL DEFAULT '{}'");
  if(!db.prepare('PRAGMA table_info(leads)').all().some(c=>c.name==='admin_notes')) db.exec("ALTER TABLE leads ADD COLUMN admin_notes TEXT NOT NULL DEFAULT ''");
  db.exec(`CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,sku TEXT NOT NULL,image_url TEXT NOT NULL,price_paise INTEGER NOT NULL,discount_percent INTEGER NOT NULL,sizes_json TEXT NOT NULL,colors_json TEXT NOT NULL,availability TEXT NOT NULL,active INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);`);
  // An interrupted request may have reached Meta. Never blindly resend it.
  db.exec(`UPDATE attempts SET outcome='unknown',error_code='process_interrupted' WHERE outcome='sending'; UPDATE jobs SET state='unknown' WHERE state='sending';`);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  function transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const value=fn(); db.exec('COMMIT'); return value; } catch(e) {db.exec('ROLLBACK'); throw e;} }
  function addLead(input, now=Date.now()) {
    return transaction(()=> {
      const id=randomUUID();
      run('INSERT INTO leads(id,name,phone,email,service,message,created_at,details_json) VALUES(?,?,?,?,?,?,?,?)',id,input.name,input.phone,input.email,input.service,input.message,now,JSON.stringify(input.details||{}));
      run('INSERT INTO jobs(lead_id,kind,due_at) VALUES(?,?,?)',id,'new',now);
      run('INSERT INTO jobs(lead_id,kind,due_at) VALUES(?,?,?)',id,'reminder',now+7*DAY);
      return get('SELECT * FROM leads WHERE id=?',id);
    });
  }
  function setStatus(id,status,reason='dashboard',now=Date.now()) {
    return transaction(()=> {
      if(!['New','Contacted','Done'].includes(status)) throw new Error('Invalid status');
      const result=run('UPDATE leads SET status=?,closed_at=?,closure_reason=? WHERE id=?',status,status==='Done'?now:null,status==='Done'?reason:null,id);
      if(status==='Done') run("UPDATE jobs SET state='cancelled' WHERE lead_id=? AND state IN ('pending','retry','failed','unknown','blocked')",id);
      // Reopening never rearms an already cancelled/sent reminder.
      return Number(result.changes)>0;
    });
  }
  function claim(now=Date.now()) {
    return transaction(()=> {
      run("UPDATE jobs SET state='cancelled' WHERE state IN ('pending','retry') AND lead_id IN (SELECT id FROM leads WHERE status='Done')");
      const job=get("SELECT j.*,l.name,l.phone,l.service,l.message FROM jobs j JOIN leads l ON j.lead_id=l.id WHERE j.state IN ('pending','retry') AND j.due_at<=? AND l.status!='Done' ORDER BY j.due_at,j.id LIMIT 1",now);
      if(!job) return null;
      run("UPDATE jobs SET state='sending',attempts=attempts+1 WHERE id=?",job.id);
      const a=run("INSERT INTO attempts(job_id,started_at,outcome) VALUES(?,?,'sending')",job.id,now);
      return {...job,attempts:job.attempts+1,attemptId:Number(a.lastInsertRowid)};
    });
  }
  function finish(job,{outcome,providerId=null,httpStatus=null,errorCode=null},now=Date.now()) {
    transaction(()=> {
      run('UPDATE attempts SET outcome=?,provider_id=?,http_status=?,error_code=? WHERE id=?',outcome,providerId,httpStatus,errorCode,job.attemptId);
      const state=outcome==='accepted'?'sent':outcome==='blocked'?'blocked':outcome==='retry' && job.attempts<5?'retry':outcome==='unknown'?'unknown':'failed';
      run('UPDATE jobs SET state=?,due_at=? WHERE id=?',state,now+Math.min(3600000,60000*2**job.attempts),job.id);
      if(get('SELECT status FROM leads WHERE id=?',job.lead_id)?.status==='Done' && state==='retry') run("UPDATE jobs SET state='cancelled' WHERE id=?",job.id);
    });
  }
  function allow(key,max,windowMs,now=Date.now()) {
    return transaction(()=> {
      run('DELETE FROM limits WHERE expires_at<=?',now);
      run('INSERT INTO limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1',key,now+windowMs);
      return get('SELECT count FROM limits WHERE key=?',key).count<=max;
    });
  }
  function webhook(payload,owner,phoneId,now=Date.now()) {
    transaction(()=> {
      if(payload.object!=='whatsapp_business_account') return;
      for(const entry of payload.entry||[]) for(const change of entry.changes||[]) {
        const v=change.value;
        if(change.field!=='messages'||v?.metadata?.phone_number_id!==phoneId) continue;
        for(const s of v.statuses||[]) {
          if(typeof s.id==='string' && ['sent','delivered','read','failed'].includes(s.status) && /^\d+$/.test(String(s.timestamp)))
            run('INSERT OR IGNORE INTO delivery_events VALUES(?,?,?,?)',s.id,s.status,Number(s.timestamp)*1000,String(s.errors?.[0]?.code||'')||null);
        }
        for(const m of v.messages||[]) {
          if(m.from!==owner || !m.id || get('SELECT id FROM webhook_events WHERE id=?',m.id)) continue;
          run('INSERT INTO webhook_events VALUES(?,?)',m.id,now);
          const text=(m.text?.body||'').trim();
          const explicit=/^(?:done|resolved|replied)\s+([a-f0-9-]{36})$/i.exec(text);
          let leadId=explicit?.[1]?.toLowerCase();
          if(!leadId && /^(done|resolved|replied)$/i.test(text) && m.context?.id)
            leadId=get('SELECT j.lead_id FROM attempts a JOIN jobs j ON j.id=a.job_id WHERE a.provider_id=?',m.context.id)?.lead_id;
          if(leadId) {
            run("UPDATE leads SET status='Done',closed_at=?,closure_reason='owner_webhook' WHERE id=?",now,leadId);
            run("UPDATE jobs SET state='cancelled' WHERE lead_id=? AND state IN ('pending','retry','failed','unknown','blocked')",leadId);
          }
        }
      }
    });
  }
  return {db,run,get,all,addLead,setStatus,claim,finish,allow,webhook};
}
