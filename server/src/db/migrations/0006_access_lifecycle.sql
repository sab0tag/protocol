-- D176 (queue task 6): the staff access lifecycle and a plan sealed until it is redeemed.
-- ACCESS-07-B: a plan issued from now on is encrypted with a key derived from the patient's one-time code, which the
-- server never stores (only its hash). Rows issued before stay readable as they are until redeemed or expired.
ALTER TABLE plan_delivery ADD COLUMN sealed INTEGER NOT NULL DEFAULT 0 CHECK (sealed IN (0, 1));
-- 90 days without a sign-in suspends a membership; only an admin brings it back. `active_since` is the later of the
-- last sign-in and the last restore; NULL — never signed in yet (the clock runs from created_at).
ALTER TABLE organization_memberships ADD COLUMN active_since INTEGER;
ALTER TABLE organization_memberships ADD COLUMN suspended_at INTEGER;
-- Old bearer tokens are retired: none are issued with sign-in by invitation on, those issued live until this time.
ALTER TABLE clinic_members ADD COLUMN token_until INTEGER;
-- The quarterly «who has access» list an admin confirms. IDs and a count only — no names, no addresses.
CREATE TABLE clinic_access_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org TEXT NOT NULL REFERENCES clinic_orgs(id),
  reviewed_at INTEGER NOT NULL,
  reviewer TEXT NOT NULL,
  members INTEGER NOT NULL CHECK (members >= 0)
);
CREATE INDEX clinic_access_reviews_org ON clinic_access_reviews(org, reviewed_at);
