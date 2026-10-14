// «Скласти тренування з ІІ» (SPEC.md D63): the level and the time are the person's; the model proposes a session
// from the library, the app checks it (draftFromAi) and puts it in the form as a draft with the model's advice —
// nothing is recorded until «Записати тренування». Needs sync (the server key) and a one-time consent.
import { useLiveQuery } from 'dexie-react-hooks';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { db } from '../data/db';
import { useRecentEntries } from '../data/queries';
import { todayISO } from '../domain/dates';
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

export function AiWorkoutPanel({ workouts, plan, date, onDraft }: {
  workouts: Workout[]; plan: Plan | undefined; date: string; onDraft: (x: WorkoutExercise[], advice: string, forDate: string) => void;
}) {
  const meta = useLiveQuery(async () => (await db.meta.get('sync')) ?? null, []);
  const [levels, setLevels] = useState<Level[]>(loadLevels);
  const [minutes, setMinutes] = useState('35'); // the field as typed; bounded when sent
  const [wish, setWish] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(false);
  const recent = useRecentEntries(date, 2);
  const keys = currentKeys();
  if (meta === undefined) return null;
  // D75: a symptom in the last 24 hours is said before the session is asked for — the person decides, nothing is blocked,
  // and the symptom itself is not sent anywhere (only «легше», if the person asks for it)
  const now = Date.now();
  const unwell = date === todayISO() ? (recent ?? []).filter((e) => e.kind === 'symptom' && e.status === 'done'
    && Date.parse(e.at) <= now && Date.parse(e.at) >= now - 86_400_000) : [];

  const pick = (l: Level[]) => { setLevels(l); try { localStorage.setItem(STORE, JSON.stringify(l)); } catch { /* private */ } };
  const make = async (consented = !!meta?.workoutConsent) => {
    if (!keys) return;
    if (!consented) { setAsking(true); return; }
    const forDate = date;
    setBusy(true); setError('');
    try {
      const mins = Math.min(90, Math.max(10, Math.round(Number(minutes) || 35)));
      const r = await aiWorkout(keys, workoutRequest({ levels, workouts, plan, minutes: mins, wish }));
      const d = draftFromAi(r, levels);
      if (!d.exercises.length) { setError(L.empty); return; }
      onDraft(d.exercises, [r.advice.trim(), d.dropped ? L.dropped(d.dropped) : ''].filter(Boolean).join(' '), forDate);
    } catch (e) {
      const code = e instanceof ApiError ? (e.status === 0 ? 'offline' : e.code) : 'other';
      setError((L.errors as Record<string, string>)[code] ?? L.errors.other);
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
          <input type="number" inputMode="numeric" min={10} max={90} value={minutes} onChange={(e) => setMinutes(e.target.value)}
            className="mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3" /></label>
        <label className="block"><span className="text-sm text-muted">{L.wish}</span>
          <input value={wish} onChange={(e) => setWish(e.target.value)} placeholder={L.wishPh} maxLength={300}
            className="mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3" /></label>
      </div>
      {unwell.length > 0 && (
        <div role="status" className="space-y-2 rounded-xl border border-warn/30 bg-warn-bg p-2 text-sm text-warn">
          <p>{L.unwell(unwell.map((e) => e.title).join('; '))}</p>
          {wish !== L.lighter && <button type="button" onClick={() => setWish(L.lighter)} className="min-h-tap rounded-xl border border-warn px-3 font-medium">{L.askLighter}</button>}
        </div>
      )}
      {!meta || !keys ? <p className="text-sm text-muted">{L.needsSync}</p> : asking && !meta.workoutConsent ? (
        <div className="space-y-2 rounded-xl border border-accent/40 p-2 text-sm">
          <p>{L.consent}</p>
          <button type="button" onClick={async () => { await db.meta.update('sync', { workoutConsent: true }); setAsking(false); void make(true); }}
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
