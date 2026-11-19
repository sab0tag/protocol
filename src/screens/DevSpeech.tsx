// D175 (Soniox, PR 4): `#/dev/speech` — the voice experiment. A corpus phrase, read twice: «Запис 1» and «Запис 2» are the
// two engines in a random order (the reader does not know which is which). Only the text and the times are kept, on this
// phone (localStorage), never sound; «Вивантажити JSON» hands them to scripts/speech-report.ts. Behind `?speechdev=on`.
import { Mic, Square } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { parse } from 'yaml';
import corpusText from '../../tests/fixtures/speech-corpus.yaml?raw';
import { devSpeech } from '../app/devSpeech';
import { SceneHeader } from '../components/SceneHeader';
import { VoiceConsentCard } from '../components/VoiceConsentCard';
import { consentGiven, listen, refreshSpeech, speechServer } from '../data/speech';
import type { CorpusPhrase, Engine, SpeechRun } from '../domain/speechCorpus';
import { t } from '../i18n/uk';
import { platform } from '../sync/pilot';

const L = t.devSpeech;
const RUNS = 'protocol.speechRuns', SETUP = 'protocol.speechSetup';
const CORPUS = parse(corpusText) as CorpusPhrase[];

const load = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? '') as T; } catch { return d; } };
const keep = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const order = (): [Engine, Engine] => (Math.random() < 0.5 ? ['soniox', 'browser'] : ['browser', 'soniox']);

export function DevSpeech() {
  const on = useMemo(() => devSpeech(), []);
  const [setup, setSetup] = useState(() => load(SETUP, { speaker: 'A', condition: 'quiet', index: 0 }));
  const [runs, setRuns] = useState<SpeechRun[]>(() => load(RUNS, []));
  const [engines, setEngines] = useState(order);
  const [busy, setBusy] = useState<number | null>(null);
  const [live, setLive] = useState('');
  const [done, setDone] = useState<Record<number, string>>({});
  const [server, setServer] = useState(speechServer());
  const [, redraw] = useState(0);
  const stop = useRef<() => void>(() => undefined);
  useEffect(() => { void refreshSpeech().then(setServer); return () => stop.current(); }, []);
  useEffect(() => keep(SETUP, setup), [setup]);
  if (!on) return <section className="space-y-4 pt-4"><SceneHeader title={L.title} /><p className="text-sm text-muted">{L.off}</p></section>;

  const phrase = CORPUS[Math.min(setup.index, CORPUS.length - 1)]!;
  const go = (index: number) => { stop.current(); setSetup({ ...setup, index: Math.max(0, Math.min(CORPUS.length - 1, index)) }); setEngines(order()); setDone({}); setLive(''); };
  const record = (n: number) => {
    if (busy !== null) { stop.current(); return; }
    const engine = engines[n - 1]!;
    const run: SpeechRun = { phrase: phrase.id, engine, platform: platform(), speaker: setup.speaker, condition: setup.condition, text: '', startedAt: Date.now(), endedAt: 0 };
    setBusy(n); setLive('');
    // in the tap itself — Soniox makes its audio here (iPhone)
    stop.current = listen({
      interim: (x) => { setLive(x); run.lastWordAt = Date.now(); },
      final: (x) => { run.text = x; run.finalAt = Date.now(); if (run.lastWordAt === undefined) run.lastWordAt = run.finalAt; },
      error: (e) => { run.error = e; },
      socket: (ms) => { run.socketMs = ms; },
      end: () => {
        run.endedAt = Date.now();
        setRuns((rs) => { const next = [...rs, run]; keep(RUNS, next); return next; });
        setDone((d) => ({ ...d, [n]: run.text || L.none })); setBusy(null); setLive('');
      },
    }, [], { tap: true, engine });
  };
  const download = () => {
    const blob = new Blob([JSON.stringify({ v: 1, platform: platform(), runs }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `speech-runs-${platform()}-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const clear = () => { if (!window.confirm(L.clearAsk)) return; setRuns([]); keep(RUNS, []); };
  const needs = (['soniox', 'browser'] as const).filter((k) => !consentGiven(k));

  return (
    <section className="space-y-4 pt-4" data-testid="dev-speech">
      <SceneHeader title={L.title} description={L.intro} />
      {needs.map((k) => <VoiceConsentCard key={k} kind={k} onYes={() => redraw((x) => x + 1)} className="protocol-card p-3" />)}
      {server && !server.available && <p role="note" className="protocol-card p-3 text-sm">{L.noSoniox}</p>}
      {server?.id && <p className="text-sm text-muted">{L.testId(server.id)}</p>}
      <div className="protocol-card grid grid-cols-2 gap-3 p-3 text-sm">
        <label className="space-y-1"><span className="block text-muted">{L.speaker}</span>
          <input value={setup.speaker} onChange={(e) => setSetup({ ...setup, speaker: e.target.value.slice(0, 20) })} className="min-h-tap w-full rounded-xl border border-line bg-surface px-3" /></label>
        <label className="space-y-1"><span className="block text-muted">{L.condition}</span>
          <select value={setup.condition} onChange={(e) => setSetup({ ...setup, condition: e.target.value })} className="min-h-tap w-full rounded-xl border border-line bg-surface px-3">
            {Object.entries(L.conditions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      </div>
      <article className="protocol-card space-y-3 p-4">
        <p className="text-sm text-muted">{L.phrase(setup.index + 1, CORPUS.length)}</p>
        {phrase.card && <p className="text-sm text-muted">{L.card(phrase.card)}</p>}
        <p className="text-xl font-semibold" data-testid="dev-phrase">{phrase.say}</p>
        <div className="flex flex-wrap gap-2">
          {[1, 2].map((n) => (
            <button key={n} type="button" onClick={() => record(n)} disabled={busy !== null && busy !== n}
              className={`flex min-h-tap items-center gap-2 rounded-full px-4 font-semibold disabled:opacity-40 ${busy === n ? 'animate-pulse bg-warn text-surface' : 'bg-accent text-on-accent'}`}>
              {busy === n ? <Square size={18} aria-hidden /> : <Mic size={18} aria-hidden />}{done[n] ? L.again(n) : L.record(n)}</button>))}
        </div>
        {busy !== null && <p role="status" className="text-sm">{live || L.listening}</p>}
        {[1, 2].filter((n) => done[n]).map((n) => <p key={n} className="text-sm"><span className="text-muted">{L.record(n)} · {L.heard}: </span>{done[n]}</p>)}
        <div className="flex justify-between gap-2">
          <button type="button" onClick={() => go(setup.index - 1)} disabled={setup.index === 0} className="min-h-tap rounded-full border-2 border-line px-4 font-semibold disabled:opacity-40">{L.prev}</button>
          <button type="button" onClick={() => go(setup.index + 1)} disabled={setup.index >= CORPUS.length - 1} className="min-h-tap rounded-full border-2 border-accent px-4 font-semibold text-accent disabled:opacity-40">{L.next}</button>
        </div>
      </article>
      <div className="protocol-card space-y-2 p-3 text-sm">
        <p data-testid="dev-runs">{L.runs(runs.length)}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={download} disabled={!runs.length} className="min-h-tap rounded-full bg-accent px-4 font-semibold text-on-accent disabled:opacity-40">{L.export}</button>
          <button type="button" onClick={clear} disabled={!runs.length} className="min-h-tap rounded-full border-2 border-line px-4 font-semibold disabled:opacity-40">{L.clear}</button>
        </div>
      </div>
    </section>
  );
}
