-- ACCESS-03: server sessions after OIDC sign-in (Authorization Code + PKCE through the API, ADR 0001).
-- Only hashes of session and login-attempt secrets are stored. No tokens from the identity provider are kept:
-- the ID token is verified once at the callback and only its subject, auth_time and MFA evidence are recorded.
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  issuer TEXT NOT NULL CHECK (length(issuer) > 0),
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  auth_time INTEGER NOT NULL,
  mfa INTEGER NOT NULL CHECK (mfa IN (0, 1)),
  csrf TEXT NOT NULL
);
CREATE INDEX sessions_account ON sessions(account_id, revoked_at);

-- A sign-in in progress: state, nonce and PKCE verifier stay on the server; the browser holds only a random attempt id
-- in a short-lived cookie. One use, ten minutes.
CREATE TABLE login_attempts (
  id_hash TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE,
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('login', 'step_up')),
  session_hash TEXT,
  return_to TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

-- Authentication events: who (account, when known), what, outcome category. Never codes, tokens, cookies or claims.
CREATE TABLE auth_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  account_id TEXT,
  action TEXT NOT NULL,
  result TEXT NOT NULL
);
CREATE INDEX auth_audit_account ON auth_audit(account_id, id);
