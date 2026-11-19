import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listenSoniox, MAX_MS, NO_SPEECH_MS, SILENCE_MS, SONIOX_URL, type SonioxEnv } from '../../src/data/speechSoniox';
import { speechContext } from '../../src/data/speechContext';
import { COMMON_MEDS } from '../../src/data/commonMeds';

// D173 (Soniox, PR 2): the engine's stops, its end of stream, its fallback and its hints — with a fake socket and microphone.
class FakeSocket {
  readyState = 0; sent: unknown[] = []; closed = false;
  onopen: ((e: unknown) => void) | null = null; onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null; onclose: ((e: unknown) => void) | null = null;
  constructor(readonly url: string, readonly protocols: string[]) {}
  send(d: unknown) { this.sent.push(d); }
  close() { this.closed = true; this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.({}); }
  say(tokens: { text: string; is_final?: boolean }[], finished = false) { this.onmessage?.({ data: JSON.stringify({ tokens, ...(finished ? { finished: true } : {}) }) }); }
}

function rig(over: Partial<{ key: () => Promise<{ key: string; model: string; maxSeconds: number }>; mic: () => Promise<MediaStream>; d95: boolean; fallback: () => () => void }> = {}) {
  const sockets: FakeSocket[] = [];
  let hidden: (() => void) | null = null;
  const track = { stop: vi.fn() };
  const audio = { stop: vi.fn(), made: vi.fn() };
  let chunk: ((b: ArrayBuffer) => void) | null = null;
  const hiddenAt = vi.fn();
  const env: SonioxEnv = {
    socket: (url, protocols) => { const s = new FakeSocket(url, protocols); sockets.push(s); return s as never; },
    microphone: over.mic ?? (async () => ({ getTracks: () => [track] }) as unknown as MediaStream),
    audio: () => { audio.made(); return { sampleRate: 48000, attach: (_s: MediaStream, onChunk: (b: ArrayBuffer) => void) => { chunk = onChunk; }, stop: audio.stop }; },
    onHidden: (f) => { hiddenAt(); hidden = f; return () => { hidden = null; }; },
  };
  const on = { interim: vi.fn(), final: vi.fn(), error: vi.fn(), end: vi.fn(), left: vi.fn(), socket: vi.fn() };
  const fallback = vi.fn((on: unknown, _b: string[]) => (over.fallback ? (over.fallback as (o: unknown) => () => void)(on) : () => undefined));
  const outcome = vi.fn();
  const key = vi.fn(over.key ?? (async () => ({ key: 'snx_temp_x', model: 'stt-rt-v6', maxSeconds: 60 })));
  const stop = listenSoniox(on, [], { key, fallback, fallbackAllowed: () => over.d95 ?? true, outcome, env });
  return { sockets, on, fallback, outcome, stop, track, audio, key, hiddenAt, hide: () => hidden?.(), sound: () => chunk?.(new ArrayBuffer(8)) };
}
const tick = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms); };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('the connection', () => {
  it('the key as the subprotocol, a config with the languages and the common hints, then raw PCM', async () => {
    const r = rig(); await tick();
    const ws = r.sockets[0]!;
    expect(ws.url).toBe(SONIOX_URL);
    expect(ws.protocols).toEqual(['soniox-api-key', 'snx_temp_x']);
    r.sound(); // before open — kept
    ws.open();
    const config = JSON.parse(ws.sent[0] as string);
    expect(config).toMatchObject({ model: 'stt-rt-v6', audio_format: 'pcm_s16le', sample_rate: 48000, num_channels: 1, language_hints: ['uk', 'ru'], enable_endpoint_detection: true });
    expect(config.api_key).toBeUndefined(); // never in a message
    expect(ws.sent[1]).toBeInstanceOf(ArrayBuffer);
  });

  it('the sound said while the key is still coming is kept and goes right after the config, in order (D186)', async () => {
    let release!: () => void;
    const r = rig({ key: () => new Promise((ok) => { release = () => ok({ key: 'snx_temp_x', model: 'stt-rt-v6', maxSeconds: 60 }); }) });
    await tick(); // the microphone is on, the key is not here yet
    r.sound(); r.sound(); // «На сніданок…» — said at «Слухаю…»
    expect(r.sockets).toHaveLength(0);
    release(); await tick();
    r.sound();
    const ws = r.sockets[0]!; ws.open();
    expect(typeof ws.sent[0]).toBe('string'); // the config first
    expect(ws.sent.slice(1).filter((x) => x instanceof ArrayBuffer)).toHaveLength(3);
  });
  it('no microphone — not-allowed, and no key asked for', async () => {
    const r = rig({ mic: async () => { throw new Error('denied'); } }); await tick();
    expect(r.on.error).toHaveBeenCalledWith('not-allowed');
    expect(r.key).not.toHaveBeenCalled();
    expect(r.on.end).toHaveBeenCalled();
  });
});

describe('in the tap itself (iPhone)', () => {
  it('the audio context and the watch for the app hidden are made synchronously, before the microphone and the key', () => {
    let release!: () => void;
    const r = rig({ key: () => new Promise((ok) => { release = () => ok({ key: 'snx_temp_x', model: 'stt-rt-v6', maxSeconds: 60 }); }) });
    expect(r.audio.made).toHaveBeenCalledTimes(1); // no await has happened yet
    expect(r.hiddenAt).toHaveBeenCalledTimes(1);
    expect(r.key).not.toHaveBeenCalled();
    void release;
  });
  it('hidden while the key is still coming — the microphone is released, nothing is opened', async () => {
    let release!: () => void;
    const r = rig({ key: () => new Promise((ok) => { release = () => ok({ key: 'snx_temp_x', model: 'stt-rt-v6', maxSeconds: 60 }); }) });
    await tick(); r.hide(); release(); await tick();
    expect(r.sockets).toHaveLength(0);
    expect(r.track.stop).toHaveBeenCalled();
  });
});

describe('the stops — the stream is ended and the socket closed', () => {
  it('«це все» at the end: at once; the text without the stop words', async () => {
    const r = rig(); await tick(); const ws = r.sockets[0]!; ws.open();
    ws.say([{ text: 'гречка з куркою, це все', is_final: true }]);
    expect(r.audio.stop).toHaveBeenCalled(); expect(r.track.stop).toHaveBeenCalled(); // the microphone off at once
    expect(ws.sent.at(-1)).toBe(''); // the end of the stream: an empty text frame
    ws.say([], true);
    expect(ws.closed).toBe(true);
    expect(r.on.final).toHaveBeenCalledWith('гречка з куркою', 'гречка з куркою, це все');
    expect(r.on.end).toHaveBeenCalledTimes(1);
  });

  it('the socket’s open time is told once, for the experiment’s cost (D175)', async () => {
    const r = rig(); await tick(); const ws = r.sockets[0]!; ws.open();
    ws.say([{ text: 'склянка води', is_final: true }]);
    await tick(1000);
    r.stop(); ws.say([], true);
    expect(r.on.socket).toHaveBeenCalledTimes(1);
    expect(r.on.socket.mock.calls[0]![0]).toBeGreaterThanOrEqual(1000);
  });

  it('silence: 2.5 s after the last word (the socket closed within 3 s even without Soniox’s answer)', async () => {
    const r = rig(); await tick(); const ws = r.sockets[0]!; ws.open();
    ws.say([{ text: 'вівсянка', is_final: false }]);
    await tick(SILENCE_MS - 1); expect(ws.sent.at(-1)).not.toBe('');
    await tick(1); expect(ws.sent.at(-1)).toBe('');
    await tick(1500); expect(ws.closed).toBe(true); // no «finished» came — closed after 1.5 s anyway
    expect(r.on.final).toHaveBeenCalledWith('вівсянка', 'вівсянка');
  });

  it('Soniox’s endpoint <end> stops it too', async () => {
    const r = rig(); await tick(); const ws = r.sockets[0]!; ws.open();
    ws.say([{ text: 'кава', is_final: true }, { text: '<end>', is_final: true }]);
    expect(ws.sent.at(-1)).toBe('');
    expect(r.on.interim).toHaveBeenLastCalledWith('кава');
  });

  it('6 s with no word — no-speech', async () => {
    const r = rig(); await tick(); r.sockets[0]!.open();
    await tick(NO_SPEECH_MS);
    expect(r.on.error).toHaveBeenCalledWith('no-speech');
    expect(r.sockets[0]!.closed).toBe(true);
  });

  it('60 s at most, with «Ще 15 с» at 45 s', async () => {
    const r = rig(); await tick(); const ws = r.sockets[0]!; ws.open();
    for (let s = 0; s < 60; s += 2) { ws.say([{ text: ` слово${s}`, is_final: true }]); await tick(2000); }
    expect(r.on.left).toHaveBeenCalledWith(15);
    expect(ws.sent).toContain('');
    await tick(MAX_MS);
    expect(ws.closed).toBe(true);
  });

  it('the app hidden — the microphone off and the stream ended at once', async () => {
    const r = rig(); await tick(); const ws = r.sockets[0]!; ws.open();
    ws.say([{ text: 'яйце', is_final: true }]);
    r.hide();
    expect(r.track.stop).toHaveBeenCalled(); expect(ws.sent.at(-1)).toBe('');
  });

  it('the microphone button — the same graceful end', async () => {
    const r = rig(); await tick(); const ws = r.sockets[0]!; ws.open();
    ws.say([{ text: 'чай', is_final: true }]);
    r.stop();
    expect(ws.sent.at(-1)).toBe(''); ws.say([], true);
    expect(r.on.final).toHaveBeenCalledWith('чай', 'чай');
  });
});

describe('failures', () => {
  it('without the D95 consent the phone’s engine is never tried: «напишіть текстом», the sound goes nowhere', async () => {
    const r = rig({ key: async () => { throw new Error('speech_off'); }, d95: false }); await tick();
    expect(r.fallback).not.toHaveBeenCalled();
    expect(r.on.error).toHaveBeenCalledWith('other');
    expect(r.on.end).toHaveBeenCalled();
  });
  it('the phone’s engine refusing to start after the waits — the same «напишіть текстом»', async () => {
    const r = rig({ key: async () => { throw new Error('speech_off'); },
      fallback: (on?: unknown) => { const h = on as { error: (e: string) => void; end: () => void }; h.error('not-allowed'); h.end(); return () => undefined; } });
    await tick();
    expect(r.on.error).toHaveBeenCalledWith('other');
  });

  it('no key (503, 429, offline) — once to the browser’s engine, nothing opened', async () => {
    const r = rig({ key: async () => { throw new Error('speech_off'); } }); await tick();
    expect(r.sockets).toHaveLength(0);
    expect(r.fallback).toHaveBeenCalledTimes(1);
    expect(r.outcome).toHaveBeenCalledWith(false);
    expect(r.track.stop).toHaveBeenCalled();
  });

  it('the network drops mid-phrase — the words heard go to the field, the message says why, nothing falls back', async () => {
    const r = rig(); await tick(); const ws = r.sockets[0]!; ws.open();
    ws.say([{ text: 'суп овочевий', is_final: true }]);
    ws.readyState = 3; ws.onclose?.({});
    expect(r.on.final).toHaveBeenCalledWith('суп овочевий', 'суп овочевий');
    expect(r.on.error).toHaveBeenCalledWith('network');
    expect(r.fallback).not.toHaveBeenCalled();
  });

  it('a Soniox error before any word — to the browser’s engine once', async () => {
    const r = rig(); await tick(); const ws = r.sockets[0]!; ws.open();
    ws.onmessage?.({ data: JSON.stringify({ error_code: 503, error_type: 'unavailable', error_message: 'x' }) });
    expect(r.fallback).toHaveBeenCalledTimes(1);
  });
});

describe('the hints', () => {
  it('common medicines, commands, foods — never the person’s plan; within Soniox’s context limit', () => {
    const c = speechContext();
    expect(c.terms).toContain('метформін');
    expect(c.terms).toContain('це все');
    expect(c.terms.length).toBeGreaterThan(200);
    expect(c.terms.join(', ').length).toBeLessThan(10_000);
    // a medicine from a personal plan that is not on the common list never goes along — the hints take no plan at all
    const personal = 'Фенспірид-Синтетичний';
    expect(COMMON_MEDS).not.toContain(personal);
    expect(JSON.stringify(c)).not.toContain(personal);
    expect(speechContext.length).toBeLessThanOrEqual(1); // its only input is the size budget
  });
});
