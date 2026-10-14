import { format, parseISO } from 'date-fns';
import { Loading } from '../components/Recovery';
import { saved as withToast } from '../components/Toast';
import { uk } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Info, Plus, RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { db } from '../data/db';
import { usePlan, useWorkouts } from '../data/queries';
import { atLocal, newId, todayISO } from '../domain/dates';
import type { Workout as W, WorkoutExercise } from '../domain/types';
import { blankExercise, EQUIPMENT, pressHint, programmeWeek, startingSet, workoutDay } from '../domain/workouts';
import { EXERCISES, exerciseOf, type Exercise } from '../data/exercises';
import { ExerciseCard, LevelBadge } from '../components/ExerciseCard';
import { ExerciseLibrary } from '../components/ExerciseLibrary';
import { t } from '../i18n/uk';
import { useUi } from '../store/ui';

const L = t.workout;
const E = t.exercise;
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
    const last = workouts.filter((w) => w.date < date).at(-1);
    const start = startingSet(last, last && first ? programmeWeek(first, last.date) : week, week); // D60
    setDraft(existing ?? { id: newId(), date, durationMin: 30, equipment: EQUIPMENT, exercises: start.map(blankExercise) });
  }, [date, workouts === undefined]); // eslint-disable-line react-hooks/exhaustive-deps
  const [card, setCard] = useState<Exercise | null>(null);
  const [picking, setPicking] = useState<{ replace?: number } | null>(null); // D60: the library inline — to add, or to replace exercise #

  if (!workouts || !draft) return <Loading />;
  const schedule = workoutDay(plan, workouts.filter((w) => w.date !== date), date);
  const add = (e: Exercise) => { setDraft({ ...draft, exercises: [...draft.exercises, blankExercise(e)] }); setPicking(null); };
  const replace = (i: number, e: Exercise) => { setDraft({ ...draft, exercises: draft.exercises.map((x, j) => (j === i ? blankExercise(e) : x)) }); setPicking(null); };
  const remove = (i: number) => setDraft({ ...draft, exercises: draft.exercises.filter((_, j) => j !== i) });

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
        const lib = exerciseOf(ex);
        const timed = lib?.timed ?? ex.name === 'Планка';
        const hint = pressHint(ex);
        const rows: number[][] = [];
        ex.sets.forEach((s, j) => { const k = s.side === 'L' ? rows.length - 1 : rows.length; if (s.side === 'L' && k >= 0) rows[k]!.push(j); else rows.push([j]); });
        return (
          <fieldset key={`${i}-${ex.name}`} className="rounded-2xl border border-line bg-surface p-3">
            <legend className="sr-only">{ex.name}</legend>
            <div className="flex items-start gap-1">
              {lib ? <button type="button" onClick={() => setCard(lib)} aria-label={`${E.how}: ${ex.name}`}
                className="flex min-h-tap flex-1 items-center gap-2 text-left font-semibold"><Info size={18} className="shrink-0 text-accent" aria-hidden />
                <span>{ex.name}</span><LevelBadge level={lib.level} /></button>
                : <p className="min-h-tap flex-1 py-2 font-semibold">{ex.name}</p>}
              <button type="button" onClick={() => setPicking(picking?.replace === i ? null : { replace: i })} aria-label={`${E.swap}: ${ex.name}`}
                className="flex min-h-tap min-w-tap items-center justify-center text-accent"><RefreshCw size={18} aria-hidden /></button>
              <button type="button" onClick={() => remove(i)} aria-label={`${E.remove}: ${ex.name}`}
                className="flex min-h-tap min-w-tap items-center justify-center text-muted"><X size={18} aria-hidden /></button>
            </div>
            <p className="mb-2 text-sm text-muted">{ex.target}</p>
            {picking?.replace === i && (
              <div className="mb-3 rounded-xl border border-accent/40 p-2">
                <p className="mb-2 text-sm font-medium">{E.alternatives(ex.name)}</p>
                <ExerciseLibrary list={EXERCISES.filter((x) => x.id !== lib?.id && (!lib || x.pattern === lib.pattern))}
                  action={{ label: E.swapThis, run: (x) => replace(i, x) }} />
              </div>
            )}
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

      {picking && picking.replace === undefined ? (
        <div className="rounded-2xl border border-accent/40 bg-surface p-3">
          <p className="mb-2 font-semibold">{E.add}</p>
          <ExerciseLibrary action={{ label: E.addThis, run: add }} />
          <button type="button" onClick={() => setPicking(null)} className="mt-2 min-h-tap px-1 text-accent">{t.picker.done}</button>
        </div>
      ) : (
        <button type="button" onClick={() => setPicking({})} className="flex min-h-tap items-center gap-2 px-1 font-medium text-accent">
          <Plus size={18} aria-hidden />{E.add}</button>
      )}

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
      {card && <ExerciseCard exercise={card} onClose={() => setCard(null)} />}
    </section>
  );
}
