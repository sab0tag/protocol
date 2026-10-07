import { format, parseISO } from 'date-fns';
import { Loading } from '../components/Recovery';
import { saved as withToast } from '../components/Toast';
import { uk } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { useEffect, useState } from 'react';
import { db } from '../data/db';
import { usePlan, useWorkouts } from '../data/queries';
import { atLocal, newId, todayISO } from '../domain/dates';
import type { Workout as W, WorkoutExercise } from '../domain/types';
import { blankExercise, EQUIPMENT, pressHint, programme, programmeWeek, workoutDay } from '../domain/workouts';
import { t } from '../i18n/uk';
import { useUi } from '../store/ui';

const L = t.workout;
const dm = (d: string) => format(parseISO(d), 'EEEE, d MMMM', { locale: uk });

/** «Тренування» (SPEC.md §5.6): the programme of the week, reps per set, each arm apart for one-arm work. */
export function Workout() {
  const { date, shift } = useUi();
  const plan = usePlan();
  const workouts = useWorkouts();
  const [draft, setDraft] = useState<W | null>(null);
  const [saved, setSaved] = useState(false);

  const existing = workouts?.find((w) => w.date === date);
  const first = workouts?.[0]?.date;
  const week = programmeWeek(first && first <= date ? first : undefined, date);

  useEffect(() => {
    if (!workouts) return;
    setSaved(false);
    setDraft(existing ?? { id: newId(), date, durationMin: 30, equipment: EQUIPMENT, exercises: programme(week).map(blankExercise) });
  }, [date, workouts === undefined]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!workouts || !draft) return <Loading />;
  const schedule = workoutDay(plan, workouts.filter((w) => w.date !== date), date);
  const templates = programme(week);

  const setEx = (i: number, ex: WorkoutExercise) => setDraft({ ...draft, exercises: draft.exercises.map((x, j) => (j === i ? ex : x)) });
  const save = async () => {
    await withToast(() => db.transaction('rw', db.workouts, db.entries, async () => {
      await db.workouts.put(draft);
      const entry = await db.entries.where('at').startsWith(date).filter((e) => e.workoutId === draft.id).first();
      await db.entries.put({ id: entry?.id ?? newId(), at: entry?.at ?? atLocal(date, date === todayISO() ? format(new Date(), 'HH:mm') : '18:00'),
        kind: 'workout', status: 'done', title: L.title, workoutId: draft.id, checkKey: 'workout' });
    }), t.toast.workout);
    setSaved(true);
  };

  return (
    <section className="space-y-4 pt-4">
      <header className="flex items-center gap-2">
        <button type="button" onClick={() => shift(-1)} aria-label={t.day.prev}
          className="flex min-h-tap min-w-tap items-center justify-center rounded-xl border border-line bg-surface"><ChevronLeft size={20} /></button>
        <div className="flex-1 text-center">
          <h1 className="text-xl font-semibold">{L.title} · {L.week(week)}</h1>
          <p className="text-sm text-muted first-letter:uppercase">{dm(date)} · {EQUIPMENT}</p>
        </div>
        <button type="button" onClick={() => shift(1)} aria-label={t.day.next}
          className="flex min-h-tap min-w-tap items-center justify-center rounded-xl border border-line bg-surface"><ChevronRight size={20} /></button>
      </header>

      {!existing && (
        <p className="flex items-start gap-2 rounded-2xl border border-line bg-surface p-3 text-sm">
          <Info size={18} className="mt-0.5 shrink-0 text-muted" />
          {schedule.postponed ?? (schedule.due ? L.today : `${L.notToday}. ${schedule.next ? L.nextOn(dm(schedule.next)) : ''}`)}
        </p>
      )}

      {draft.exercises.map((ex, i) => {
        const tpl = templates.find((x) => x.name === ex.name);
        const timed = tpl?.timed ?? ex.name === 'Планка';
        const hint = pressHint(ex);
        const rows: number[][] = [];
        ex.sets.forEach((s, j) => { const k = s.side === 'L' ? rows.length - 1 : rows.length; if (s.side === 'L' && k >= 0) rows[k]!.push(j); else rows.push([j]); });
        return (
          <fieldset key={ex.name} className="rounded-2xl border border-line bg-surface p-3">
            <legend className="sr-only">{ex.name}</legend>
            <p className="font-semibold">{ex.name}</p>
            <p className="mb-2 text-sm text-muted">{ex.target}</p>
            <div className="space-y-2">
              {rows.map((idx, r) => (
                <div key={r} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-sm text-muted">{L.set(r + 1)}</span>
                  {idx.map((j) => {
                    const s = ex.sets[j]!;
                    const label = `${ex.name}, ${L.set(r + 1)}${s.side ? `, ${s.side === 'R' ? L.right : L.left}` : ''}`;
                    return (
                      <label key={j} className="flex flex-1 items-center gap-1">
                        {s.side && <span className="w-4 text-sm font-semibold">{s.side === 'R' ? L.right : L.left}</span>}
                        <input type="number" inputMode="numeric" min={0} aria-label={label}
                          value={(timed ? s.seconds : s.reps) ?? ''}
                          onChange={(e) => {
                            const v = e.target.value === '' ? undefined : Math.max(0, Number(e.target.value));
                            setEx(i, { ...ex, sets: ex.sets.map((x, k) => (k === j ? { ...x, ...(timed ? { seconds: v } : { reps: v }) } : x)) });
                          }}
                          className="min-h-tap w-full rounded-xl border border-line bg-bg px-2 text-center tabular" />
                        <span className="text-xs text-muted">{timed ? L.seconds : L.reps}</span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
            {hint && <p className="mt-2 rounded-xl bg-warn-bg p-2 text-sm text-warn">{hint}</p>}
          </fieldset>
        );
      })}

      <div className="rounded-2xl border border-line bg-surface p-3">
        <label className="block"><span className="text-sm text-muted">{L.duration}</span>
          <input type="number" inputMode="numeric" min={0} value={draft.durationMin}
            onChange={(e) => setDraft({ ...draft, durationMin: Math.max(0, Number(e.target.value) || 0) })}
            className="mt-1 block min-h-tap w-32 rounded-xl border border-line bg-bg px-3" /></label>
        <p className="mb-2 mt-3 text-sm text-muted">{L.feeling}</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label={L.feeling}>
          {L.feelings.map((f) => (
            <button key={f} type="button" aria-pressed={draft.feeling === f}
              onClick={() => setDraft({ ...draft, feeling: draft.feeling === f ? undefined : f })}
              className={`min-h-tap rounded-full border px-3 ${draft.feeling === f ? 'border-accent bg-accent/10 text-accent' : 'border-line'}`}>{f}</button>
          ))}
        </div>
      </div>

      <button type="button" onClick={() => void save()} className="min-h-tap w-full rounded-xl bg-accent px-4 font-medium text-surface">
        {saved ? L.saved : L.save}</button>
    </section>
  );
}
