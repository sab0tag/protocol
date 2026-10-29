// Operator-only: founds a clinic with its first admin and prints the admin token once. Run where the database lives —
// on the server, inside the api container (DB_PATH is set there by compose.yml):
//   docker compose exec api npm run clinic:create -- "Назва клініки" "Імʼя адміністратора"
// Schema validation only (ACCESS-00-M): it never creates a database, never migrates and runs no DDL. The running API
// applies migrations at startup; this command refuses any database that is not exactly at the latest version.
import { existsSync } from 'node:fs';
import { assertCurrent, SchemaError } from '../db/migrate.ts';
import { DatabaseBusy, isBusy } from '../db/tx.ts';
import { Store } from '../store.ts';
import { ClinicDirectory, ClinicError } from './directory.ts';

const SCHEMA_HINT: Record<SchemaError['code'], string> = {
  unversioned: 'the database has no migration history — start the API once so it migrates, then retry',
  pending: 'the database is behind this build — start the API of this version so it migrates, then retry',
  newer_schema: 'the database is newer than this build — run the matching version',
  checksum_mismatch: 'an applied migration differs from this build — do not continue, check the deployment',
  unrecognized_schema: 'the schema is not one this build recognizes',
  schema_drift: 'the schema differs from what its migration history says',
  migration_failed: 'a migration failed',
};

/** No default path: a mistyped or missing DB_PATH would found the clinic in a fresh empty database, and the printed
 *  token would work nowhere. Returns the exit code. */
export function createOrg(args: string[], dbPath: string | undefined, out: (s: string) => void, err: (s: string) => void): number {
  const [name, admin] = args;
  if (!name || !admin) { err('usage: clinic:create "<clinic name>" "<admin name>"'); return 2; }
  if (!dbPath) { err('DB_PATH is not set — point it at the live database (it is set inside the api container)'); return 2; }
  if (!existsSync(dbPath)) { err(`no database at ${dbPath} — refusing to create a new one`); return 2; }
  let store: Store;
  try {
    store = new Store(dbPath); // the same connection settings as the API (WAL, busy_timeout = 5000), no schema change
  } catch (e) {
    if (isBusy(e)) { err('refused: the database is busy — nothing was created, retry'); return 4; }
    err(`cannot open ${dbPath} as a database: ${(e as Error).message}`); return 2;
  }
  try {
    assertCurrent(store.database); // preflight, for a clear message before taking the write lock
    // …and again under the write lock in the same transaction that creates the clinic: no gap for a migration in between
    const { orgId, token } = new ClinicDirectory(store.database).createOrganization(name, admin, () => assertCurrent(store.database));
    out(`organization: ${orgId}\nadmin token (shown once, store it safely): ${token}`);
    return 0;
  } catch (e) {
    if (e instanceof SchemaError) { err(`refused: schema ${e.code} — ${SCHEMA_HINT[e.code]}${e.details.length ? `\n  ${e.details.join('\n  ')}` : ''}`); return 3; }
    if (e instanceof DatabaseBusy) { err('refused: the database is busy (another writer held the lock for 5 s) — nothing was created, retry'); return 4; }
    if (e instanceof ClinicError) { err(`rejected: ${e.code} (names must be 1–200 characters)`); return 2; }
    throw e;
  } finally { store.close(); }
}

if (import.meta.main) process.exitCode = createOrg(process.argv.slice(2), process.env.DB_PATH, console.log, console.error);
