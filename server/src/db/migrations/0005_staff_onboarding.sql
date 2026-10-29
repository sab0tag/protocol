-- Verified contact is session evidence, never an identity key or an account-merge key.
ALTER TABLE sessions ADD COLUMN verified_email TEXT;
CREATE TABLE staff_invitations (
  id TEXT PRIMARY KEY,
  org TEXT NOT NULL REFERENCES clinic_orgs(id),
  inviter TEXT NOT NULL,
  target_member TEXT REFERENCES clinic_members(id),
  target_roles TEXT,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  roles TEXT NOT NULL CHECK (roles IN ('["admin"]', '["doctor"]', '["admin","doctor"]')),
  secret_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('sending','sent','failed','revoked','accepted')),
  accepted_account TEXT REFERENCES accounts(id),
  accepted_at INTEGER
);
CREATE INDEX staff_invitations_org ON staff_invitations(org, created_at);
CREATE TABLE clinic_auth_transitions (
  org TEXT PRIMARY KEY REFERENCES clinic_orgs(id),
  migrated_at INTEGER NOT NULL,
  legacy_until INTEGER NOT NULL,
  CHECK (legacy_until >= migrated_at AND legacy_until <= migrated_at + 604800000)
);
