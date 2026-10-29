-- ACCESS-02 expand only: existing staff tokens remain the legacy authentication authority.
-- A provisional account is not a verified person. Never merge legacy staff by name/email.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending_link', 'active', 'disabled')),
  created_at INTEGER NOT NULL
);
CREATE TABLE external_identities (
  issuer TEXT NOT NULL CHECK (length(issuer) > 0),
  subject TEXT NOT NULL CHECK (length(subject) > 0),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (issuer, subject)
);
CREATE INDEX external_identities_account ON external_identities(account_id);
CREATE TABLE organization_memberships (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES clinic_orgs(id) ON DELETE RESTRICT,
  legacy_member_id TEXT UNIQUE REFERENCES clinic_members(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  created_at INTEGER NOT NULL,
  UNIQUE (account_id, organization_id)
);
CREATE INDEX organization_memberships_org ON organization_memberships(organization_id, status);
CREATE TABLE organization_membership_roles (
  membership_id TEXT NOT NULL REFERENCES organization_memberships(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'doctor')),
  PRIMARY KEY (membership_id, role)
);

-- Keep the staff ID in the new membership namespace. Account IDs are separate provisional placeholders;
-- each row maps independently even when staff names match across clinics. Existing rows are untouched.
INSERT INTO accounts (id, status, created_at)
  SELECT id, 'pending_link', created FROM clinic_members;
INSERT INTO organization_memberships (id, account_id, organization_id, legacy_member_id, status, created_at)
  SELECT id, id, org, id, CASE WHEN active = 0 THEN 'inactive' ELSE 'active' END, created FROM clinic_members;
INSERT INTO organization_membership_roles (membership_id, role)
  SELECT id, role FROM clinic_members;
