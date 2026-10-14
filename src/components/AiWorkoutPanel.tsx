// «Скласти тренування з ІІ» (SPEC.md D63): the level and the time are the person's; the model proposes a session
// from the library, the app checks it (draftFromAi) and puts it in the form as a draft with the model's advice —
// nothing is recorded until «Записати тренування». Needs sync (the server key) and a one-time consent.
import { useLiveQuery } from 'dexie-react-hooks';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { db } from '../data/db';
import type { Level } from '../data/exercises';
import { draftFromAi, workoutRequest } from '../domain/aiWorkout';
import type { Plan, Workout, WorkoutExercise } from '../domain/types';
import { t } from '../i18n/uk';
import { aiWorkout, ApiError } from '../sync/api';
import { currentKeys } from '../sync/runner';

const L = t.aiWorkout;
const STORE = 'protocol.workoutLevels';
const CHOICES: { label: string; levels: Level[] }[] = [{ label: L.base, levels: [1] }, { label: L.baseMid, levels: [1, 2] }];

function loadLevels(): Level[] {
  try { const v = JSON.parse(localStorage.getItem(STORE) ?? 'null') as unknown; if (Array.isArray(v) && v.length) return v as Level[]; } catch { /* private */ }
  return [1, 2];
}

export function AiWorkoutPanel({ workouts, plan, onDraft }: { workouts: Workout[]; plan: Plan | undefined; onDraft: (x: WorkoutExercise[], advice: string) => void }) {
  const meta = useLiveQuery(async () => (await db.meta.get('sync')) ?? null, []);
  const [levels, setLevels] = useState<Level[]>(loadLevels);
  const [minutes, setMinutes] = useState(35);
  const [wish, setWish] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(false);
  const keys = currentKeys();
  if (meta === undefined) return null;

  const pick = (l: Level[]) => { setLevels(l); try { localStorage.setItem(STORE, JSON.stringify(l)); } catch { /* private */ } };
  const make = async () => {
    if (!keys) return;
    if (!meta?.workoutConsent) { setAsking(true); return; }
    setBusy(true); setError('');
    try {
      const r = await aiWorkout(keys, workoutRequest({ levels, workouts, plan, minutes, wish }));
      const d = draftFromAi(r, levels);
      if (!d.exercises.length) { setError(L.empty); return; }
      onDraft(d.exercises, [r.advice.trim(), d.dropped ? L.dropped(d.dropped) : ''].filter(Boolean).join(' '));
    } catch (e) {
      const code = e instanceof ApiError ? (e.status === 0 ? 'offline' : e.code) : 'other';
      setError((t.menu.errors as Record<string, string>)[code] ?? t.menu.errors.other);
    } finally { setBusy(false); }
  };

  return (
    <section aria-label={L.title} className="space-y-3 rounded-2xl border border-line bg-surface p-3">
      <h2 className="flex items-center gap-2 font-semibold"><Sparkles size={18} className="text-accent" aria-hidden />{L.title}</h2>
      <div className="flex flex-wrap gap-2" role="group" aria-label={L.level}>
        {CHOICES.map((c) => { const on = c.levels.join() === levels.join(); return (
          <button key={c.label} type="button" aria-pressed={on} onClick={() => pick(c.levels)}
            className={`min-h-tap rounded-full border px-3 text-sm ${on ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-line'}`}>{c.label}</button>); })}
      </div>
      <div className="grid grid-cols-[6rem_1fr] gap-2">
        <label className="block"><span className="text-sm text-muted">{L.minutes}</span>
          <input type="number" inputMode="numeric" min={10} max={90} value={minutes} onChange={(e) => setMinutes(Number(e.target.value) || 35)}
            className="mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3" /></label>
        <label className="block"><span className="text-sm text-muted">{L.wish}</span>
          <input value={wish} onChange={(e) => setWish(e.target.value)} placeholder={L.wishPh} maxLength={300}
            className="mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3" /></label>
      </div>
      {!meta || !keys ? <p className="text-sm text-muted">{L.needsSync}</p> : asking && !meta.workoutConsent ? (
        <div className="space-y-2 rounded-xl border border-accent/40 p-2 text-sm">
          <p>{L.consent}</p>
          <button type="button" onClick={async () => { await db.meta.update('sync', { workoutConsent: true }); setAsking(false); }}
            className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface">{L.allow}</button>
        </div>
      ) : (
        <button type="button" onClick={() => void make()} disabled={busy}
          className="flex min-h-tap items-center gap-2 rounded-xl bg-accent px-3 font-medium text-surface disabled:opacity-40">
          <Sparkles size={18} aria-hidden />{busy ? L.busy : L.make}</button>
      )}
      {error && <p role="alert" className="text-sm text-warn">{error}</p>}
    </section>
  );
}
