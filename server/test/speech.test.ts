// D172 (Soniox, PR 1): the temporary key route — who gets a key, the limits, the budget, Soniox's refusals, and that the main
// key is never in a response, a log or an error. Soniox itself is a stub here.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, DEFAULT_LIMITS } from '../src/app.ts';
import { sonioxKeys, speechConfig, speechId, SpeechUpstream, type SpeechKeys } from '../src/speech.ts';
import { Store } from '../src/store.ts';

const VAULT = 'b'.repeat(32), AUTH = 'k'.repeat(43);
const MAIN = 'snx_main_key_never_shown_1234567890';
const TEMP = 'snx_temp_for_one_recording';

function setup(env: Record<string, string>, over: { keys?: SpeechKeys; limits?: Partial<typeof DEFAULT_LIMITS> } = {}) {
  const store = Store.migrated(':memory:');
  const issue = vi.fn(async (ttl: number) => ({ key: TEMP, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() }));
  const config = speechConfig({ SONIOX_API_KEY: MAIN, ...env });
  const app = createApp({ store, origins: ['https://protocol.test'], limits: { ...DEFAULT_LIMITS, ...over.limits },
    ...(config ? { speech: { config, keys: over.keys ?? { issue } } } : {}) });
  const call = (method: string, path: string, auth: string | null = AUTH) => app.request(path, { method,
    headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), Origin: 'https://protocol.test', 'X-Forwarded-For': '1.1.1.1' } });
  return { store, app, call, issue };
}
const logs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); logs.length = 0; });
const capture = () => { for (const k of ['log', 'warn', 'error'] as const) vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { logs.push(a.join(' ')); }); };

describe('who gets a key', () => {
  it('no SONIOX_API_KEY — off: /health says speech false, the route 503', async () => {
    const store = Store.migrated(':memory:');
    const app = createApp({ store, origins: ['https://protocol.test'] });
    expect((await (await app.request('/health')).json()).speech).toBe(false);
    await app.request(`/v1/vaults/${VAULT}`, { method: 'PUT', headers: { Authorization: `Bearer ${AUTH}` } });
    const r = await app.request(`/v1/vaults/${VAULT}/speech/key`, { method: 'POST', headers: { Authorization: `Bearer ${AUTH}` } });
    expect(r.status).toBe(503);
    expect(speechConfig({})).toBeUndefined();
  });

  it('browser (the default) — off, nothing asked of Soniox', async () => {
    capture();
    const { call, issue } = setup({});
    await call('PUT', `/v1/vaults/${VAULT}`);
    expect((await call('POST', `/v1/vaults/${VAULT}/speech/key`)).status).toBe(503);
    expect(issue).not.toHaveBeenCalled();
  });

  it('without a token — 401; another origin gets no CORS header', async () => {
    const { call, app } = setup({ SPEECH_ENGINE: 'soniox' });
    await call('PUT', `/v1/vaults/${VAULT}`);
    expect((await call('POST', `/v1/vaults/${VAULT}/speech/key`, null)).status).toBe(401);
    expect((await call('POST', `/v1/vaults/${VAULT}/speech/key`, 'x'.repeat(43))).status).toBe(401);
    expect((await app.request('/v1/device/speech/key', { method: 'POST' })).status).toBe(401);
    const pre = await app.request(`/v1/vaults/${VAULT}/speech/key`, { method: 'OPTIONS', headers: { Origin: 'https://evil.test', 'Access-Control-Request-Method': 'POST' } });
    expect(pre.headers.get('Access-Control-Allow-Origin')).not.toBe('https://evil.test');
  });

  it('soniox-test: only the listed vault; everyone else 403', async () => {
    const { call } = setup({ SPEECH_ENGINE: 'soniox-test', SPEECH_TEST_VAULTS: speechId('c'.repeat(32)) });
    await call('PUT', `/v1/vaults/${VAULT}`);
    expect((await call('POST', `/v1/vaults/${VAULT}/speech/key`)).status).toBe(403);
    const state = await (await call('GET', `/v1/vaults/${VAULT}/speech`)).json();
    expect(state).toEqual({ available: false, id: speechId(VAULT), engine: 'soniox-test' });
    const listed = setup({ SPEECH_ENGINE: 'soniox-test', SPEECH_TEST_VAULTS: speechId(VAULT) });
    await listed.call('PUT', `/v1/vaults/${VAULT}`);
    expect((await listed.call('POST', `/v1/vaults/${VAULT}/speech/key`)).status).toBe(200);
  });
});

describe('the key', () => {
  it('a temporary key for 60–120 s, the model, 60 s at most; not cached; the main key nowhere', async () => {
    capture();
    const { call, issue } = setup({ SPEECH_ENGINE: 'soniox' });
    await call('PUT', `/v1/vaults/${VAULT}`);
    const r = await call('POST', `/v1/vaults/${VAULT}/speech/key`);
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    const body = await r.json() as Record<string, unknown>;
    expect(body).toMatchObject({ key: TEMP, model: 'stt-rt-v6', maxSeconds: 60 });
    expect(issue).toHaveBeenCalledWith(90);
    expect(JSON.stringify(body)).not.toContain(MAIN);
    expect(logs.join('\n')).not.toContain(MAIN);
    expect(logs.join('\n')).not.toContain(TEMP);
    expect(logs.join('\n')).not.toContain(VAULT); // the log names a hash only
    expect(logs.some((l) => l.includes('"speech":"issued"') && l.includes(speechId(VAULT)))).toBe(true);
    const usage = await (await call('GET', `/v1/vaults/${VAULT}/usage`)).json();
    expect(usage.kinds.speech).toBe(1); // «Голос» in the usage, charged as 60 s
    expect(usage.usdMicro).toBe(2000);
  });

  it('the 61st key of the day — 429; the server ceiling too', async () => {
    const { call } = setup({ SPEECH_ENGINE: 'soniox' });
    await call('PUT', `/v1/vaults/${VAULT}`);
    for (let i = 0; i < 60; i++) expect((await call('POST', `/v1/vaults/${VAULT}/speech/key`)).status).toBe(200);
    expect((await call('POST', `/v1/vaults/${VAULT}/speech/key`)).status).toBe(429);
    const all = setup({ SPEECH_ENGINE: 'soniox' }, { limits: { speechAllPerDay: 2 } });
    await all.call('PUT', `/v1/vaults/${VAULT}`);
    await all.call('POST', `/v1/vaults/${VAULT}/speech/key`); await all.call('POST', `/v1/vaults/${VAULT}/speech/key`);
    expect((await all.call('POST', `/v1/vaults/${VAULT}/speech/key`)).status).toBe(429);
  });

  it('the voice budget spent — no key (and the AI budget too)', async () => {
    const voice = setup({ SPEECH_ENGINE: 'soniox', SPEECH_MONTH_USD: '0.004' }); // two keys
    await voice.call('PUT', `/v1/vaults/${VAULT}`);
    expect((await voice.call('POST', `/v1/vaults/${VAULT}/speech/key`)).status).toBe(200);
    expect((await voice.call('POST', `/v1/vaults/${VAULT}/speech/key`)).status).toBe(200);
    const over = await voice.call('POST', `/v1/vaults/${VAULT}/speech/key`);
    expect(over.status).toBe(429);
    expect(voice.issue).toHaveBeenCalledTimes(2);
    const ai = setup({ SPEECH_ENGINE: 'soniox' }, { limits: { aiMonthUsdMicro: 1000 } });
    await ai.call('PUT', `/v1/vaults/${VAULT}`);
    expect((await ai.call('POST', `/v1/vaults/${VAULT}/speech/key`)).status).toBe(429);
  });

  it('Soniox refuses the server key (401/402) — 503 speech_off, no details, voice off for an hour', async () => {
    capture();
    const keys: SpeechKeys = { issue: vi.fn(async () => { throw new SpeechUpstream(402); }) };
    const { call, app } = setup({ SPEECH_ENGINE: 'soniox' }, { keys });
    await call('PUT', `/v1/vaults/${VAULT}`);
    const r = await call('POST', `/v1/vaults/${VAULT}/speech/key`);
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: 'speech_off' });
    expect((await (await app.request('/health')).json()).speech).toBe(false);
    expect((await call('POST', `/v1/vaults/${VAULT}/speech/key`)).status).toBe(503);
    expect(keys.issue).toHaveBeenCalledTimes(1); // not asked again within the hour
    expect(logs.join('\n')).not.toContain(MAIN);
  });

  it('a device without sync gets a key the same way', async () => {
    const { app } = setup({ SPEECH_ENGINE: 'soniox' });
    const { token } = await (await app.request('/v1/devices', { method: 'POST', headers: { 'X-Forwarded-For': '203.0.113.5' } })).json() as { token: string };
    const r = await app.request('/v1/device/speech/key', { method: 'POST', headers: { Authorization: `Device ${token}` } });
    expect(r.status).toBe(200);
    expect((await r.json()).key).toBe(TEMP);
  });
});

describe('the Soniox call', () => {
  it('asks for a websocket-only temporary key with the main key in the header, and never echoes an error body', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init!.body))).toEqual({ usage_type: 'transcribe_websocket', expires_in_seconds: 90, single_use: true, max_session_duration_seconds: 60 });
      expect((init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${MAIN}`);
      return new Response(JSON.stringify({ api_key: TEMP, expires_at: '2026-11-18T12:00:00Z' }), { status: 201 });
    });
    expect(await sonioxKeys(MAIN, fetchImpl as typeof fetch).issue(90)).toEqual({ key: TEMP, expiresAt: '2026-11-18T12:00:00Z' });
    const bad = sonioxKeys(MAIN, (async () => new Response(`invalid key ${MAIN}`, { status: 401 })) as typeof fetch);
    const err = await bad.issue(90).catch((e: Error) => e);
    expect(err).toBeInstanceOf(SpeechUpstream);
    expect((err as Error).message).not.toContain(MAIN);
  });
  it('a wrong setting stops the start', () => {
    expect(() => speechConfig({ SONIOX_API_KEY: MAIN, SPEECH_ENGINE: 'on' })).toThrow();
    expect(() => speechConfig({ SONIOX_API_KEY: MAIN, SPEECH_KEY_TTL_S: '600' })).toThrow();
  });
});
