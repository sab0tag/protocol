import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import { createOrg } from '../src/clinic/createOrg.ts';
import { ClinicDirectory } from '../src/clinic/directory.ts';
import { assertCurrent, migrate, SchemaError } from '../src/db/migrate.ts';
import { Store } from '../src/store.ts';

// ACCESS-00-M, AC-25: clinic:create validates the schema and never migrates, creates a database or runs DDL.
const LEGACY = readFileSync(new URL('./fixtures/legacy-7507e5a.sql', import.meta.url), 'utf8');
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const file = (name = 'db.sqlite') => { const d = mkdtempSync(join(tmpdir(), 'protocol-cli-')); dirs.push(d); return join(d, name); };

const run = (path: string) => {
  const out: string[] = [], err: string[] = [];
  const code = createOrg(['Клініка', 'Адмін'], path, (s) => out.push(s), (s) => err.push(s));
  return { code, out: out.join('\n'), err: err.join('\n') };
};
const state = (path: string) => {
  const db = new DatabaseSync(path);
  const master = db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY name').all().map((r) => ({ ...r }));
  const n = (t: string) => master.some((m) => m.name === t) ? (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n : null;
  const rows = { orgs: n('clinic_orgs'), members: n('clinic_members'), audit: n('clinic_audit') };
  db.close();
  return { master, rows };
};
const prepared = (setup: (db: DatabaseSync) => void) => {
  const path = file();
  const db = new DatabaseSync(path);
  setup(db);
  db.close();
  return path;
};

describe('clinic:create on a database that is not current', () => {
  const cases: [string, (db: DatabaseSync) => void, SchemaError['code']][] = [
    ['an empty file', () => undefined, 'unversioned'],
    ['the legacy schema without history', (db) => db.exec(LEGACY), 'unversioned'],
    ['a pending migration', (db) => { migrate(db); db.exec('DELETE FROM schema_migrations'); }, 'pending'],
    ['a newer version', (db) => { migrate(db); db.exec("INSERT INTO schema_migrations VALUES (2, 'later', 'x', 'now')"); }, 'newer_schema'],
    ['an altered checksum', (db) => { migrate(db); db.exec("UPDATE schema_migrations SET checksum = 'x'"); }, 'checksum_mismatch'],
    ['a drifted schema', (db) => { migrate(db); db.exec('ALTER TABLE vaults ADD COLUMN note TEXT'); }, 'schema_drift'],
  ];
  for (const [what, setup, code] of cases) {
    it(`${what}: refuses with exit 3 and changes nothing — no DDL, no history, no org, admin or audit`, () => {
      const path = prepared(setup);
      const before = state(path);
      const r = run(path);
      expect(r).toMatchObject({ code: 3, out: '', err: expect.stringContaining(`refused: schema ${code}`) });
      expect(state(path)).toEqual(before);
    });
  }

  it('the version is checked again under the write lock: a database that falls behind after the preflight gets nothing', () => {
    const path = file();
    const store = Store.migrated(path);
    store.database.exec('DELETE FROM schema_migrations'); // as if it changed between the preflight and the lock
    const dir = new ClinicDirectory(store.database);
    let e: unknown;
    try { dir.createOrganization('Клініка', 'Адмін', () => assertCurrent(store.database)); } catch (x) { e = x; }
    expect(e).toBeInstanceOf(SchemaError);
    expect(store.database.isTransaction).toBe(false);
    expect(store.database.prepare('SELECT (SELECT COUNT(*) FROM clinic_orgs) + (SELECT COUNT(*) FROM clinic_members) + (SELECT COUNT(*) FROM clinic_audit) AS n').get()).toEqual({ n: 0 });
    store.close();
  });

  it('a path that is not a database is refused without being turned into one', () => {
    const path = file();
    writeFileSync(path, 'not a database at all, just text');
    expect(run(path)).toMatchObject({ code: 2, err: expect.stringMatching(/cannot open .* as a database/) });
    expect(readFileSync(path, 'utf8')).toBe('not a database at all, just text');
  });
});

describe('clinic:create on a current database', () => {
  it('works alongside another writer: two commands at once both found their clinic', async () => {
    const path = file();
    Store.migrated(path).close();
    const sab = new SharedArrayBuffer(4);
    const spawn = (name: string) => {
      const w = new Worker(new URL('./support/schemaWorker.ts', import.meta.url), { workerData: { role: 'create', path, name, sab }, execArgv: [] });
      const queue: any[] = [], waiters: ((m: any) => void)[] = [];
      w.on('message', (m) => { const r = waiters.shift(); if (r) r(m); else queue.push(m); });
      const exit = new Promise((r) => w.once('exit', r));
      return { next: () => new Promise<any>((r) => { const m = queue.shift(); if (m) r(m); else waiters.push(r); }), exit };
    };
    const a = spawn('Клініка А'), b = spawn('Клініка Б');
    await Promise.all([a.next(), b.next()]);
    const f = new Int32Array(sab); Atomics.store(f, 0, 1); Atomics.notify(f, 0);
    const [ra, rb] = await Promise.all([a.next(), b.next()]);
    expect([ra.result.code, rb.result.code]).toEqual([0, 0]);
    await Promise.all([a.exit, b.exit]);
    expect(state(path).rows).toEqual({ orgs: 2, members: 2, audit: 2 });
  }, 30_000);
});
