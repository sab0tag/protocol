// Operator: applies pending migrations and exits — the same path the API runs at startup, for a maintenance window
// with the API stopped:  docker compose run --rm api npm run db:migrate
// Refuses to create a database that does not exist: a mistyped DB_PATH must not produce a fresh empty one.
import { existsSync } from 'node:fs';
import { migrate, SchemaError } from './migrate.ts';
import { Store } from '../store.ts';

export function migrateCli(dbPath: string | undefined, out: (s: string) => void, err: (s: string) => void): number {
  if (!dbPath) { err('DB_PATH is not set'); return 2; }
  if (!existsSync(dbPath)) { err(`no database at ${dbPath} — the API creates a new one at its first start`); return 2; }
  const store = new Store(dbPath);
  try {
    const r = migrate(store.database);
    out(r.applied.length ? `applied ${r.applied.join(', ')}${r.baseline ? ` (baseline: ${r.baseline})` : ''}; now at ${r.version}` : `up to date at ${r.version}`);
    return 0;
  } catch (e) {
    if (e instanceof SchemaError) { err(`refused: ${e.message}`); return 3; }
    throw e;
  } finally { store.close(); }
}

if (import.meta.main) process.exitCode = migrateCli(process.env.DB_PATH, console.log, console.error);
