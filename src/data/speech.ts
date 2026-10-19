// D95: speech to text by the browser itself (Web Speech API): Chrome / Android — Google's service, Safari / iPhone —
// Apple's. The sound goes to them, not to our server; the app keeps only the text it shows. No support or no network —
// the window says so and the same text can be typed (the reading is local).
import { endsWithStop, withoutStop } from '../domain/foodSearch';
type Rec = { lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number; start(): void; stop(): void; abort(): void
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null };
type Ctor = new () => Rec;

const ctor = (): Ctor | undefined => {
  const w = globalThis as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};
export const speechSupported = () => !!ctor();

export type SpeechError = 'no-support' | 'network' | 'not-allowed' | 'no-speech' | 'other';

/** Listen once (until a pause, or «це все» at the end — D105): the words as they come (`interim`), then the final text
 *  without the stop words. Returns stop(). Safari on iPhone often ends without ever marking a result final — then the
 *  last words heard are the text (they were shown and never reached the draft, D105). */
export function listen(on: { interim: (text: string) => void; final: (text: string) => void; error: (e: SpeechError) => void; end: () => void }): () => void {
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
    last = (done + interim).trim();
    on.interim(withoutStop(last));
    if (!stopped && endsWithStop(last)) { stopped = true; try { r.stop(); } catch { /* already stopping */ } }
  };
  r.onerror = (e) => on.error(e.error === 'network' ? 'network' : e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'not-allowed' : e.error === 'no-speech' ? 'no-speech' : 'other');
  r.onend = () => { const text = withoutStop(done.trim() || last); if (text) on.final(text); on.end(); };
  try { r.start(); } catch { on.error('other'); on.end(); }
  return () => { try { r.stop(); } catch { /* already stopped */ } };
}
