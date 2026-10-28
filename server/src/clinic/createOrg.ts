// Operator-only: founds a clinic with its first admin and prints the admin token once. Run where the database lives —
// on the server, inside the api container (DB_PATH is set there by compose.yml):
//   docker compose exec api npm run clinic:create -- "Назва клініки" "Імʼя адміністратора"
import { existsSync } from 'node:fs';
import { Store } from '../store.ts';
import { ClinicDirectory, ClinicError } from './directory.ts';

/** No default path: a mistyped or missing DB_PATH would found the clinic in a fresh empty database, and the printed
 *  token would work nowhere. Returns the exit code. */
export function createOrg(args: string[], dbPath: string | undefined, out: (s: string) => void, err: (s: string) => void): number {
  const [name, admin] = args;
  if (!name || !admin) { err('usage: clinic:create "<clinic name>" "<admin name>"'); return 2; }
  if (!dbPath) { err('DB_PATH is not set — point it at the live database (it is set inside the api container)'); return 2; }
  if (!existsSync(dbPath)) { err(`no database at ${dbPath} — refusing to create a new one`); return 2; }
  const store = new Store(dbPath);
  store.database.exec('PRAGMA busy_timeout = 5000'); // the running api may be writing at this moment
  try {
    const { orgId, token } = new ClinicDirectory(store.database).createOrganization(name, admin);
    out(`organization: ${orgId}\nadmin token (shown once, store it safely): ${token}`);
    return 0;
  } catch (e) {
    if (e instanceof ClinicError) { err(`rejected: ${e.code} (names must be 1–200 characters)`); return 2; }
    throw e;
  } finally { store.close(); }
}

if (import.meta.main) process.exitCode = createOrg(process.argv.slice(2), process.env.DB_PATH, console.log, console.error);
