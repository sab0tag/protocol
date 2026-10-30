import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { Store } from '../src/store.ts';
import { createApp, DEFAULT_LIMITS } from '../src/app.ts';
const VAULT = 'a'.repeat(32), OTHER = 'b'.repeat(32), AUTH = 'k'.repeat(43);
const resources: Store[] = [], directories: string[] = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'record-cas-')); directories.push(dir); return join(dir, 'db.sqlite'); };
afterEach(() => { vi.restoreAllMocks(); for (const db of resources.splice(0)) db.close(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const row = (k = 'r', v: string | null = 'AAAA') => ({ k: k.repeat(43), v });
async function setup(path = ':memory:', vaultBytes = DEFAULT_LIMITS.vaultBytes) {
  const store = Store.migrated(path); resources.push(store);
  const app = createApp({ store, origins: [], limits: { ...DEFAULT_LIMITS, vaultBytes } });
  const call = (method: string, suffix: string, body?: unknown, vault = VAULT, auth = AUTH) => app.request(`/v1/vaults/${vault}${suffix}`, {
    method, headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  await call('PUT', ''); await call('PUT', '', undefined, OTHER);
  const opt = () => call('PUT', '/write-protocol', { minimum: 2, protocol: 2 });
  const write = (expectedSeq: number, records = [row()]) => call('POST', '/records', { protocol: 2, expectedSeq, records });
  const state = () => ({ records: store.since(VAULT, 0, 100), bytes: store.bytes(VAULT), latest: store.latest(VAULT), counter: store.all("SELECT n FROM meta WHERE k = 'seq'") });
  return { store, call, opt, write, state };
}

describe('protocol-2 conditional record writes', () => {
  it('exposes a distinct conditional route that never accepts a legacy blind write', async () => {
    const s = await setup();
    expect((await s.call('POST', '/records/conditional', { records: [row()] })).status).toBe(400);
    expect((await s.call('POST', '/records/conditional', { protocol: 1, records: [row()] })).status).toBe(400);
    expect((await s.call('POST', '/records/conditional', { protocol: 2, expectedSeq: 0, records: [row()] })).status).toBe(409);
    await s.opt();
    expect((await s.call('POST', '/records/conditional', { protocol: 2, expectedSeq: 0, records: [row()] })).status).toBe(200);
    const before = s.state();
    expect((await s.call('POST', '/records/conditional', { protocol: 2, expectedSeq: 0, records: [row()] })).status).toBe(409);
    expect((await s.call('POST', '/records/conditional', { protocol: 2, expectedSeq: before.latest, records: [row()] }, VAULT, 'x'.repeat(43))).status).toBe(401);
    expect(s.state()).toEqual(before);
  });
  it('requires explicit opt-in and an expected safe sequence, leaving default legacy writes available', async () => {
    const s = await setup();
    expect((await s.write(0)).status).toBe(409);
    expect(s.state().records).toEqual([]);
    expect((await s.call('POST', '/records', { records: [row()] })).status).toBe(200);
    const seq = s.store.latest(VAULT); await s.opt(); const before = s.state();
    for (const expectedSeq of [undefined, null, -1, 0.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
      expect((await s.call('POST', '/records', { protocol: 2, expectedSeq, records: [row()] })).status).toBe(400);
      expect(s.state()).toEqual(before);
    }
    expect((await s.write(seq)).status).toBe(200);
    expect((await s.call('POST', '/records', { protocol: 2, records: [row()] })).status).toBe(400);
    expect((await s.call('POST', '/records', { protocol: 1, records: [row()] })).status).toBe(409);
    expect((await s.call('POST', '/records', { records: [row()], expectedSeq: 0 }, OTHER)).status).toBe(400);
  });

  it('rejects an entire stale batch, including a replay, without changing ciphertext, bytes or sequence', async () => {
    const s = await setup(); await s.opt();
    const first = await (await s.write(0)).json(); const before = s.state();
    const stale = await s.write(0, [row('s'), row('r', 'BBBB')]);
    expect(stale.status).toBe(409); expect(await stale.json()).toEqual({ error: 'record_conflict', seq: first.seq });
    expect((await s.write(0)).status).toBe(409); expect(s.state()).toEqual(before);
    const next = await (await s.write(first.seq, [row('r', null), row('s', 'BBBB')])).json();
    expect(next.seq).toBeGreaterThan(first.seq); expect(s.store.bytes(VAULT)).toBe(4);
    expect(s.store.since(VAULT, first.seq, 10).map(r => r.v)).toEqual([null, 'BBBB']);
  });

  it('uses a per-vault revision; unrelated vault writes cannot conflict or expose data', async () => {
    const s = await setup(); await s.opt();
    expect((await s.call('POST', '/records', { records: [row('s')] }, OTHER)).status).toBe(200);
    expect((await s.write(0)).status).toBe(200);
    const before = s.state();
    expect((await s.call('POST', '/records', { protocol: 2, expectedSeq: before.latest, records: [row()] }, VAULT, 'x'.repeat(43))).status).toBe(401);
    expect(s.state()).toEqual(before);
    expect(s.store.since(OTHER, 0, 10).map(r => r.k)).toEqual([row('s').k]);
  });

  it('checks replacement quota under the write lock, not the sum of old and new ciphertext', async () => {
    const s = await setup(':memory:', 8); await s.opt();
    const first = await (await s.write(0, [row('r', 'AAAAAAAA')])).json();
    expect((await s.write(first.seq, [row('r', 'BBBBBBBB')])).status).toBe(200);
    const before = s.state();
    expect((await s.write(before.latest, [row('s')])).status).toBe(507); expect(s.state()).toEqual(before);
    expect((await s.write(before.latest, [row('r', null), row('s', 'BBBBBBBB')])).status).toBe(200);
    expect(s.store.bytes(VAULT)).toBe(8);
  });

  it('rejects duplicate record keys and rolls back a later write failure', async () => {
    const s = await setup(); await s.opt(); const before = s.state();
    expect((await s.write(0, [row(), row('r', 'BBBB')])).status).toBe(400); expect(s.state()).toEqual(before);
    s.store.database.exec(`CREATE TEMP TRIGGER fail_record BEFORE INSERT ON records WHEN NEW.k = '${row('s').k}' BEGIN SELECT RAISE(ABORT, 'synthetic_record_failure'); END;`);
    expect(() => s.store.put(VAULT, [row(), row('s')], { protocol: 2, expectedSeq: 0 })).toThrow('synthetic_record_failure');
    expect(s.state()).toEqual(before);
    s.store.database.exec('DROP TRIGGER fail_record'); expect((await s.write(0)).status).toBe(200);
  });

  it('rechecks the protocol floor at the service boundary after route preflight', async () => {
    const s = await setup();
    const put = s.store.put.bind(s.store);
    vi.spyOn(s.store, 'put').mockImplementationOnce((...args) => { s.store.raiseWriteProtocol(VAULT, 2); return put(...args); });
    const response = await s.call('POST', '/records', { records: [row()] });
    expect(response.status).toBe(409); expect((await response.json()).error).toBe('client_upgrade_required');
    expect(s.state().records).toEqual([]);
  });

  it('returns a retryable busy response without writes and succeeds after the lock is released', async () => {
    const path = temp(), s = await setup(path); await s.opt();
    const lock = new Store(path); resources.push(lock);
    s.store.database.exec('PRAGMA busy_timeout = 25'); lock.database.exec('BEGIN IMMEDIATE');
    const before = s.state();
    try {
      expect(() => s.store.put(VAULT, [row()], { protocol: 2, expectedSeq: 0 })).toThrow('database_busy');
      const response = await s.write(0);
      expect(response.status).toBe(503); expect(response.headers.get('Retry-After')).toBe('1');
      expect((await response.json()).error).toBe('database_busy'); expect(s.state()).toEqual(before);
    } finally { lock.database.exec('ROLLBACK'); }
    expect((await s.write(0)).status).toBe(200);
  });

  it('keeps an empty pull page and its cursor in the same read snapshot during an independent write', async () => {
    const path = temp(), s = await setup(path), other = new Store(path); resources.push(other);
    const since = s.store.since.bind(s.store);
    vi.spyOn(s.store, 'since').mockImplementationOnce((...args) => { const records = since(...args); other.put(VAULT, [row()]); return records; });
    const response = await s.call('GET', '/records?since=0'); expect(await response.json()).toEqual({ records: [], more: false, seq: 0 });
    const next = await (await s.call('GET', '/records?since=0')).json(); expect(next.records).toHaveLength(1); expect(next.seq).toBeGreaterThan(0);
  });

  it('serializes two independent SQLite workers: one wins and one conflicts at the same expected revision', async () => {
    const path = temp(), s = await setup(path); await s.opt();
    const flags = new SharedArrayBuffer(4), workers: Worker[] = [];
    try {
      const launch = (v: string) => {
        const w = new Worker(new URL('./support/recordCasWorker.ts', import.meta.url), { execArgv: [], workerData: { path, vault: VAULT, record: row('r', v), flags } }); workers.push(w);
        let ready!: () => void;
        const started = new Promise<void>(r => { ready = r; });
        const result = new Promise<{ ok: boolean; code?: string; seq?: number }>((resolve, reject) => {
          w.on('message', m => { if (m.ready) ready(); else resolve(m); }); w.on('error', reject); w.on('exit', code => { if (code) reject(new Error(`worker exit ${code}`)); });
        });
        return { started, result };
      };
      const a = launch('AAAA'), b = launch('BBBB'); await Promise.all([a.started, b.started]);
      Atomics.store(new Int32Array(flags), 0, 1); Atomics.notify(new Int32Array(flags), 0);
      const results = await Promise.all([a.result, b.result]);
      expect(results.filter(r => r.ok)).toHaveLength(1); expect(results.find(r => !r.ok)?.code).toBe('record_conflict');
      expect(s.state().records).toHaveLength(1); expect(s.state().bytes).toBe(4); expect(s.state().latest).toBe(1);
    } finally { await Promise.all(workers.map(w => w.terminate())); }
  });
});
