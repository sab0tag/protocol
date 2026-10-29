-- ACCESS-07-A: format 1 is a legacy document with unverified source names; format 2 is a server-built snapshot.
-- Do not rewrite or certify historical payloads. Version 3 also prevents an older API from consuming new snapshots.
ALTER TABLE plan_delivery ADD COLUMN format INTEGER NOT NULL DEFAULT 1 CHECK (format IN (1, 2));
