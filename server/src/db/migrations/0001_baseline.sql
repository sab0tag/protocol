-- 0001 baseline (ACCESS-00-M). The schema the server built implicitly in constructors at main 7507e5a + ACCESS-00-H:
-- Store (store.ts), ClinicDirectory (clinic/directory.ts) and PlanDelivery (clinic/delivery.ts), verbatim.
-- IF NOT EXISTS is deliberate: an existing database is checked against the manifest first, and a supported older
-- variant (objects missing, never different) is normalized by creating what is missing.
-- Applied migration files are immutable: their checksum is verified on every start.

-- Store
CREATE TABLE IF NOT EXISTS vaults (id TEXT PRIMARY KEY, auth TEXT NOT NULL, created TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS vault_protocols (vault TEXT PRIMARY KEY, minimum INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS records (vault TEXT NOT NULL, k TEXT NOT NULL, v TEXT, seq INTEGER NOT NULL, PRIMARY KEY (vault, k));
CREATE INDEX IF NOT EXISTS records_seq ON records (vault, seq);
CREATE TABLE IF NOT EXISTS counters (day TEXT NOT NULL, scope TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, scope));
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, n INTEGER NOT NULL);
INSERT OR IGNORE INTO meta (k, n) VALUES ('seq', 0);
CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS push_subs (vault TEXT NOT NULL, device TEXT NOT NULL, sub TEXT NOT NULL, updated INTEGER NOT NULL,
  PRIMARY KEY (vault, device));
CREATE TABLE IF NOT EXISTS reminders (vault TEXT NOT NULL, device TEXT NOT NULL, rid TEXT NOT NULL, at INTEGER NOT NULL,
  payload TEXT NOT NULL, next_at INTEGER NOT NULL, repeats_left INTEGER NOT NULL, repeat_every INTEGER NOT NULL, sent INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (vault, device, rid));
CREATE INDEX IF NOT EXISTS reminders_due ON reminders (next_at);
CREATE TABLE IF NOT EXISTS reminder_policies (vault TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reminder_clients (vault TEXT NOT NULL, device TEXT NOT NULL, aware INTEGER NOT NULL,
  PRIMARY KEY (vault, device));
CREATE TABLE IF NOT EXISTS usage (vault TEXT NOT NULL, month TEXT NOT NULL, kind TEXT NOT NULL, calls INTEGER NOT NULL,
  usd_micro INTEGER NOT NULL, PRIMARY KEY (vault, month, kind));
CREATE TABLE IF NOT EXISTS spend_day (day TEXT PRIMARY KEY, usd_micro INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS pairs (pid TEXT PRIMARY KEY, blob TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS acks (vault TEXT NOT NULL, rid TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (vault, rid));
CREATE TABLE IF NOT EXISTS device_tokens (h TEXT PRIMARY KEY, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS concierge_log (id TEXT PRIMARY KEY, vault TEXT NOT NULL, ts INTEGER NOT NULL, scenario TEXT NOT NULL,
  record TEXT NOT NULL, outcome TEXT, edit TEXT);
CREATE INDEX IF NOT EXISTS concierge_log_vault ON concierge_log (vault, ts);
CREATE TABLE IF NOT EXISTS pushed (vault TEXT NOT NULL, rid TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (vault, rid));
CREATE TABLE IF NOT EXISTS vault_weeks (vault TEXT NOT NULL, week TEXT NOT NULL, PRIMARY KEY (vault, week));
CREATE TABLE IF NOT EXISTS pilot_members (pid TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, joined TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pilot_weeks (pid TEXT NOT NULL, week TEXT NOT NULL, kind TEXT NOT NULL, src TEXT, body TEXT NOT NULL,
  PRIMARY KEY (pid, week, kind));
CREATE TABLE IF NOT EXISTS pilot_sources (code TEXT PRIMARY KEY, label TEXT NOT NULL, issued TEXT NOT NULL);

-- Clinic directory
CREATE TABLE IF NOT EXISTS clinic_orgs (id TEXT PRIMARY KEY, name TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS clinic_members (id TEXT PRIMARY KEY, org TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS clinic_members_org ON clinic_members (org);
CREATE TABLE IF NOT EXISTS clinic_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, org TEXT NOT NULL, at INTEGER NOT NULL,
  actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT);
CREATE INDEX IF NOT EXISTS clinic_audit_org ON clinic_audit (org, id);

-- Plan delivery
CREATE TABLE IF NOT EXISTS plan_delivery (id TEXT PRIMARY KEY, org TEXT NOT NULL, issued_by TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE, plan TEXT, plan_hash TEXT NOT NULL, expires INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS plan_delivery_org ON plan_delivery (org, id);
