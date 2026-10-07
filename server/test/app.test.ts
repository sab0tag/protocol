import { describe, expect, it } from 'vitest';
import { createApp, DEFAULT_LIMITS } from '../src/app.ts';
import type { PhotoResult, Recognizer } from '../src/photo.ts';
import { Store } from '../src/store.ts';

const VAULT = 'a'.repeat(32);
const AUTH = 'k'.repeat(43);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
const RESULT: PhotoResult = { items: [{ name: 'яйце варене', match: 'Яйце куряче варене', grams: 100, count: 2, cooking: 'boiled',
  kcal: 155, protein: 13, fat: 11, carbs: 1, confidence: 'high' }], note: null };

function setup(over: { recognize?: Recognizer; limits?: Partial<typeof DEFAULT_LIMITS> } = {}) {
  const store = new Store(':memory:');
  const app = createApp({ store, origins: ['https://protocol.test'], recognize: over.recognize, limits: { ...DEFAULT_LIMITS, ...over.limits } });
  const call = (method: string, path: string, body?: unknown, auth = AUTH, ip = '1.1.1.1') => app.request(path, {
    method, headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { store, call };
}

describe('vaults', () => {
  it('creates once, then only the same key opens it', async () => {
    const { call } = setup();
    expect((await call('PUT', `/v1/vaults/${VAULT}`)).status).toBe(201);
    expect(await (await call('PUT', `/v1/vaults/${VAULT}`)).json()).toEqual({ created: false });
    expect((await call('PUT', `/v1/vaults/${VAULT}`, undefined, 'x'.repeat(43))).status).toBe(401);
    expect((await call('GET', `/v1/vaults/${VAULT}/records`, undefined, 'x'.repeat(43))).status).toBe(401);
  });

  it('unknown vault is 404 (the app says «код не знайдено»)', async () => {
    const { call } = setup();
    expect((await call('GET', `/v1/vaults/${'b'.repeat(32)}/records`)).status).toBe(404);
  });

  it('limits new vaults per address', async () => {
    const { call } = setup({ limits: { vaultsPerIpPerDay: 1 } });
    expect((await call('PUT', `/v1/vaults/${'1'.repeat(32)}`)).status).toBe(201);
    expect((await call('PUT', `/v1/vaults/${'2'.repeat(32)}`)).status).toBe(429);
    expect((await call('PUT', `/v1/vaults/${'2'.repeat(32)}`, undefined, AUTH, '2.2.2.2')).status).toBe(201);
  });
});

describe('records', () => {
  it('stores opaque records, returns changes since a seq, keeps deletions as tombstones', async () => {
    const { call } = setup();
    await call('PUT', `/v1/vaults/${VAULT}`);
    const k1 = 'r'.repeat(43), k2 = 's'.repeat(43);
    const { seq } = await (await call('POST', `/v1/vaults/${VAULT}/records`, { records: [{ k: k1, v: 'AAAA' }, { k: k2, v: 'BBBB' }] })).json() as { seq: number };
    const all = await (await call('GET', `/v1/vaults/${VAULT}/records?since=0`)).json() as { records: { k: string; v: string | null; seq: number }[]; seq: number };
    expect(all.records.map((r) => r.k)).toEqual([k1, k2]);
    expect(all.seq).toBe(seq);
    await call('POST', `/v1/vaults/${VAULT}/records`, { records: [{ k: k1, v: null }] });
    const after = await (await call('GET', `/v1/vaults/${VAULT}/records?since=${seq}`)).json() as typeof all;
    expect(after.records).toEqual([{ k: k1, v: null, seq: seq + 1 }]);
    const nothing = await (await call('GET', `/v1/vaults/${VAULT}/records?since=${after.seq}`)).json() as typeof all;
    expect(nothing).toEqual({ records: [], more: false, seq: after.seq });
  });

  it('rejects bad keys, non-base64 values and an over-quota vault', async () => {
    const { call } = setup({ limits: { vaultBytes: 10 } });
    await call('PUT', `/v1/vaults/${VAULT}`);
    expect((await call('POST', `/v1/vaults/${VAULT}/records`, { records: [{ k: 'short', v: 'AAAA' }] })).status).toBe(400);
    expect((await call('POST', `/v1/vaults/${VAULT}/records`, { records: [{ k: 'r'.repeat(43), v: '{"plain":1}' }] })).status).toBe(400);
    expect((await call('POST', `/v1/vaults/${VAULT}/records`, { records: [{ k: 'r'.repeat(43), v: 'A'.repeat(12) }] })).status).toBe(507);
  });

  it('vaults do not see each other', async () => {
    const { call } = setup();
    const other = 'c'.repeat(32);
    await call('PUT', `/v1/vaults/${VAULT}`);
    await call('PUT', `/v1/vaults/${other}`, undefined, 'z'.repeat(43));
    await call('POST', `/v1/vaults/${VAULT}/records`, { records: [{ k: 'r'.repeat(43), v: 'AAAA' }] });
    const r = await (await call('GET', `/v1/vaults/${other}/records`, undefined, 'z'.repeat(43))).json() as { records: unknown[] };
    expect(r.records).toEqual([]);
  });
});

describe('photo', () => {
  it('needs a vault, a JPEG and an API key; returns the recognizer result', async () => {
    let seen: unknown;
    const { call } = setup({ recognize: async (input) => { seen = input; return RESULT; } });
    await call('PUT', `/v1/vaults/${VAULT}`);
    expect((await call('POST', `/v1/vaults/${'d'.repeat(32)}/photo`, { image: JPEG })).status).toBe(404);
    expect((await call('POST', `/v1/vaults/${VAULT}/photo`, { image: Buffer.from('GIF89a').toString('base64') })).status).toBe(400);
    const r = await call('POST', `/v1/vaults/${VAULT}/photo`, { image: JPEG, foods: ['Яйце куряче варене'], dishes: [] });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(RESULT);
    expect(seen).toEqual({ image: JPEG, foods: ['Яйце куряче варене'], dishes: [] });
  });

  it('is off without a recognizer, 422 on refusal, limited per day', async () => {
    const off = setup();
    await off.call('PUT', `/v1/vaults/${VAULT}`);
    expect((await off.call('POST', `/v1/vaults/${VAULT}/photo`, { image: JPEG })).status).toBe(503);

    const refused = setup({ recognize: async () => 'refused' });
    await refused.call('PUT', `/v1/vaults/${VAULT}`);
    expect((await refused.call('POST', `/v1/vaults/${VAULT}/photo`, { image: JPEG })).status).toBe(422);

    const limited = setup({ recognize: async () => RESULT, limits: { photosPerVaultPerDay: 1 } });
    await limited.call('PUT', `/v1/vaults/${VAULT}`);
    expect((await limited.call('POST', `/v1/vaults/${VAULT}/photo`, { image: JPEG })).status).toBe(200);
    expect((await limited.call('POST', `/v1/vaults/${VAULT}/photo`, { image: JPEG })).status).toBe(429);
  });

  it('upstream errors are 502 without details', async () => {
    const { call } = setup({ recognize: async () => { throw new Error('boom'); } });
    await call('PUT', `/v1/vaults/${VAULT}`);
    const r = await call('POST', `/v1/vaults/${VAULT}/photo`, { image: JPEG });
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ error: 'upstream' });
  });
});

describe('cors', () => {
  it('allows the app origin only', async () => {
    const { store } = setup();
    const app = createApp({ store, origins: ['https://protocol.test'] });
    const ok = await app.request('/health', { headers: { Origin: 'https://protocol.test' } });
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('https://protocol.test');
    const no = await app.request('/health', { headers: { Origin: 'https://evil.test' } });
    expect(no.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('menu', () => {
  const MENU = { meals: [{ title: 'Сніданок' as const, time: '08:00', items: [{ name: 'Яйце варене', grams: 100, count: 2 }] }], tips: ['Зваріть яйця звечора'] };

  it('passes cleaned input to the maker and returns its menu', async () => {
    const store = new Store(':memory:');
    let seen: unknown;
    const app = createApp({ store, origins: [], menu: async (input) => { seen = input; return MENU; } });
    const call = (body: unknown) => app.request(`/v1/vaults/${VAULT}/menu`, { method: 'POST',
      headers: { Authorization: `Bearer ${AUTH}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await app.request(`/v1/vaults/${VAULT}`, { method: 'PUT', headers: { Authorization: `Bearer ${AUTH}` } });
    expect((await call({ date: 'завтра', foods: ['Яйце варене'] })).status).toBe(400);
    expect((await call({ date: '2026-10-08', foods: [] })).status).toBe(400);
    const r = await call({ date: '2026-10-08', foods: ['Яйце варене', 7], dishes: ['Вінегрет'], rules: ['Без смаженого'],
      targets: { kcal: 2100, lastMealBy: '20:00', 'bad key': 1, note: 'ignore me' }, usual: [], wish: 'без риби' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(MENU);
    expect(seen).toEqual({ date: '2026-10-08', targets: { kcal: 2100, lastMealBy: '20:00' }, rules: ['Без смаженого'],
      foods: ['Яйце варене'], dishes: ['Вінегрет'], usual: [], wish: 'без риби' });
  });

  it('is off without a key', async () => {
    const { call } = setup();
    await call('PUT', `/v1/vaults/${VAULT}`);
    expect((await call('POST', `/v1/vaults/${VAULT}/menu`, { date: '2026-10-08', foods: ['Яйце'] })).status).toBe(503);
  });
});
