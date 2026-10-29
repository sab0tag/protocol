import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { afterEach, describe as group, expect, it } from 'vitest';
import { ClinicDirectory } from '../src/clinic/directory.ts';
import { PlanDelivery } from '../src/clinic/delivery.ts';
import { assertCurrent, checksum, expectedManifest, loadMigrations, migrate, MIGRATIONS as allMigrations, SchemaError, type Migration } from '../src/db/migrate.ts';
import { migrateCli } from '../src/db/migrateCli.ts';
import { compare, describe, HISTORY_TABLE } from '../src/db/schema.ts';
import { Store } from '../src/store.ts';

// ACCESS-00-M (AC-22). The legacy fixture was produced by running the constructors of main 7507e5a, so it is an
// independent record of the implicit schema the baseline must reproduce.
const LEGACY = readFileSync(new URL('./fixtures/legacy-7507e5a.sql', import.meta.url), 'utf8');
// Runner-core cases deliberately use immutable 0001; identityMemberships.test.ts covers the full shipped sequence.
const baselineMigrations = () => [allMigrations()[0]!];
const BASELINE_CHECKSUM = 'fdcbe811adc0a88ba9eb04d03372b431d8266eb68758e3dc466a32228be3b74d';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'protocol-mig-')); dirs.push(d); return d; };

const legacyDb = (sql = LEGACY) => { const db = new DatabaseSync(':memory:'); db.exec(sql); return db; };
const tables = (db: DatabaseSync) => Object.keys(describe(db).tables).sort();
const history = (db: DatabaseSync) => db.prepare(`SELECT version, name, checksum, applied_at FROM ${HISTORY_TABLE} ORDER BY version`).all().map((r) => ({ ...r }));
const hasHistory = (db: DatabaseSync) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(HISTORY_TABLE);
const dump = (db: DatabaseSync) => Object.fromEntries(tables(db).map((t) => [t, db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all().map((r) => ({ ...r }))]));
const fail = (f: () => unknown): SchemaError => { try { f(); } catch (e) { if (e instanceof SchemaError) return e; throw e; } throw new Error('expected a SchemaError'); };
const step = (version: number, name: string, sql: string): Migration => ({ version, name, sql, checksum: checksum(sql) });
const withNext = (sql: string) => [...baselineMigrations(), step(2, 'next', sql)];

function seedLegacy(db: DatabaseSync) {
  db.prepare("INSERT INTO vaults (id, auth, created, bytes) VALUES ('v1', 'h', '2026-10-01', 12)").run();
  db.prepare("INSERT INTO records (vault, k, v, seq) VALUES ('v1', 'k1', 'cipher', 7)").run();
  db.prepare("UPDATE meta SET n = 7 WHERE k = 'seq'").run();
  db.prepare("INSERT INTO clinic_orgs (id, name, created) VALUES ('org-1', 'Клініка', 1)").run();
  db.prepare("INSERT INTO clinic_members (id, org, name, role, token_hash, created) VALUES ('m-1', 'org-1', 'Лікар', 'doctor', 'th', 1)").run();
  db.prepare("INSERT INTO clinic_audit (org, at, actor, action, target) VALUES ('org-1', 1, 'm-1', 'plan.issue', 'd-1')").run();
  db.prepare("INSERT INTO plan_delivery (id, org, issued_by, code_hash, plan, plan_hash, expires, created) VALUES ('d-1', 'org-1', 'm-1', 'ch', '{}', 'ph', 9, 1)").run();
  db.prepare("INSERT INTO pilot_sources (code, label, issued) VALUES ('ENDO-01', 'Ендокринолог', '2026-10-01')").run();
}

group('the bundled migrations', () => {
  it('0001_baseline is immutable: its checksum is pinned', () => {
    expect(baselineMigrations().map((m) => [m.version, m.name])).toEqual([[1, 'baseline']]);
    expect(baselineMigrations()[0]!.checksum).toBe(BASELINE_CHECKSUM);
  });

  it('the manifest covers the whole legacy schema of Store and clinic — every table, column and index, nothing more', () => {
    const legacy = legacyDb();
    expect(compare(describe(legacy), expectedManifest(baselineMigrations(), 1))).toEqual([]);
    const names = tables(legacy);
    expect(names).toEqual(Object.keys(expectedManifest(baselineMigrations()).tables).sort());
    for (const t of ['vaults', 'records', 'counters', 'concierge_log', 'pilot_members', 'pilot_weeks', 'pilot_sources',
      'clinic_orgs', 'clinic_members', 'clinic_audit', 'plan_delivery']) expect(names).toContain(t);
    const indexes = Object.values(describe(legacy).tables).flatMap((t) => t.indexes.map((i) => i.name));
    for (const i of ['records_seq', 'reminders_due', 'concierge_log_vault', 'clinic_members_org', 'clinic_audit_org', 'plan_delivery_org']) expect(indexes).toContain(i);
  });

  it('constructors no longer create or change any schema', () => {
    const store = new Store(':memory:');
    const dir = new ClinicDirectory(store.database);
    new PlanDelivery(store.database, dir);
    expect(store.database.prepare('SELECT COUNT(*) AS n FROM sqlite_master').get()).toEqual({ n: 0 });
    store.close();
  });
});

group('migrate', () => {
  it('an empty database gets the baseline and its history', () => {
    const db = new DatabaseSync(':memory:');
    const r = migrate(db, baselineMigrations(), () => new Date('2026-10-29T08:00:00Z'));
    expect(r).toEqual({ applied: [1], baseline: 'fresh', version: 1 });
    expect(history(db)).toEqual([{ version: 1, name: 'baseline', checksum: BASELINE_CHECKSUM, applied_at: '2026-10-29T08:00:00.000Z' }]);
    expect(db.prepare("SELECT n FROM meta WHERE k = 'seq'").get()).toEqual({ n: 0 });
    expect(() => assertCurrent(db, baselineMigrations())).not.toThrow();
  });

  it('an existing database of main 7507e5a is accepted as baseline without changing its schema, data or ids', () => {
    const db = legacyDb();
    seedLegacy(db);
    const before = { schema: describe(db), data: dump(db) };
    expect(migrate(db, baselineMigrations())).toEqual({ applied: [1], baseline: 'legacy', version: 1 });
    expect(describe(db)).toEqual(before.schema);
    expect(dump(db)).toEqual(before.data);
    expect(() => assertCurrent(db, baselineMigrations())).not.toThrow();
  });

  it('an older variant with whole tables or explicit indexes missing is normalized by creating them', () => {
    const partial = LEGACY.split(';\n').filter((st) => !/pilot_|concierge_log_vault|reminders_due/.test(st)).join(';\n');
    const db = legacyDb(partial);
    expect(tables(db)).not.toContain('pilot_members');
    expect(migrate(db, baselineMigrations()).baseline).toBe('legacy');
    expect(compare(describe(db), expectedManifest(baselineMigrations()))).toEqual([]);
  });

  it('runs again as a no-op: no DDL, no second history row, applied_at unchanged', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, baselineMigrations(), () => new Date('2026-10-29T08:00:00Z'));
    const h = history(db), schema = describe(db);
    expect(migrate(db, baselineMigrations(), () => new Date('2027-01-01T00:00:00Z'))).toEqual({ applied: [], baseline: null, version: 1 });
    expect(history(db)).toEqual(h);
    expect(describe(db)).toEqual(schema);
  });

  for (const [what, change] of [
    ['an extra column', 'ALTER TABLE vaults ADD COLUMN note TEXT'],
    ['an extra table', 'CREATE TABLE stray (x)'],
    ['an extra CHECK constraint', 'DROP TABLE vaults; CREATE TABLE vaults (id TEXT PRIMARY KEY, auth TEXT NOT NULL, created TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0 CHECK (bytes >= 0))'],
    ['an index with the same name on other columns', 'DROP INDEX records_seq; CREATE INDEX records_seq ON records (seq)'],
    ['a dropped implicit unique index', "DROP TABLE plan_delivery; CREATE TABLE plan_delivery (id TEXT PRIMARY KEY, org TEXT NOT NULL, issued_by TEXT NOT NULL, code_hash TEXT NOT NULL, plan TEXT, plan_hash TEXT NOT NULL, expires INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created INTEGER NOT NULL); CREATE INDEX plan_delivery_org ON plan_delivery (org, id)"],
    ['a view', 'CREATE VIEW v AS SELECT id FROM vaults'],
  ] as const) {
    it(`refuses a schema it does not recognize (${what}) and writes nothing`, () => {
      const db = legacyDb();
      db.exec(change);
      const before = describe(db);
      const e = fail(() => migrate(db, baselineMigrations()));
      expect(e.code).toBe('unrecognized_schema');
      expect(e.details.length).toBeGreaterThan(0);
      expect(hasHistory(db)).toBe(false);
      expect(describe(db)).toEqual(before);
    });
  }

  it('refuses a history newer than the build, and an applied migration whose file changed', () => {
    const newer = new DatabaseSync(':memory:');
    migrate(newer, withNext('CREATE TABLE later (x)'));
    expect(fail(() => migrate(newer, baselineMigrations())).code).toBe('newer_schema');
    expect(fail(() => assertCurrent(newer, baselineMigrations())).code).toBe('newer_schema');

    const changed = new DatabaseSync(':memory:');
    migrate(changed, baselineMigrations());
    const edited = [{ ...baselineMigrations()[0]!, sql: baselineMigrations()[0]!.sql + '\n-- edited', checksum: checksum(baselineMigrations()[0]!.sql + '\n-- edited') }];
    expect(fail(() => migrate(changed, edited)).code).toBe('checksum_mismatch');
    expect(fail(() => assertCurrent(changed, edited)).code).toBe('checksum_mismatch');
  });

  it('a failing migration rolls back entirely, is not recorded, and the database stays at the previous version', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, baselineMigrations());
    db.prepare("INSERT INTO vaults (id, auth, created) VALUES ('v1', 'h', 'x')").run();
    const before = { schema: describe(db), data: dump(db), history: history(db) };
    const broken = withNext("CREATE TABLE half (x); INSERT INTO vaults (id, auth, created) VALUES ('v2', 'h', 'x'); CREATE TABLE oops (");
    const e = fail(() => migrate(db, broken));
    expect(e.code).toBe('migration_failed');
    expect(e.details[0]).toMatch(/^0002_next:/);
    expect({ schema: describe(db), data: dump(db), history: history(db) }).toEqual(before);
    expect(db.isTransaction).toBe(false);
    expect(fail(() => assertCurrent(db, broken)).code).toBe('pending');
  });

  it('a later migration with a data transfer runs once; a rerun does not transfer twice', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, baselineMigrations());
    db.prepare("INSERT INTO vaults (id, auth, created) VALUES ('v1', 'h', 'x'), ('v2', 'h', 'x')").run();
    const next = withNext('CREATE TABLE vault_copy (id TEXT PRIMARY KEY); INSERT INTO vault_copy (id) SELECT id FROM vaults;');
    expect(migrate(db, next).applied).toEqual([2]);
    expect(migrate(db, next).applied).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM vault_copy').get()).toEqual({ n: 2 });
    expect(() => assertCurrent(db, next)).not.toThrow();
  });

  it('a schema that drifted from its history is refused before the next step and by validation', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, baselineMigrations());
    db.exec('ALTER TABLE vaults ADD COLUMN note TEXT');
    expect(fail(() => assertCurrent(db, baselineMigrations())).code).toBe('schema_drift');
    const before = { schema: describe(db), data: dump(db), history: history(db) };
    expect(fail(() => migrate(db, baselineMigrations())).code).toBe('schema_drift');
    expect({ schema: describe(db), data: dump(db), history: history(db) }).toEqual(before);
    expect(db.isTransaction).toBe(false);
    expect(fail(() => migrate(db, withNext('CREATE TABLE later (x)'))).code).toBe('schema_drift');
    expect(history(db)).toHaveLength(1);
  });

  it('migration files: numbered without gaps, and a misnamed file is an error rather than silently skipped', () => {
    const dir = tmp();
    const write = (files: Record<string, string>) => {
      const d = join(dir, String(Math.random()).slice(2)); mkdirSync(d);
      for (const [f, s] of Object.entries(files)) writeFileSync(join(d, f), s);
      return pathToFileURL(`${d}/`);
    };
    expect(loadMigrations(write({ '0001_a.sql': 'CREATE TABLE a (x);', '0002_b.sql': 'CREATE TABLE b (x);' })).map((m) => m.version)).toEqual([1, 2]);
    expect(() => loadMigrations(write({ '0001_a.sql': '', '0003_c.sql': '' }))).toThrow(/without gaps/);
    expect(() => loadMigrations(write({ '0001_a.sql': '', 'notes.txt': '' }))).toThrow(/unexpected file/);
    expect(() => loadMigrations(write({ '1_a.sql': '' }))).toThrow(/unexpected file/);
  });

  it('validation rejects changed index expressions and partial predicates even when their PRAGMA shapes match', () => {
    for (const [expected, changed] of [
      ['CREATE INDEX expression_idx ON vaults (lower(auth))', 'CREATE INDEX expression_idx ON vaults (upper(auth))'],
      ['CREATE INDEX expression_idx ON vaults (auth) WHERE bytes > 0', 'CREATE INDEX expression_idx ON vaults (auth) WHERE bytes > 1'],
    ]) {
      const db = new DatabaseSync(':memory:');
      const migrations = withNext(expected!);
      migrate(db, migrations);
      db.exec(`DROP INDEX expression_idx; ${changed}`);
      expect(fail(() => migrate(db, migrations)).code).toBe('schema_drift');
      expect(fail(() => assertCurrent(db, migrations)).code).toBe('schema_drift');
      db.close();
    }
  });

  it('SQL signatures preserve whitespace inside quoted view and trigger values', () => {
    for (const [expected, changed] of [
      ["CREATE VIEW label AS SELECT 'a b' AS text", "DROP VIEW label; CREATE VIEW label AS SELECT 'a  b' AS text"],
      ["CREATE TRIGGER label AFTER INSERT ON vaults BEGIN INSERT INTO settings (k, v) VALUES (NEW.id, 'a b'); END", "DROP TRIGGER label; CREATE TRIGGER label AFTER INSERT ON vaults BEGIN INSERT INTO settings (k, v) VALUES (NEW.id, 'a  b'); END"],
    ]) {
      const db = new DatabaseSync(':memory:');
      const migrations = withNext(expected!);
      migrate(db, migrations);
      db.exec(changed!);
      expect(fail(() => migrate(db, migrations)).code).toBe('schema_drift');
      expect(fail(() => assertCurrent(db, migrations)).code).toBe('schema_drift');
      db.close();
    }
  });
});

group('concurrent runners', () => {
  it('two runners migrating one fresh file apply every version exactly once even when steps interleave', async () => {
    const path = join(tmp(), 'db.sqlite');
    new Store(path).close();
    const sab = new SharedArrayBuffer(4);
    const spawn = () => {
      const w = new Worker(new URL('./support/schemaWorker.ts', import.meta.url), { workerData: { role: 'migrate', path, sab }, execArgv: [] });
      const queue: any[] = [], waiters: ((m: any) => void)[] = [];
      w.on('message', (m) => { const r = waiters.shift(); if (r) r(m); else queue.push(m); });
      const exit = new Promise((r) => w.once('exit', r));
      return { next: () => new Promise<any>((r) => { const m = queue.shift(); if (m) r(m); else waiters.push(r); }), exit };
    };
    const a = spawn(), b = spawn();
    await Promise.all([a.next(), b.next()]); // both ready
    const f = new Int32Array(sab); Atomics.store(f, 0, 1); Atomics.notify(f, 0);
    const [ra, rb] = await Promise.all([a.next(), b.next()]);
    expect([ra.error, rb.error]).toEqual([undefined, undefined]);
    expect([...ra.result.applied, ...rb.result.applied].sort((a, b) => a - b)).toEqual(allMigrations().map((m) => m.version));
    await Promise.all([a.exit, b.exit]);
    const db = new DatabaseSync(path);
    expect(history(db)).toHaveLength(allMigrations().length);
    expect(() => assertCurrent(db)).not.toThrow();
    db.close();
  }, 30_000);
});

group('db:migrate command', () => {
  it('never creates a missing database; migrates a legacy one; then reports up to date', () => {
    const run = (p: string | undefined) => { const out: string[] = [], err: string[] = []; return { code: migrateCli(p, (s) => out.push(s), (s) => err.push(s)), out: out.join(''), err: err.join('') }; };
    const dir = tmp();
    expect(run(join(dir, 'none.db'))).toMatchObject({ code: 2, err: expect.stringMatching(/no database/) });
    expect(run(undefined).code).toBe(2);
    const path = join(dir, 'legacy.db');
    const db = new DatabaseSync(path); db.exec(LEGACY); db.close();
    expect(run(path)).toMatchObject({ code: 0, out: expect.stringMatching(/applied 1, 2 \(baseline: legacy\)/) });
    expect(run(path)).toMatchObject({ code: 0, out: 'up to date at 2' });
    const bad = join(dir, 'bad.db');
    const b = new DatabaseSync(bad); b.exec(LEGACY); b.exec('CREATE TABLE stray (x)'); b.close();
    expect(run(bad)).toMatchObject({ code: 3, err: expect.stringMatching(/unrecognized_schema/) });
  });
});

group('API startup', () => {
  for (const versioned of [false, true]) it(`a refused ${versioned ? 'versioned' : 'legacy'} database stops the process before serving`, async () => {
    const { spawnSync } = await import('node:child_process');
    const path = join(tmp(), 'bad.db');
    const db = new DatabaseSync(path);
    if (versioned) migrate(db); else db.exec(LEGACY);
    db.exec('CREATE TABLE stray (x)');
    const before = { schema: describe(db), history: versioned ? history(db) : null };
    db.close();
    const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/main.ts'], {
      cwd: new URL('..', import.meta.url), env: { ...process.env, DB_PATH: path, PORT: '0', BACKUP_DIR: tmp(), ANTHROPIC_API_KEY: '' }, encoding: 'utf8', timeout: 20_000,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`database migration refused: ${versioned ? 'schema_drift' : 'unrecognized_schema'}: unexpected table stray`);
    expect(r.stdout).not.toMatch(/protocol-api on/);
    const after = new DatabaseSync(path);
    expect(hasHistory(after)).toBe(versioned);
    expect({ schema: describe(after), history: versioned ? history(after) : null }).toEqual(before);
    after.close();
  }, 30_000);
});
