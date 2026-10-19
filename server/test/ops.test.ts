import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createApp, usdMicro } from '../src/app.ts';
import { backupAgeH, backupOnce } from '../src/backup.ts';
import { Store } from '../src/store.ts';

const VAULT = 'a'.repeat(32), AUTH = 'k'.repeat(43);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]).toString('base64');

describe('AI spend and status', () => {
  it('counts calls and an estimate per vault and month; health tells a failing AI', async () => {
    const store = new Store(':memory:');
    let fail = false;
    const app = createApp({ store, origins: [], recognize: async () => {
      if (fail) throw new Error('down');
      return { result: { items: [], note: null }, usage: { model: 'claude-opus-5-5', input: 1000, output: 500 } };
    } });
    const call = (m: string, path: string, body?: unknown) => app.request(path, { method: m,
      headers: { Authorization: `Bearer ${AUTH}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    await call('PUT', `/v1/vaults/${VAULT}`);
    await call('POST', `/v1/vaults/${VAULT}/photo`, { image: JPEG });
    await call('POST', `/v1/vaults/${VAULT}/photo`, { image: JPEG });
    const u = await (await call('GET', `/v1/vaults/${VAULT}/usage`)).json() as { kinds: Record<string, number>; usd: number };
    expect(u.kinds).toEqual({ photo: 2 });
    expect(u.usd).toBe(0.03); // 2 × (1000 × $4 + 500 × $20) / 1M = $0.028
    expect((await (await app.request('/health')).json() as { ai: { failing: boolean } }).ai.failing).toBe(false);
    fail = true;
    await call('POST', `/v1/vaults/${VAULT}/photo`, { image: JPEG });
    const h = await app.request('/health');
    expect(h.status).toBe(200);
    expect(await h.json()).toMatchObject({ ok: false, ai: { failing: true } });
  });

  it('prices by model, unknown ones as the dearest Opus', () => {
    expect(usdMicro({ model: 'claude-sonnet-5-5', input: 1_000_000, output: 0 })).toBe(2_000_000);
    expect(usdMicro({ model: 'claude-new-thing', input: 0, output: 1_000_000 })).toBe(25_000_000);
  });
});

describe('backup', () => {
  it('a checked gzipped copy once a day, old ones rotated, its age for /health', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pbk-'));
    const dbPath = join(dir, 'live.db');
    const store = new Store(dbPath);
    store.createVault(VAULT, (await import('node:crypto')).createHash('sha256').update(AUTH).digest('hex'), new Date());
    const now = new Date('2026-10-08T01:00:00Z');
    expect(await backupOnce(store, dir, now)).toBe('protocol-2026-10-08.db.gz');
    expect(await backupOnce(store, dir, now)).toBeNull();
    const copy = join(dir, 'restored.db');
    writeFileSync(copy, gunzipSync(readFileSync(join(dir, 'protocol-2026-10-08.db.gz'))));
    const db = new DatabaseSync(copy);
    expect((db.prepare('SELECT COUNT(*) AS n FROM vaults').get() as { n: number }).n).toBe(1);
    db.close();
    expect(readdirSync(dir).filter((f) => f.startsWith('.protocol'))).toEqual([]);
    expect(backupAgeH(dir, new Date(Date.now() + 3 * 3600_000))).toBeCloseTo(3, 0);
    // D44: a vault reads its own sealed records from a copy
    store.put(VAULT, [{ k: 'r'.repeat(43), v: 'QUJD' }]);
    await backupOnce(store, dir, new Date('2026-10-09T01:00:00Z'));
    const { listBackups, backupRecords } = await import('../src/backup.ts');
    expect(listBackups(dir)).toEqual(['protocol-2026-10-09.db.gz', 'protocol-2026-10-08.db.gz']);
    const app = createApp({ store, origins: [], backups: { list: () => listBackups(dir), records: (n, v) => backupRecords(dir, n, v) } });
    const H = { Authorization: `Bearer ${AUTH}` };
    expect(await (await app.request(`/v1/vaults/${VAULT}/backups`, { headers: H })).json()).toEqual({ backups: ['protocol-2026-10-09.db.gz', 'protocol-2026-10-08.db.gz'] });
    expect(await (await app.request(`/v1/vaults/${VAULT}/backups/protocol-2026-10-08.db.gz`, { headers: H })).json()).toEqual({ records: [] });
    expect((await (await app.request(`/v1/vaults/${VAULT}/backups/protocol-2026-10-09.db.gz`, { headers: H })).json() as { records: unknown[] }).records).toHaveLength(1);
    expect((await app.request(`/v1/vaults/${VAULT}/backups/..%2Fetc%2Fpasswd`, { headers: H })).status).toBe(400);
    store.close();
    rmSync(dir, { recursive: true });
  });
});

describe('pairing (D40)', () => {
  it('a sealed code left for 10 minutes, taken once', async () => {
    const store = new Store(':memory:');
    let now = Date.parse('2026-10-08T10:00:00Z');
    const app = createApp({ store, origins: [], now: () => new Date(now) });
    const H = { Authorization: `Bearer ${AUTH}`, 'Content-Type': 'application/json' };
    await app.request(`/v1/vaults/${VAULT}`, { method: 'PUT', headers: H });
    const pid = 'f'.repeat(32);
    expect((await app.request(`/v1/vaults/${VAULT}/pair`, { method: 'POST', headers: H, body: JSON.stringify({ pid, blob: 'not base64!' }) })).status).toBe(400);
    expect((await app.request(`/v1/vaults/${VAULT}/pair`, { method: 'POST', headers: H, body: JSON.stringify({ pid, blob: 'QUJD' }) })).status).toBe(200);
    expect(await (await app.request(`/v1/pair/${pid}`)).json()).toEqual({ blob: 'QUJD' });
    expect((await app.request(`/v1/pair/${pid}`)).status).toBe(404); // once
    await app.request(`/v1/vaults/${VAULT}/pair`, { method: 'POST', headers: H, body: JSON.stringify({ pid, blob: 'QUJD' }) });
    now += 11 * 60_000;
    expect((await app.request(`/v1/pair/${pid}`)).status).toBe(404); // expired
  });
});
