-- ACCESS-03. Sessions are server-side, opaque credentials are only stored as hashes.
CREATE TABLE identity_sessions (
  id_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  csrf_secret TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  auth_time INTEGER NOT NULL,
  mfa INTEGER NOT NULL CHECK (mfa IN (0, 1)),
  revoked_at INTEGER
);
CREATE INDEX identity_sessions_account ON identity_sessions(account_id);
CREATE TABLE identity_login_attempts (
  state_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  nonce TEXT NOT NULL,
  verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  prior_session_hash TEXT,
  consumed_at INTEGER
);
CREATE TABLE identity_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  account_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('login', 'logout', 'revoke_all', 'step_up', 'login_failed', 'access_denied'))
);
