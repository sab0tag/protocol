import { describe, expect, it } from 'vitest';
import { createApp, DEFAULT_LIMITS } from '../src/app.ts';
import type { PhotoResult, Recognizer } from '../src/photo.ts';
import { Store } from '../src/store.ts';
import { ClinicDirectory } from '../src/clinic/directory.ts';
import { PlanDelivery } from '../src/clinic/delivery.ts';
import { DatabaseBusy } from '../src/clinic/tx.ts';

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
    const { call } = setup({ recognize: async (input) => { seen = input; return { result: RESULT, usage: { model: 'claude-opus-5-5', input: 1000, output: 500 } }; } });
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

    const refused = setup({ recognize: async () => ({ result: 'refused' as const }) });
    await refused.call('PUT', `/v1/vaults/${VAULT}`);
    expect((await refused.call('POST', `/v1/vaults/${VAULT}/photo`, { image: JPEG })).status).toBe(422);

    const limited = setup({ recognize: async () => ({ result: RESULT }), limits: { photosPerVaultPerDay: 1 } });
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
    const app = createApp({ store, origins: [], menu: async (input) => { seen = input; return { result: MENU }; } });
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
      foods: ['Яйце варене'], dishes: ['Вінегрет'], usual: [], wish: 'без риби', avoid: [] });
  });

  it('is off without a key', async () => {
    const { call } = setup();
    await call('PUT', `/v1/vaults/${VAULT}`);
    expect((await call('POST', `/v1/vaults/${VAULT}/menu`, { date: '2026-10-08', foods: ['Яйце'] })).status).toBe(503);
  });
});

describe('label (D45)', () => {
  it('a package photo → per 100 g; counted with photos; off without a key', async () => {
    const store = new Store(':memory:');
    const LABEL = { readable: true, name: 'Йогурт грецький 2 %', per100g: { kcal: 73, protein: 9.5, fat: 2, carbs: 3.9, calciumMg: null }, servingG: 140, note: null };
    const app = createApp({ store, origins: [], label: async () => ({ result: LABEL, usage: { model: 'claude-opus-5-5', input: 1500, output: 200 } }),
      limits: { ...DEFAULT_LIMITS, photosPerVaultPerDay: 1 } });
    const H = { Authorization: `Bearer ${AUTH}`, 'Content-Type': 'application/json' };
    await app.request(`/v1/vaults/${VAULT}`, { method: 'PUT', headers: H });
    const r = await app.request(`/v1/vaults/${VAULT}/label`, { method: 'POST', headers: H, body: JSON.stringify({ image: JPEG }) });
    expect(await r.json()).toEqual(LABEL);
    expect((await app.request(`/v1/vaults/${VAULT}/label`, { method: 'POST', headers: H, body: JSON.stringify({ image: JPEG }) })).status).toBe(429);
    const off = createApp({ store: new Store(':memory:'), origins: [] });
    await off.request(`/v1/vaults/${VAULT}`, { method: 'PUT', headers: H });
    expect((await off.request(`/v1/vaults/${VAULT}/label`, { method: 'POST', headers: H, body: JSON.stringify({ image: JPEG }) })).status).toBe(503);
  });
});

describe('workout (D63)', () => {
  const RESULT = { exercises: [{ id: 'goblet-squat', sets: 3, reps: 12, seconds: null }], advice: 'Присід двічі із запасом — сьогодні по 12.' };
  const EX = (id: string, level = 1) => ({ id, name: id, level, pattern: 'squat', unilateral: false, timed: false });

  it('passes cleaned input to the maker; needs 3+ exercises; off without a key', async () => {
    const store = new Store(':memory:');
    let seen: unknown;
    const app = createApp({ store, origins: [], workout: async (input) => { seen = input; return { result: RESULT }; } });
    const call = (body: unknown) => app.request(`/v1/vaults/${VAULT}/workout`, { method: 'POST',
      headers: { Authorization: `Bearer ${AUTH}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await app.request(`/v1/vaults/${VAULT}`, { method: 'PUT', headers: { Authorization: `Bearer ${AUTH}` } });
    expect((await call({ exercises: [EX('a'), EX('b')] })).status).toBe(400);
    const r = await call({ exercises: [EX('goblet-squat'), EX('swing', 2), EX('goblet-squat'), EX('row'), EX('Bad Id'), { id: 'x', name: 'x', level: 7 }],
      history: [{ date: '2026-10-12', feeling: 'Легко', items: ['Гоблет-присід: 12 · 12 · 12'] }, { date: 'вчора', items: [] }],
      rules: ['Без смаженого'], minutes: 500, wish: 'коротко' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(RESULT);
    expect(seen).toEqual({ exercises: [EX('goblet-squat'), EX('swing', 2), EX('row')], history: [{ date: '2026-10-12', feeling: 'Легко', items: ['Гоблет-присід: 12 · 12 · 12'] }],
      rules: ['Без смаженого'], equipment: 'Гиря 16 кг', minutes: 90, wish: 'коротко' });
    const off = createApp({ store, origins: [] });
    expect((await off.request(`/v1/vaults/${VAULT}/workout`, { method: 'POST', headers: { Authorization: `Bearer ${AUTH}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ exercises: [EX('a'), EX('b'), EX('c')] }) })).status).toBe(503);
  });
});

describe('labs (D68)', () => {
  it('a results form → values; the names known go along; counted with photos; off without a key', async () => {
    const store = new Store(':memory:');
    let names: string[] = [];
    const RES = { readable: true, date: '2026-10-10', items: [{ name: 'Феритин', value: 310, unit: 'нг/мл', reference: '30–400' }], note: null };
    const app = createApp({ store, origins: [], labs: async (_img, n) => { names = n; return { result: RES }; },
      limits: { ...DEFAULT_LIMITS, photosPerVaultPerDay: 1 } });
    const call = (body: unknown) => app.request(`/v1/vaults/${VAULT}/labs`, { method: 'POST',
      headers: { Authorization: `Bearer ${AUTH}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await app.request(`/v1/vaults/${VAULT}`, { method: 'PUT', headers: { Authorization: `Bearer ${AUTH}` } });
    const r = await call({ image: JPEG, names: ['Феритин', 3, ''] });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(RES);
    expect(names).toEqual(['Феритин']);
    expect((await call({ image: JPEG })).status).toBe(429);
    const off = createApp({ store: new Store(':memory:'), origins: [] });
    await off.request(`/v1/vaults/${VAULT}`, { method: 'PUT', headers: { Authorization: `Bearer ${AUTH}` } });
    expect((await off.request(`/v1/vaults/${VAULT}/labs`, { method: 'POST', headers: { Authorization: `Bearer ${AUTH}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: JPEG }) })).status).toBe(503);
  });
});

describe('a doctor’s conclusion (D80)', () => {
  it('a photo → a draft of the plan; counted with photos; off without a key', async () => {
    const store = new Store(':memory:');
    const RES = { readable: true, date: '2026-10-12', doctor: 'Ендокринолог', note: null, tests: ['Глюкоза натще'], nextVisit: '2026-12-10',
      constraints: [{ tag: 'glycemic', title: 'Предіабет', reason: 'Без солодкого', allergens: [] }],
      prescriptions: [{ kind: 'supplement', title: 'Вітамін D3', dose: '2000 МО', times: [], frequency: '1 раз на день', withFood: true }],
      targets: { kcal: null, proteinG: null, carbsMaxG: null, fatG: null, waterMl: 2000, lastMealBy: null, weightGoalKg: null, maxWeightLossKgPerWeek: null } };
    const app = createApp({ store, origins: [], conclusion: async () => ({ result: RES as never }), limits: { ...DEFAULT_LIMITS, photosPerVaultPerDay: 1 } });
    const call = (body: unknown) => app.request(`/v1/vaults/${VAULT}/conclusion`, { method: 'POST',
      headers: { Authorization: `Bearer ${AUTH}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await app.request(`/v1/vaults/${VAULT}`, { method: 'PUT', headers: { Authorization: `Bearer ${AUTH}` } });
    expect((await call({ image: 'not base64!' })).status).toBe(400);
    const r = await call({ image: JPEG });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(RES);
    expect((await call({ image: JPEG })).status).toBe(429);
    const off = createApp({ store: new Store(':memory:'), origins: [] });
    await off.request(`/v1/vaults/${VAULT}`, { method: 'PUT', headers: { Authorization: `Bearer ${AUTH}` } });
    expect((await off.request(`/v1/vaults/${VAULT}/conclusion`, { method: 'POST', headers: { Authorization: `Bearer ${AUTH}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: JPEG }) })).status).toBe(503);
  });
});

describe('a medicine package (D89)', () => {
  it('a photo → name and strength; counted with photos; off without a key', async () => {
    const store = new Store(':memory:');
    const RES = { readable: true, name: 'Нурофєн Форте', inn: 'ібупрофен', strength: '400 мг', form: 'таблетки', note: null };
    const app = createApp({ store, origins: [], medbox: async () => ({ result: RES }), limits: { ...DEFAULT_LIMITS, photosPerVaultPerDay: 1 } });
    const call = (body: unknown) => app.request(`/v1/vaults/${VAULT}/medbox`, { method: 'POST',
      headers: { Authorization: `Bearer ${AUTH}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await app.request(`/v1/vaults/${VAULT}`, { method: 'PUT', headers: { Authorization: `Bearer ${AUTH}` } });
    const r = await call({ image: JPEG });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(RES);
    expect((await call({ image: JPEG })).status).toBe(429);
    const off = createApp({ store: new Store(':memory:'), origins: [] });
    await off.request(`/v1/vaults/${VAULT}`, { method: 'PUT', headers: { Authorization: `Bearer ${AUTH}` } });
    expect((await off.request(`/v1/vaults/${VAULT}/medbox`, { method: 'POST', headers: { Authorization: `Bearer ${AUTH}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: JPEG }) })).status).toBe(503);
  });
});

describe('the concierge, scenario 1, and its log (D91)', () => {
  const names = ['Пиріжок з капустою печений', 'Пиріжок з картоплею', 'Вареники з картоплею', 'Чай без цукру'];
  const setup = (log = true) => {
    const store = new Store(':memory:');
    let asked = '';
    const app = createApp({ store, origins: [], conciergeModel: 'test-model',
      notFound: async (text) => { asked = text; return { result: { candidates: ['Пиріжок з капустою печений', 'Вигадана страва', 'Пиріжок з картоплею', 'Вареники з картоплею', 'Чай без цукру'] } }; } });
    const call = (path: string, init: RequestInit = {}) => app.request(`/v1/vaults/${VAULT}${path}`, { ...init,
      headers: { Authorization: `Bearer ${AUTH}`, 'Content-Type': 'application/json' } });
    return { store, app, call, asked: () => asked, log };
  };
  it('only names from the base, at most 3; logged only with consent; outcome on the own record; the log seen and deleted', async () => {
    const { call, asked } = setup();
    await call('', { method: 'PUT' });
    const r = await call('/concierge/not-found', { method: 'POST', body: JSON.stringify({ text: 'бабусин пиріжок від Олени', names, log: true, versions: { app: 'x', plan: 'a1b2c3d4' } }) });
    const body = await r.json() as { candidates: string[]; id: string };
    expect(asked()).toBe('бабусин пиріжок від Олени');
    expect(body.candidates).toEqual(['Пиріжок з капустою печений', 'Пиріжок з картоплею', 'Вареники з картоплею']); // the invented one dropped
    expect(body.id).toMatch(/^c-\d{4}-\d{2}-\d{2}-[0-9a-f]{6}$/);
    expect((await (await call('/concierge/outcome', { method: 'POST', body: JSON.stringify({ id: body.id, outcome: 'edited', edit: { field: 'grams', from: 80, to: 120 } }) })).json())).toEqual({ ok: true });
    expect((await call('/concierge/outcome', { method: 'POST', body: JSON.stringify({ id: body.id, outcome: 'whatever' }) })).status).toBe(400);
    const log = await (await call('/concierge/log')).json() as { outcome: string; checker: { from_db: boolean }; versions: { model: string; plan: string }; user: string }[];
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ outcome: 'edited', checker: { from_db: false }, versions: { model: 'test-model', plan: 'a1b2c3d4' } });
    expect(log[0]!.user).toMatch(/^p-[0-9a-f]{4}$/);
    const none = await call('/concierge/not-found', { method: 'POST', body: JSON.stringify({ text: 'пиріжок', names }) });
    expect((await none.json() as { id?: string }).id).toBeUndefined(); // no consent — nothing written
    expect(await (await call('/concierge/log', { method: 'DELETE' })).json()).toEqual({ deleted: 1 });
  });
  it('the weekly export: a label instead of the vault, names replaced; kept 30 days', async () => {
    const { conciergeHousekeeping, isoWeek } = await import('../src/conciergeLog.ts');
    const { scrubNames } = await import('../src/concierge.ts');
    const { mkdtempSync, readFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    expect(scrubNames('бабусин пиріжок від Олени. Олена пекла з ЩД')).toBe('бабусин пиріжок від [ім’я]. Олена пекла з ЩД');
    expect(isoWeek(new Date('2026-10-18T12:00:00Z')).slice(0, 2)).toEqual([2026, 42]);
    const store = new Store(':memory:');
    const tuesday = Date.parse('2026-10-13T10:00:00Z');
    store.logConcierge('c-1', VAULT, tuesday, 'not_found', { id: 'c-1', input: 'пиріжок від Олени', user: 'x' });
    store.logConcierge('c-old', VAULT, tuesday - 40 * 86_400_000, 'not_found', { id: 'c-old', input: 'старе' });
    const dir = mkdtempSync(`${tmpdir()}/concierge-`);
    const done = conciergeHousekeeping(store, dir, new Date('2026-10-19T09:00:00Z')); // a Monday — last week out
    expect(done.purged).toBe(1);
    const line = JSON.parse(readFileSync(done.exported!, 'utf8').trim()) as { input: string; user: string; outcome: string };
    expect(done.exported).toMatch(/concierge-log-2026-42\.jsonl$/);
    expect(line).toMatchObject({ input: 'пиріжок від [ім’я]', outcome: 'ignored' });
    expect(line.user).toMatch(/^p-[0-9a-f]{4}$/);
    expect(conciergeHousekeeping(store, dir, new Date('2026-10-19T10:00:00Z')).exported).toBeUndefined(); // once a week
  });
});

describe('security review (D94)', () => {
  it('the per-IP limit counts the address the proxy saw, not one the client prepended', async () => {
    const store = new Store(':memory:');
    const app = createApp({ store, origins: [], limits: { ...DEFAULT_LIMITS, vaultsPerIpPerDay: 1 } });
    const put = (vault: string, xff: string) => app.request(`/v1/vaults/${vault}`, { method: 'PUT', headers: { Authorization: `Bearer ${AUTH}`, 'X-Forwarded-For': xff } });
    expect((await put('a'.repeat(32), '1.1.1.1, 203.0.113.9')).status).toBe(201);
    expect((await put('b'.repeat(32), '9.9.9.9, 203.0.113.9')).status).toBe(429); // same real address, a different prefix
  });
  it('text AI has a ceiling for the whole server, across vaults', async () => {
    const store = new Store(':memory:');
    const app = createApp({ store, origins: [], limits: { ...DEFAULT_LIMITS, aiPerDay: 1, vaultsPerIpPerDay: 10 },
      notFound: async () => ({ result: { candidates: [] } }) });
    const ask = async (vault: string) => {
      await app.request(`/v1/vaults/${vault}`, { method: 'PUT', headers: { Authorization: `Bearer ${AUTH}` } });
      return (await app.request(`/v1/vaults/${vault}/concierge/not-found`, { method: 'POST', headers: { Authorization: `Bearer ${AUTH}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'пиріжок', names: ['Млинці'] }) })).status;
    };
    expect(await ask('c'.repeat(32))).toBe(200);
    expect(await ask('d'.repeat(32))).toBe(429);
  });
});

describe('step 0 without sync: a device token (D101)', () => {
  it('a token for a device, its hash kept; a conclusion of several pages read with it; a wrong one refused; a few tokens an address', async () => {
    const store = new Store(':memory:');
    let pages = 0;
    const app = createApp({ store, origins: [], conclusion: async (imgs) => { pages = imgs.length; return { result: { readable: true } as never }; },
      limits: { ...DEFAULT_LIMITS, deviceTokensPerIpPerDay: 2 } });
    const get = () => app.request('/v1/devices', { method: 'POST', headers: { 'X-Forwarded-For': '203.0.113.7' } });
    const r = await get();
    expect(r.status).toBe(201);
    const { token } = await r.json() as { token: string };
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const read = (t: string, body: unknown) => app.request('/v1/device/conclusion', { method: 'POST',
      headers: { Authorization: `Device ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await read(token, { images: [JPEG, JPEG] })).status).toBe(200);
    expect(pages).toBe(2);
    expect((await read('x'.repeat(43), { images: [JPEG] })).status).toBe(401);
    expect((await read(token, { images: [JPEG, JPEG, JPEG, JPEG, JPEG] })).status).toBe(400); // up to 4 pages
    expect((await get()).status).toBe(201);
    expect((await get()).status).toBe(429);
  });
});

describe('a dish described in words (D110)', () => {
  it('read for a device without sync, the base names passed on; empty text refused; its own daily limit', async () => {
    const store = new Store(':memory:');
    let got: { text: string; foods: string[] } | undefined;
    const app = createApp({ store, origins: [], dish: async (x) => { got = x; return { result: { readable: true, name: 'Рол', portions: 1, items: [], note: '' } }; },
      limits: { ...DEFAULT_LIMITS, dishesPerDay: 2 } });
    const { token } = await (await app.request('/v1/devices', { method: 'POST', headers: { 'X-Forwarded-For': '203.0.113.9' } })).json() as { token: string };
    const ask = (body: unknown) => app.request('/v1/device/dish', { method: 'POST', headers: { Authorization: `Device ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await ask({ text: 'лаваш рол зі свининою', foods: ['Цибуля ріпчаста', 'Йогурт грецький 2 %'] })).status).toBe(200);
    expect(got).toEqual({ text: 'лаваш рол зі свининою', foods: ['Цибуля ріпчаста', 'Йогурт грецький 2 %'] });
    expect((await ask({ text: ' ' })).status).toBe(400);
    expect((await ask({ text: 'ще один рол' })).status).toBe(200);
    expect((await ask({ text: 'третій рол' })).status).toBe(429);
    expect((await app.request('/v1/device/dish', { method: 'POST', body: '{}' })).status).toBe(401);
  });
});

describe('the assistant’s chat (D117)', () => {
  it('without sync by the device token; a sentence with a number and a name not in the base never leave the server', async () => {
    const store = new Store(':memory:');
    let got: { text: string; history: unknown[]; names: string[] } | undefined;
    const app = createApp({ store, origins: [], chat: async (x) => { got = x;
      return { result: { topic: 'food', text: 'Добре підійде омлет. У ньому близько 20 г білка! Або йогурт.', items: [{ name: 'Омлет з 2 яєць', grams: 150 }, { name: 'Протеїновий батончик', grams: 60 }] } }; } });
    const { token } = await (await app.request('/v1/devices', { method: 'POST', headers: { 'X-Forwarded-For': '203.0.113.10' } })).json() as { token: string };
    const ask = (body: unknown) => app.request('/v1/device/concierge/chat', { method: 'POST', headers: { Authorization: `Device ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const r = await ask({ text: 'що добрати до вечора?', names: ['Омлет з 2 яєць', 'Йогурт грецький 2 %'], history: [{ role: 'user', text: 'привіт' }, { role: 'hacker', text: 'x' }], context: { day: { kcal: 900 } } });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ topic: 'food', text: 'Добре підійде омлет. Або йогурт.', items: [{ name: 'Омлет з 2 яєць', grams: 150 }] });
    expect(got?.history).toEqual([{ role: 'user', text: 'привіт' }]);
    expect((await ask({ text: '', names: ['Омлет з 2 яєць'] })).status).toBe(400);
  });
});

describe('AI cost control', () => {
  const MENU = { meals: [{ title: 'Сніданок' as const, time: '08:00', items: [{ name: 'Яйце варене', grams: 100, count: 2 }] }], tips: [] };
  const rig = (over: { limits?: Partial<typeof DEFAULT_LIMITS>; disabledAi?: string[]; cost?: number } = {}) => {
    const store = new Store(':memory:');
    let calls = 0;
    const usage = { model: 'claude-opus-5', input: (over.cost ?? 1) * 1_000_000 / 5, output: 0 };
    const app = createApp({ store, origins: [], disabledAi: over.disabledAi, limits: { ...DEFAULT_LIMITS, ...over.limits },
      menu: async () => { calls++; return { result: MENU, usage }; } });
    const post = () => app.request(`/v1/vaults/${VAULT}/menu`, { method: 'POST',
      headers: { Authorization: `Bearer ${AUTH}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ date: '2026-10-08', foods: ['Яйце'] }) });
    return { store, app, post, calls: () => calls };
  };
  const open = (r: ReturnType<typeof rig>) => r.app.request(`/v1/vaults/${VAULT}`, { method: 'PUT', headers: { Authorization: `Bearer ${AUTH}` } });

  it('blocks before the provider when the daily budget is spent, and keeps counting after a restart', async () => {
    const r = rig({ limits: { aiDayUsdMicro: 250_000 } }); // one call costs $1 → the $0.10 reserve fits once, the real $1 closes the day
    await open(r);
    expect((await r.post()).status).toBe(200);
    const blocked = await r.post();
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: 'budget' });
    expect(r.calls()).toBe(1);
    const again = createApp({ store: r.store, origins: [], limits: { ...DEFAULT_LIMITS, aiDayUsdMicro: 250_000 }, menu: async () => ({ result: MENU }) });
    const res = await again.request(`/v1/vaults/${VAULT}/menu`, { method: 'POST', headers: { Authorization: `Bearer ${AUTH}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2026-10-08', foods: ['Яйце'] }) });
    expect(res.status).toBe(429);
  });

  it('parallel requests cannot jointly pass the budget', async () => {
    const r = rig({ limits: { aiDayUsdMicro: 250_000 } });
    await open(r);
    const results = await Promise.all(Array.from({ length: 6 }, () => r.post()));
    expect(results.filter((x) => x.status === 200)).toHaveLength(2);
    expect(r.calls()).toBe(2);
  });

  it('a disabled feature answers ai_off without calling the provider', async () => {
    const r = rig({ disabledAi: ['menu'] });
    await open(r);
    const res = await r.post();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'ai_off' });
    expect(r.calls()).toBe(0);
  });
});

describe('clinic plan redemption', () => {
  const rigPlan = () => {
    const store = new Store(':memory:');
    const dir = new ClinicDirectory(store.database);
    const planDelivery = new PlanDelivery(store.database, dir);
    const org = dir.createOrganization('Клініка', 'Адмін');
    const admin = dir.authenticate(org.token)!;
    const doc = dir.authenticate(dir.addStaff(admin, { displayName: 'Лікар', role: 'doctor' }).token)!;
    const plan = { schemaVersion: 1, planId: crypto.randomUUID(), organizationId: org.orgId, issuedAt: '2025-01-01T10:00:00+02:00',
      clinician: { displayName: 'Лікар', organizationName: 'Клініка' }, title: 'План', medications: [], restrictions: [], tests: [] };
    const { code } = planDelivery.issue(doc, { plan, patientConsent: true });
    const app = createApp({ store, origins: ['https://protocol.test'], planDelivery });
    const redeem = (c: unknown, ip = '1.1.1.1') => app.request('/v1/clinic/plans/redeem', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify({ code: c }),
    });
    return { code, redeem, app, store };
  };
  it('gives the plan once, uncached, then used/409', async () => {
    const { code, redeem } = rigPlan();
    const r = await redeem(code);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(((await r.json()) as { plan: { title: string } }).plan.title).toBe('План');
    const again = await redeem(code);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: 'used' });
  });
  it('a damaged stored plan answers 410 tampered every time, without plan content', async () => {
    const { code, redeem, store } = rigPlan();
    store.database.prepare("UPDATE plan_delivery SET plan = replace(plan, 'План', 'Інший')").run();
    for (let i = 0; i < 2; i++) {
      const r = await redeem(code);
      expect(r.status).toBe(410);
      expect(await r.json()).toEqual({ error: 'tampered' });
    }
  });
  it('a busy database answers 503 database_busy with Retry-After, never 500', async () => {
    const store = new Store(':memory:');
    const busyDelivery = { redeem: () => { throw new DatabaseBusy(); } } as unknown as PlanDelivery;
    const app = createApp({ store, origins: [], planDelivery: busyDelivery });
    const r = await app.request('/v1/clinic/plans/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'x'.repeat(43) }) });
    expect(r.status).toBe(503);
    expect(r.headers.get('retry-after')).toBe('1');
    expect(await r.json()).toEqual({ error: 'database_busy' });
  });
  it('unknown or malformed codes are 404; guessing is rate limited', async () => {
    const { redeem } = rigPlan();
    expect((await redeem('z'.repeat(43))).status).toBe(404);
    expect((await redeem(42)).status).toBe(404);
    for (let i = 0; i < 40; i++) await redeem('z'.repeat(43), '9.9.9.9');
    expect((await redeem('z'.repeat(43), '9.9.9.9')).status).toBe(429);
  });
  it('is off without clinic support', async () => {
    const app = createApp({ store: new Store(':memory:'), origins: [] });
    const r = await app.request('/v1/clinic/plans/redeem', { method: 'POST', body: '{}' });
    expect(r.status).toBe(503);
  });
});
