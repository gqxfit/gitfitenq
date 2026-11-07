// D1 schema. Each entry is one complete statement; batches are transactional.
export const schema = [
`CREATE TABLE IF NOT EXISTS leads(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL,email TEXT NOT NULL,service TEXT NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'New' CHECK(status IN ('New','Contacted','Done')),created_at INTEGER NOT NULL,closed_at INTEGER,closure_reason TEXT,details_json TEXT NOT NULL DEFAULT '{}',admin_notes TEXT NOT NULL DEFAULT '')`,
`CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY,lead_id TEXT NOT NULL REFERENCES leads(id),kind TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',due_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,claim_token TEXT,claimed_at INTEGER,UNIQUE(lead_id,kind))`,
`CREATE TABLE IF NOT EXISTS attempts(id INTEGER PRIMARY KEY,job_id INTEGER NOT NULL REFERENCES jobs(id),started_at INTEGER NOT NULL,outcome TEXT NOT NULL,provider_id TEXT,http_status INTEGER,error_code TEXT,claim_token TEXT UNIQUE)`,
`CREATE TABLE IF NOT EXISTS webhook_events(id TEXT PRIMARY KEY,received_at INTEGER NOT NULL,token TEXT NOT NULL)`,
`CREATE TABLE IF NOT EXISTS delivery_events(provider_id TEXT NOT NULL,status TEXT NOT NULL,event_at INTEGER NOT NULL,error_code TEXT,UNIQUE(provider_id,status,event_at))`,
`CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL)`,
`CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,sku TEXT NOT NULL,image_url TEXT NOT NULL,price_paise INTEGER NOT NULL,discount_percent INTEGER NOT NULL,sizes_json TEXT NOT NULL,colors_json TEXT NOT NULL,availability TEXT NOT NULL,active INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)`,
`CREATE INDEX IF NOT EXISTS jobs_due ON jobs(state,due_at)`,
`CREATE INDEX IF NOT EXISTS attempts_provider ON attempts(provider_id)`,
`CREATE INDEX IF NOT EXISTS limits_expiry ON limits(expires_at)`,
`CREATE INDEX IF NOT EXISTS leads_created ON leads(created_at)`
];
