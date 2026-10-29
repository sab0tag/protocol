import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { compare, describe, HISTORY_TABLE, type Manifest } from './schema.ts';
import { immediate } from './tx.ts';

/**
 * Versioned SQLite migrations (ACCESS-00-M). The only code that changes the schema: constructors no longer do.
 *
 * - Files `NNNN_name.sql` in ./migrations, versions contiguous from 1; applied files are immutable (checksum).
 * - History `schema_migrations(version, name, checksum, applied_at)`.
 * - Each step runs in its own `BEGIN IMMEDIATE` transaction that re-reads the history, so a concurrent runner waits
 *   and then finds nothing to do. A failing step rolls back entirely and is not recorded.
 * - Before 0001 runs on a non-empty database, the database is checked against the baseline manifest: every present
 *   table, column and index must match; only missing objects are accepted (and created). Anything else is refused.
 * - After every step the whole schema must equal the manifest of the migrations applied so far.
 * - `assertCurrent` is the validation-only path for CLIs: it reads, never writes.
 */
export interface Migration { version: number; name: string; sql: string; checksum: string }

export type SchemaErrorCode =
  | 'unversioned' | 'pending' | 'newer_schema' | 'checksum_mismatch' | 'unrecognized_schema' | 'schema_drift' | 'migration_failed';

export class SchemaError extends Error {
  readonly code: SchemaErrorCode;
  readonly details: string[];
  constructor(code: SchemaErrorCode, details: string[] = []) {
    super(`${code}${details.length ? `: ${details.join('; ')}` : ''}`);
    this.code = code;
    this.details = details;
  }
}

const FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;
export const checksum = (sql: string) => createHash('sha256').update(sql, 'utf8').digest('hex');

export function loadMigrations(dir: URL = new URL('./migrations/', import.meta.url)): Migration[] {
  const files = readdirSync(dir).sort();
  const out = files.map((f) => {
    const m = FILE.exec(f);
    if (!m) throw new Error(`unexpected file in migrations: ${f}`); // never skip a misnamed migration silently
    const sql = readFileSync(new URL(f, dir), 'utf8');
    return { version: Number(m[1]), name: m[2]!, sql, checksum: checksum(sql) };
  });
  out.forEach((m, i) => { if (m.version !== i + 1) throw new Error(`migrations must be numbered 0001, 0002, … without gaps (found ${m.version} at ${i + 1})`); });
  return out;
}

let bundled: Migration[] | undefined;
/** The migrations shipped with the server. */
export const MIGRATIONS = (): Migration[] => (bundled ??= loadMigrations());

interface HistoryRow { version: number; name: string; checksum: string }

const hasHistory = (db: DatabaseSync) =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(HISTORY_TABLE);

function readHistory(db: DatabaseSync): HistoryRow[] {
  if (!hasHistory(db)) return [];
  return db.prepare(`SELECT version, name, checksum FROM ${HISTORY_TABLE} ORDER BY version`).all() as unknown as HistoryRow[];
}

/** The history must be exactly a prefix of the known migrations. */
function verifyHistory(history: HistoryRow[], migrations: Migration[]): void {
  const newer = history.filter((h) => h.version > migrations.length);
  if (newer.length) throw new SchemaError('newer_schema', newer.map((h) => `applied ${h.version} ${h.name} is unknown to this build (knows up to ${migrations.length})`));
  history.forEach((h, i) => {
    if (h.version !== i + 1) throw new SchemaError('checksum_mismatch', [`history has a gap at ${i + 1}`]);
    const m = migrations[i]!;
    if (h.name !== m.name || h.checksum !== m.checksum) {
      throw new SchemaError('checksum_mismatch', [`migration ${m.version} was ${h.name}/${h.checksum.slice(0, 12)} when applied, now ${m.name}/${m.checksum.slice(0, 12)}`]);
    }
  });
}

const manifests = new Map<string, Manifest>();
/** The schema after applying `migrations[0..n)` to an empty database. */
export function expectedManifest(migrations: Migration[], n = migrations.length): Manifest {
  const key = migrations.slice(0, n).map((m) => m.checksum).join(',');
  let m = manifests.get(key);
  if (!m) {
    const db = new DatabaseSync(':memory:');
    try {
      for (const step of migrations.slice(0, n)) db.exec(step.sql);
      m = describe(db);
    } finally { db.close(); }
    manifests.set(key, m);
  }
  return m;
}

const isEmpty = (db: DatabaseSync) =>
  !db.prepare("SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name != ? LIMIT 1").get(HISTORY_TABLE);

export interface MigrateResult { applied: number[]; baseline: 'fresh' | 'legacy' | null; version: number }

/** Brings the database to the latest version. Throws `SchemaError` and leaves the failed step unapplied. */
export function migrate(db: DatabaseSync, migrations: Migration[] = MIGRATIONS(), now: () => Date = () => new Date()): MigrateResult {
  const applied: number[] = [];
  let baseline: MigrateResult['baseline'] = null;
  for (;;) {
    const step = immediate(db, (): number | null => {
      const history = readHistory(db);
      verifyHistory(history, migrations);
      const next = migrations[history.length];
      if (!next) return null;
      if (next.version === 1) {
        if (isEmpty(db)) baseline = 'fresh';
        else {
          const diffs = compare(describe(db), expectedManifest(migrations, 1), true);
          if (diffs.length) throw new SchemaError('unrecognized_schema', diffs);
          baseline = 'legacy';
        }
      } else {
        const drift = compare(describe(db), expectedManifest(migrations, history.length));
        if (drift.length) throw new SchemaError('schema_drift', drift);
      }
      db.exec(`CREATE TABLE IF NOT EXISTS ${HISTORY_TABLE} (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)`);
      try {
        db.exec(next.sql);
      } catch (e) {
        throw new SchemaError('migration_failed', [`${String(next.version).padStart(4, '0')}_${next.name}: ${(e as Error).message}`]);
      }
      const after = compare(describe(db), expectedManifest(migrations, next.version));
      if (after.length) throw new SchemaError('schema_drift', after);
      db.prepare(`INSERT INTO ${HISTORY_TABLE} (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)`)
        .run(next.version, next.name, next.checksum, now().toISOString());
      return next.version;
    });
    if (step === null) break;
    applied.push(step);
  }
  return { applied, baseline, version: migrations.length };
}

/** Validation only: throws unless the database is exactly at the latest version. Never writes, never migrates. */
export function assertCurrent(db: DatabaseSync, migrations: Migration[] = MIGRATIONS()): void {
  if (!hasHistory(db)) throw new SchemaError('unversioned', [isEmpty(db) ? 'the database is empty' : 'the database has no migration history']);
  const history = readHistory(db);
  verifyHistory(history, migrations);
  if (history.length < migrations.length) {
    throw new SchemaError('pending', migrations.slice(history.length).map((m) => `${String(m.version).padStart(4, '0')}_${m.name} not applied`));
  }
  const drift = compare(describe(db), expectedManifest(migrations));
  if (drift.length) throw new SchemaError('schema_drift', drift);
}
