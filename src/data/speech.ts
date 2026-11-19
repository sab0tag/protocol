// D95: speech to text by the browser itself (Web Speech API): Chrome / Android — Google's service, Safari / iPhone —
// Apple's. The sound goes to them, not to our server; the app keeps only the text it shows. No support or no network —
// the window says so and the same text can be typed (the reading is local).
import { endsWithStop, withoutStop } from '../domain/foodSearch';
import { newWords } from '../domain/voice';
import { speechState, speechKey } from '../sync/api';
import { listenSoniox, type ListenHandlers } from './speechSoniox';
import { profileKey } from './profiles';

// D173: which engine. The new consent for Soniox (PR 3) and the person's choice live on this device; whether the server gives
// a key is asked once a session (and again after an hour); three Soniox failures in a row — an hour on the phone's engine.
export const SONIOX_CONSENT = 'protocol.sonioxConsent', VOICE_ENGINE = 'protocol.voiceEngine';
const COOL = 'protocol.sonioxCoolUntil';
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const save = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
let server: { available: boolean; id: string; at: number } | null = null, failures = 0;
export async function refreshSpeech(): Promise<{ available: boolean; id: string; at: number } | null> {
  try {
    const { currentKeys } = await import('../sync/runner');
    const s = await speechState(currentKeys() ?? null);
    server = { available: s.available, id: s.id, at: Date.now() };
  } catch { server = { available: false, id: '', at: Date.now() }; }
  return server;
}
/** Soniox could be used here now — the server gives this device a key, the person did not choose «Телефон», no cool-down. */
function sonioxOffered(): boolean {
  if (server && Date.now() - server.at > 3_600_000) { void refreshSpeech(); }
  return read(VOICE_ENGINE) !== 'phone' && !!server?.available && Date.now() >= Number(read(COOL) ?? 0);
}
export function sonioxReady(): boolean { return sonioxOffered() && read(SONIOX_CONSENT) === 'yes'; }

// D174 (Soniox, PR 3): which consent the first tap of a microphone asks. Soniox's is its own (the D95 one does not carry over);
// the phone's engine keeps D95. «Так» starts the recording from that same tap (the AudioContext must be made in the gesture).
const D95_KEY = () => profileKey('protocol.voice.ok');
export type VoiceConsent = 'ok' | 'soniox' | 'browser';
export function voiceConsent(): VoiceConsent {
  if (sonioxOffered()) return read(SONIOX_CONSENT) === 'yes' ? 'ok' : 'soniox';
  return read(D95_KEY()) === '1' ? 'ok' : 'browser';
}
export function giveVoiceConsent(kind: Exclude<VoiceConsent, 'ok'>) { if (kind === 'soniox') save(SONIOX_CONSENT, 'yes'); else save(D95_KEY(), '1'); }
/** «Ще → Налаштування → Голос»: the person's choice; «Телефон» is never overridden by the server */
export const voiceEngineChoice = (): 'phone' | 'soniox' => (read(VOICE_ENGINE) === 'phone' ? 'phone' : 'soniox');
export const setVoiceEngineChoice = (v: 'phone' | 'soniox') => save(VOICE_ENGINE, v);
/** the engine of the last recording that gave text — written on a meal said aloud (`voiceEngine`), for the pilot's measure */
let lastEngine: 'soniox' | 'browser' = 'browser';
export const lastVoiceEngine = () => lastEngine;
/** what a meal record said aloud carries about its engine (D174) */
export const voiceMark = (): { voiceEngine?: 'soniox' } => (lastEngine === 'soniox' ? { voiceEngine: 'soniox' } : {});
/** for the settings switch (PR 3): the server's answer as last seen */
export const speechServer = () => server;
type Rec = { lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number; start(): void; stop(): void; abort(): void
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null };
type Ctor = new () => Rec;

const ctor = (): Ctor | undefined => {
  const w = globalThis as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};
export const speechSupported = () => !!ctor() || sonioxReady();

export type SpeechError = 'no-support' | 'network' | 'not-allowed' | 'no-speech' | 'other';
export type { ListenHandlers };

/** Listen once (until a pause, or «це все» at the end — D105): the words as they come (`interim`), then the final text
 *  without the stop words. Returns stop(). Safari on iPhone often ends without ever marking a result final — then the
 *  last words heard are the text (they were shown and never reached the draft, D105). */
export function listen(on: ListenHandlers, before: string[] = [], opts: { tap?: boolean } = {}): () => void {
  // D173: Soniox when the person agreed to it, did not choose the phone's engine, and the server gives this device a key now.
  // D174: only from a tap — a recording started by itself (a shortcut's auto-start) has no gesture, and iPhone would keep its
  // audio suspended; it goes to the phone's engine.
  if (opts.tap !== false && sonioxReady()) return listenSoniox({ ...on, final: (t, h) => { lastEngine = 'soniox'; on.final(t, h); } }, before, { key: async () => speechKey((await import('../sync/runner')).currentKeys() ?? null),
    fallback: browserListen, fallbackAllowed: () => read(profileKey('protocol.voice.ok')) === '1' /* D95 */, outcome: (ok) => { failures = ok ? 0 : failures + 1; if (failures >= 3) { failures = 0; save(COOL, String(Date.now() + 3_600_000)); } } });
  if (server === null) void refreshSpeech();
  return browserListen({ ...on, final: (t, h) => { lastEngine = 'browser'; on.final(t, h); } }, before);
}

/** The browser's own engine (D95) — Google on Android, Apple on iPhone. */
function browserListen(on: ListenHandlers, before: string[] = []): () => void {
  const C = ctor();
  if (!C) { on.error('no-support'); on.end(); return () => undefined; }
  const r = new C();
  r.lang = 'uk-UA'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
  let done = '', last = '', stopped = false;
  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i]!;
      if (res.isFinal) done += res[0]!.transcript; else interim += res[0]!.transcript;
    }
    last = newWords((done + interim).trim(), before); // D107: a recogniser may hand back what was heard before, glued on
    on.interim(withoutStop(last));
    if (!stopped && endsWithStop(last)) { stopped = true; try { r.stop(); } catch { /* already stopping */ } }
  };
  r.onerror = (e) => on.error(e.error === 'network' ? 'network' : e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'not-allowed' : e.error === 'no-speech' ? 'no-speech' : 'other');
  r.onend = () => { const heard = done.trim() ? newWords(done.trim(), before) : last; const text = withoutStop(heard); if (text) on.final(text, heard); on.end(); };
  try { r.start(); } catch { on.error('other'); on.end(); }
  return () => { try { r.stop(); } catch { /* already stopped */ } };
}
