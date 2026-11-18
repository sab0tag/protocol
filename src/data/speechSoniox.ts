// D173 (Soniox, PR 2): the same listen() contract as the browser's engine (speech.ts), with Soniox real-time recognition.
// The phone asks our server for a temporary key (one recording, single use, Soniox itself ends the stream at 60 s), opens the
// WebSocket with the key as its subprotocol, and sends raw 16-bit PCM from the microphone (Safari records mp4, which Soniox
// does not take). Nothing is written by itself: the words go to the field, the person writes them (D162).
// Stops — whichever comes first: «це все» at the end (D105); 2.5 s of silence after the last word (Soniox's endpoint, or our
// timer); 6 s with no speech at all (no-speech); 60 s of recording; the microphone button, leaving the page, the app hidden.
// On any stop: the microphone is released at once, the stream gets its end, up to 1.5 s waits for the final words, the
// socket closes — a stream is billed while it is open. A failure before any word was heard falls back once to the browser.
import { endsWithStop, withoutStop } from '../domain/foodSearch';
import { newWords } from '../domain/voice';
import type { SpeechError } from './speech';
import { LANGUAGE_HINTS, speechContext } from './speechContext';

export const SONIOX_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';
export const SILENCE_MS = 2_500, NO_SPEECH_MS = 6_000, MAX_MS = 60_000, WARN_MS = 45_000, DRAIN_MS = 1_500;

export interface ListenHandlers { interim: (text: string) => void; final: (text: string, heard: string) => void; error: (e: SpeechError) => void; end: () => void;
  /** after 45 s — «Ще 15 с», so the stop at 60 s is no surprise */
  left?: (seconds: number) => void }

type Socket = Pick<WebSocket, 'send' | 'close' | 'readyState'> & { onopen: ((e: unknown) => void) | null; onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null; onclose: ((e: unknown) => void) | null };
export interface SonioxEnv {
  socket: (url: string, protocols: string[]) => Socket;
  microphone: () => Promise<MediaStream>;
  /** raw PCM chunks of the microphone, 16-bit little-endian mono; returns the sample rate and a stop() */
  pcm: (stream: MediaStream, onChunk: (b: ArrayBuffer) => void) => { sampleRate: number; stop: () => void };
  onHidden: (f: () => void) => () => void;
}

/** The browser's own pieces; tests pass fakes. */
export const browserEnv = (): SonioxEnv => ({
  socket: (url, protocols) => new WebSocket(url, protocols) as unknown as Socket,
  microphone: () => navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }),
  pcm: (stream, onChunk) => {
    const W = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const ctx = new (W.AudioContext ?? W.webkitAudioContext!)();
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = (e) => {
      const f = e.inputBuffer.getChannelData(0), out = new Int16Array(f.length);
      for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i]!)); out[i] = v < 0 ? v * 0x8000 : v * 0x7fff; }
      onChunk(out.buffer);
    };
    src.connect(proc); proc.connect(ctx.destination); // a script processor runs only when connected; it writes nothing out
    return { sampleRate: ctx.sampleRate, stop: () => { proc.onaudioprocess = null; try { src.disconnect(); proc.disconnect(); } catch { /* gone */ } void ctx.close().catch(() => undefined); } };
  },
  onHidden: (f) => {
    const h = () => { if (document.visibilityState === 'hidden') f(); };
    document.addEventListener('visibilitychange', h); window.addEventListener('pagehide', f);
    return () => { document.removeEventListener('visibilitychange', h); window.removeEventListener('pagehide', f); };
  },
});

export interface SonioxDeps {
  key: () => Promise<{ key: string; model: string; maxSeconds: number }>;
  /** the browser's engine — tried once when Soniox fails before any word was heard */
  fallback: (on: ListenHandlers, before: string[]) => () => void;
  /** a failure of Soniox (for «three in a row — an hour on the phone's engine») or a success */
  outcome?: (ok: boolean) => void;
  env?: SonioxEnv;
}

export function listenSoniox(on: ListenHandlers, before: string[], deps: SonioxDeps): () => void {
  const env = deps.env ?? browserEnv();
  let ws: Socket | null = null, mic: MediaStream | null = null, audio: { stop: () => void } | null = null;
  let unhide: () => void = () => undefined;
  let finals = '', partial = '', closing = false, ended = false, heardAny = false, fellBack = false, stopFallback: (() => void) | null = null;
  const timers: ReturnType<typeof setTimeout>[] = [];
  let silence: ReturnType<typeof setTimeout> | undefined;
  const queue: ArrayBuffer[] = [];
  const heard = () => newWords(`${finals}${partial}`.trim(), before); // D107: what came before, glued on, is cut off

  const release = () => { audio?.stop(); audio = null; mic?.getTracks().forEach((t) => t.stop()); mic = null; unhide(); for (const t of timers) clearTimeout(t); clearTimeout(silence); };
  const finish = (err?: SpeechError) => {
    if (ended) return;
    ended = true; release();
    try { ws?.close(); } catch { /* closed */ }
    const said = heard(), text = withoutStop(said);
    if (text) on.final(text, said);
    if (err && !(err === 'no-speech' && text)) on.error(err);
    on.end();
  };
  /** Ends the stream gracefully: the microphone off now, the end frame to Soniox, then the final words or 1.5 s. */
  const stop = () => {
    if (closing || ended) return;
    closing = true; release();
    if (ws && ws.readyState === 1) { try { ws.send(''); } catch { /* closed */ } timers.push(setTimeout(() => finish(), DRAIN_MS)); }
    else finish();
  };
  const fallBack = (err: SpeechError) => {
    deps.outcome?.(false);
    if (heardAny || fellBack) { finish(err); return; } // the words heard stay — they go to the field, nothing is written
    fellBack = true; ended = true; release();
    try { ws?.close(); } catch { /* closed */ }
    stopFallback = deps.fallback(on, before);
  };
  const wordsChanged = () => {
    heardAny = true;
    on.interim(withoutStop(heard()));
    if (endsWithStop(heard())) { stop(); return; }
    clearTimeout(silence); silence = setTimeout(stop, SILENCE_MS);
  };

  void (async () => {
    try { mic = await env.microphone(); } catch { on.error('not-allowed'); ended = true; on.end(); return; }
    if (ended || closing) { release(); return; }
    let k: Awaited<ReturnType<SonioxDeps['key']>>;
    try { k = await deps.key(); } catch { fallBack('network'); return; }
    if (ended || closing) { release(); return; }
    audio = env.pcm(mic, (b) => { if (closing || ended) return; if (ws?.readyState === 1) ws.send(b); else if (queue.length < 200) queue.push(b); });
    const sampleRate = (audio as { sampleRate?: number }).sampleRate ?? 48_000;
    unhide = env.onHidden(stop);
    timers.push(setTimeout(() => { if (!heardAny) finish('no-speech'); }, NO_SPEECH_MS));
    timers.push(setTimeout(() => on.left?.(Math.round((MAX_MS - WARN_MS) / 1000)), WARN_MS));
    timers.push(setTimeout(stop, Math.min(MAX_MS, k.maxSeconds * 1000)));
    try { ws = env.socket(SONIOX_URL, ['soniox-api-key', k.key]); } catch { fallBack('network'); return; }
    ws.onopen = () => {
      ws!.send(JSON.stringify({ model: k.model, audio_format: 'pcm_s16le', sample_rate: sampleRate, num_channels: 1,
        language_hints: LANGUAGE_HINTS, context: speechContext(), enable_endpoint_detection: true, max_endpoint_delay_ms: SILENCE_MS }));
      for (const b of queue.splice(0)) ws!.send(b);
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      let m: { tokens?: { text: string; is_final?: boolean }[]; finished?: boolean; error_code?: number };
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.error_code) { fallBack('network'); return; } // Soniox closes after an error; the words heard stay
      const was = heard();
      let endpoint = false, next = '';
      for (const t of m.tokens ?? []) {
        if (t.text === '<end>' || t.text === '<fin>') { endpoint = true; continue; }
        if (t.is_final) finals += t.text; else next += t.text;
      }
      partial = next;
      if (heard() !== was && heard()) wordsChanged();
      if (m.finished) { deps.outcome?.(true); finish(); return; }
      if (endpoint && !closing) stop();
    };
    ws.onerror = () => { if (!closing && !ended) fallBack('network'); };
    ws.onclose = () => { if (!ended) { if (closing) finish(); else fallBack('network'); } };
  })();

  return () => { if (stopFallback) stopFallback(); else stop(); };
}
