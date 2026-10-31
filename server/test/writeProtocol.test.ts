import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.ts';
import { Store } from '../src/store.ts';
import { tick } from '../src/push.ts';
import { emptyPolicy } from '../src/reminderPolicy.ts';
const VAULT = 'a'.repeat(32), OTHER = 'b'.repeat(32), AUTH = 'k'.repeat(43), DEVICE = 'd'.repeat(32);
const T0 = Date.parse('2026-10-27T12:00:00Z');
const resources: Store[] = [], dirs: string[] = [];
afterEach(() => { for (const s of resources.splice(0)) s.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const setup = (path = ':memory:') => {
  const store = Store.migrated(path); resources.push(store);
  const app = createApp({ store, origins: [], now: () => new Date(T0) });
  const call = (method: string, suffix: string, body?: unknown, vault = VAULT, auth = AUTH) => app.request(`/v1/vaults/${vault}${suffix}`, {
    method, headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { store, call };
};
const record = { k: 'r'.repeat(20), v: 'AAAA' };
const path = `/devices/${DEVICE}/reminders`;
const schedule = (protocol?: number) => ({ items: [{ rid: 'one'.padEnd(20, '_'), at: T0, payload: { k: 'med' } }, { rid: 'two'.padEnd(20, '_'), at: T0, payload: { k: 'water' } }], ...(protocol === undefined ? {} : { protocol }) });
async function ready() {
  const s = setup(); await s.call('PUT', ''); await s.call('PUT', '', undefined, OTHER);
  s.store.putSub(VAULT, DEVICE, '{}', T0); return s;
}
describe('opt-in per-vault write protocol', () => {
  it('keeps old clients working by default and authenticates capability discovery', async () => {
    const { store, call } = await ready();
    expect(store.minimumWriteProtocol(VAULT)).toBe(1);
    expect(await (await call('GET', '/write-protocol')).json()).toEqual({ minimum: 1, supported: 2 });
    expect((await call('POST', '/records', { records: [record] })).status).toBe(200);
    expect((await call('GET', '/records?since=0')).status).toBe(200);
    expect((await call('PUT', path, schedule())).status).toBe(200);
    expect((await call('GET', '/write-protocol', undefined, VAULT, 'x'.repeat(43))).status).toBe(401);
    expect((await call('GET', '/write-protocol', undefined, 'c'.repeat(32))).status).toBe(404);
  });
  it('rejects old reads/writes/policies/schedules after opt-in without changing ciphertext, seq or byte counts', async () => {
    const { store, call } = await ready(); await call('POST', '/records', { records: [record] }); await call('PUT', path, schedule());
    const before = { records: store.since(VAULT, 0, 20), seq: store.latest(VAULT), bytes: store.bytes(VAULT) };
    expect((await call('PUT', '/write-protocol', { minimum: 2, protocol: 2 })).status).toBe(200);
    expect(store.all('SELECT * FROM reminders WHERE vault = ?', VAULT)).toEqual([]);
    for (const response of [
      await call('GET', '/records?since=0'), await call('POST', '/records', { records: [{ ...record, v: null }] }),
      await call('PUT', path, schedule()), await call('PUT', '/reminder-policy', emptyPolicy()),
    ]) { expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'client_upgrade_required', requiredProtocol: 2 }); }
    expect({ records: store.since(VAULT, 0, 20), seq: store.latest(VAULT), bytes: store.bytes(VAULT) }).toEqual(before);
    expect(store.reminderPolicy(VAULT)).toEqual(emptyPolicy());
    expect((await call('POST', '/records', { records: [record] }, OTHER)).status).toBe(200);
    expect((await call('GET', '/records?since=0', undefined, OTHER)).status).toBe(200);
  });
  it('accepts explicit capable clients and repeated opt-in never erases their fresh schedule', async () => {
    const { store, call } = await ready(); await call('PUT', '/write-protocol', { minimum: 2, protocol: 2 });
    expect((await call('POST', '/records', { records: [record], protocol: 2, expectedSeq: 0 })).status).toBe(200);
    expect((await call('GET', '/records?since=0&protocol=2')).status).toBe(200);
    expect((await call('PUT', path, schedule(2))).status).toBe(200);
    expect((await call('PUT', '/reminder-policy', { ...emptyPolicy(), protocol: 2 })).status).toBe(200);
    expect((await call('PUT', '/reminder-policy', { ...emptyPolicy(), protocol: 2, patientName: 'must reject' })).status).toBe(400);
    const queue = store.all('SELECT * FROM reminders WHERE vault = ?', VAULT);
    await call('PUT', '/write-protocol', { minimum: 2, protocol: 2 });
    expect(store.all('SELECT * FROM reminders WHERE vault = ?', VAULT)).toEqual(queue);
    expect((await call('PUT', '/write-protocol', { minimum: 1, protocol: 2 })).status).toBe(400);
    expect(store.minimumWriteProtocol(VAULT)).toBe(2);
  });
  it('rejects malformed or unauthenticated upgrade claims before retiring a queue', async () => {
    const { store, call } = await ready(); await call('PUT', path, schedule());
    const before = store.all('SELECT * FROM reminders');
    for (const body of [{ minimum: 2 }, { minimum: 2, protocol: '2' }, { minimum: 3, protocol: 3 }]) expect((await call('PUT', '/write-protocol', body)).status).toBe(400);
    expect((await call('PUT', '/write-protocol', { minimum: 2, protocol: 2 }, VAULT, 'x'.repeat(43))).status).toBe(401);
    expect(store.minimumWriteProtocol(VAULT)).toBe(1); expect(store.all('SELECT * FROM reminders')).toEqual(before);
    for (const protocol of ['2', 0, 3, 1.5]) expect((await call('POST', '/records', { records: [record], protocol })).status).toBe(400);
    expect((await call('GET', '/records?since=0&protocol=2x')).status).toBe(400);
  });
  it('rolls back the protocol floor if queue retirement fails', async () => {
    const { store, call } = await ready(); await call('PUT', path, schedule());
    const before = store.all('SELECT * FROM reminders');
    store.all("CREATE TRIGGER synthetic_retirement_failure BEFORE DELETE ON reminders BEGIN SELECT RAISE(ABORT, 'synthetic_failure'); END");
    expect(() => store.raiseWriteProtocol(VAULT, 2)).toThrow('synthetic_failure');
    expect(store.minimumWriteProtocol(VAULT)).toBe(1); expect(store.all('SELECT * FROM reminders')).toEqual(before);
  });
  it('re-checks the floor between awaited push sends and retains a newly submitted queue', async () => {
    const { store, call } = await ready(); await call('PUT', path, schedule());
    const sent: unknown[] = [];
    await tick(store, async (_sub, payload) => {
      sent.push(JSON.parse(payload));
      store.raiseWriteProtocol(VAULT, 2);
      await call('PUT', path, { ...schedule(2), items: [{ rid: 'fresh'.padEnd(20, '_'), at: T0, payload: { k: 'med' } }] });
      return 'ok';
    }, T0);
    expect(sent).toHaveLength(1);
    expect(store.all<{ rid: string }>('SELECT rid FROM reminders')).toEqual([{ rid: 'fresh'.padEnd(20, '_') }]);
  });
  it('adds the gate to a historical SQLite file without changing its vault or records and persists opt-in on reopen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'protocol-gate-')); dirs.push(dir); const file = join(dir, 'old.db');
    const old = new DatabaseSync(file);
    old.exec('CREATE TABLE vaults (id TEXT PRIMARY KEY, auth TEXT NOT NULL, created TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0); CREATE TABLE records (vault TEXT NOT NULL, k TEXT NOT NULL, v TEXT, seq INTEGER NOT NULL, PRIMARY KEY (vault, k)); CREATE TABLE meta (k TEXT PRIMARY KEY, n INTEGER NOT NULL);');
    old.prepare('INSERT INTO vaults VALUES (?, ?, ?, ?)').run(VAULT, createHash('sha256').update(AUTH).digest('hex'), '2026-10-20', 4);
    old.prepare('INSERT INTO records VALUES (?, ?, ?, ?)').run(VAULT, record.k, record.v, 1); old.prepare('INSERT INTO meta VALUES (?, ?)').run('seq', 1); old.close();
    const first = setup(file); expect(first.store.minimumWriteProtocol(VAULT)).toBe(1);
    const before = first.store.since(VAULT, 0, 10); await first.call('PUT', '/write-protocol', { minimum: 2, protocol: 2 });
    first.store.close(); resources.splice(resources.indexOf(first.store), 1);
    const next = setup(file); expect(next.store.minimumWriteProtocol(VAULT)).toBe(2); expect(next.store.since(VAULT, 0, 10)).toEqual(before);
    expect((await next.call('GET', '/records?since=0')).status).toBe(409); expect((await next.call('GET', '/records?since=0&protocol=2')).status).toBe(200);
  });
});
