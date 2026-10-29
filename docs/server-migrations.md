# Server schema migrations (ACCESS-00-M)

The server's SQLite schema is changed only by versioned migrations in `server/src/db/migrations`. Constructors of
`Store`, `ClinicDirectory`, `PlanDelivery` and other modules no longer create or alter tables.

## Rules
- A migration is a file `NNNN_name.sql` (four digits, lowercase name), numbered from `0001` without gaps. A misnamed
  file in the folder stops the server rather than being skipped.
- An applied file never changes. Its SHA-256 is stored in `schema_migrations` and checked on every start; a changed
  file stops the server (`checksum_mismatch`). Fix forward with a new migration.
- Each migration runs in one `BEGIN IMMEDIATE` transaction together with its history row. A failure rolls the whole
  step back and is not recorded; the server does not start.
- On every startup, including a no-op with no pending migrations, and after every step, the whole schema must equal the schema produced by the migrations so far on an empty database
  (`schema_drift` otherwise). Manual changes to the live schema are therefore refused too.
- No destructive down-migrations. Roll the application back only to a version that understands the current schema;
  restoring data goes through a backup and is tested separately.

## Baseline `0001`
`0001_baseline.sql` is the schema the constructors created at `main` `7507e5a` plus ACCESS-00-H, verbatim. On the
first start of this build:
- an empty database gets the baseline;
- an existing database is compared with the baseline manifest (every table, column, index including the implicit
  PRIMARY KEY / UNIQUE ones, foreign keys, views, triggers). Present objects must match exactly; missing tables or
  explicit indexes are accepted and created. Anything else — an extra table, column, view, a different index — is
  refused with a list of differences, and nothing is written;
- data and ids are not touched. The legacy fixture `server/test/fixtures/legacy-7507e5a.sql` was produced by running
  the old constructors and keeps this check honest.

## Who runs what
- **API startup** (`node src/main.ts`) migrates before it serves. A refused database exits with code 1 and
  `database migration refused: …`.
- **`npm run db:migrate`** does the same and exits, for a maintenance window with the API stopped. It never creates a
  missing database.
- **`npm run clinic:create`** and **`npm run stats:*`** only validate: they never create a database, never migrate and
  run no DDL. `clinic:create` refuses (exit 3) a database that is unversioned, behind, newer, has an altered checksum
  or a drifted schema, and checks the version again under the write lock in the same transaction that creates the
  clinic. It can run next to the API on a current schema.
- While a migration is being applied, other writers (the API of the previous version, the CLIs) must be stopped. A
  concurrent runner waits for the lock and then finds nothing to do; if it waits longer than `busy_timeout` (5 s) it
  fails and does not serve.

## Before deploying this change
Check the live schema on a copy of the latest backup, not on the live file:

```
gunzip -c /backups/protocol-YYYY-MM-DD.db.gz > /tmp/check.db
DB_PATH=/tmp/check.db npm run db:migrate   # unversioned legacy: applied 1, 2, 3, 4, 5; baseline-only: applied 2, 3, 4
```

A refusal there lists exactly what differs; resolve it before the new API starts against the live database.

The current version is 3 (ACCESS-07-A delivery snapshot format). Migration 0003 adds a format discriminator; existing
deliveries remain format 1 with unchanged payloads/hashes, new authenticated issues use format 2. See
[identity expand](access-02-memberships.md) and [delivery snapshots](access-07-a-snapshots.md) for compatibility and
rollback restrictions. Applied migrations 0001 and 0002 remain immutable.

Version 4 (ACCESS-03) adds `sessions`, `login_attempts` and `auth_audit` only; no existing table or row changes, and
nothing uses them until `CLINIC_IDENTITY_V2=on`. See [sessions](access-03-sessions.md).

## Review verification
Current-version schema drift is checked inside the final write-locked transaction too, not only before a pending migration. API startup refuses versioned drift before listening. The manifest also compares SQL token definitions for tables and explicit indexes to detect CHECK changes, index expressions and partial predicates that PRAGMA metadata omits. Whitespace outside quoted values may differ; other unknown definition differences are refused conservatively for review, not silently normalized.

Connection setup installs busy_timeout before requesting WAL mode so parallel CLIs also wait during journal initialization. A busy error while opening clinic:create is a retryable exit 4, not a malformed-database exit 2.

Version 5 (`staff_onboarding`) adds invitation lifecycle, per-clinic token deadlines and nullable verified contact in
sessions. Existing sessions remain valid but cannot accept an invitation until re-authentication supplies signed
verified contact evidence. Migration does not link staff, send email or start token cutover. Clinic/member/delivery
IDs and earlier checksums remain unchanged. See [ACCESS-04](access-04-onboarding.md) before enabling onboarding.
