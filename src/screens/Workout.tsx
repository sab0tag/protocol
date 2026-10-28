import { format, parseISO } from 'date-fns';
import { Loading } from '../components/Recovery';
import { Link } from 'react-router-dom';
import { saved as withToast } from '../components/Toast';
import { keep, kept } from '../data/kept';
import { uk } from 'date-fns/locale';
import { Check, ChevronLeft, ChevronRight, Clock3, Dumbbell, Info, Plus, RefreshCw, Save, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { db } from '../data/db';
import { usePlan, useWorkouts } from '../data/queries';
import { atLocal, newId, todayISO } from '../domain/dates';
import type { Workout as W, WorkoutExercise } from '../domain/types';
import { blankExercise, EQUIPMENT, pressHint, programmeWeek, startingSet, workoutDay } from '../domain/workouts';
import { EXERCISES, exerciseOf, type Exercise } from '../data/exercises';
import { adviceFor, lastNumbers, motivation } from '../domain/progression';
import { ExerciseCard, LevelBadge } from '../components/ExerciseCard';
import { ExerciseLibrary } from '../components/ExerciseLibrary';
import { ExampleNotice } from '../components/ExampleNotice';
import { AiWorkoutPanel } from '../components/AiWorkoutPanel';
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
  const exercisesHeading = useRef<HTMLHeadingElement>(null);
  const [focused, setFocused] = useState(false);
  const [activeAt, setActiveExercise] = useState(0);
  const base0 = useRef(''); // D87: the day's draft as it started — what counts as «nothing typed yet»

  const existing = workouts?.find((w) => w.date === date);
  const first = workouts?.[0]?.date;
  const week = programmeWeek(first && first <= date ? first : undefined, date);

  useEffect(() => {
    if (!workouts) return;
    setAiAdvice(''); // a new day — the last day's advice is not about it
    const last = workouts.filter((w) => w.date < date).at(-1);
    const start = startingSet(last, last && first ? programmeWeek(first, last.date) : week, week); // D60
    const base = existing ?? { id: newId(), date, durationMin: 30, equipment: EQUIPMENT, exercises: start.map(blankExercise) };
    base0.current = JSON.stringify(base);
    const k = kept<{ draft: W; advice: string }>(`workout:${date}`); // D87: sets typed before a locked phone reloaded the page
    setDraft(k?.draft ?? base);
    setActiveExercise(0); // a new day starts at its first exercise — the last day's index may not exist here
    if (k?.advice) setAiAdvice(k.advice);
  }, [date, workouts === undefined]); // eslint-disable-line react-hooks/exhaustive-deps
  const [card, setCard] = useState<Exercise | null>(null);
  const [picking, setPicking] = useState<{ replace?: number } | null>(null); // D60: the library inline — to add, or to replace exercise #
  const [aiAdvice, setAiAdvice] = useState(''); // D63
  useEffect(() => { // D87: kept while it differs from what is stored (or from the fresh day) — gone once recorded
    if (!draft) return;
    const s = JSON.stringify(draft), stored = workouts?.find((w) => w.date === draft.date); // the draft's own day, not the shown one
    const untouched = (draft.date === date && s === base0.current) || (stored && s === JSON.stringify(stored));
    keep(`workout:${draft.date}`, untouched ? undefined : { draft, advice: aiAdvice });
  }, [draft, workouts, aiAdvice]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownDate = useRef(date);
  shownDate.current = date; // a reply for a day no longer on screen is dropped, never written over another day's draft

  if (!workouts || !draft) return <Loading />;
  const activeExercise = Math.min(activeAt, Math.max(0, draft.exercises.length - 1)); // an AI draft may bring fewer exercises
  const schedule = workoutDay(plan, workouts.filter((w) => w.date !== date), date);
  const add = (e: Exercise) => { setDraft({ ...draft, exercises: [...draft.exercises, blankExercise(e)] }); setPicking(null); };
  const replace = (i: number, e: Exercise) => { setDraft({ ...draft, exercises: draft.exercises.map((x, j) => (j === i ? blankExercise(e) : x)) }); setPicking(null); };
  const remove = (i: number) => { setDraft({ ...draft, exercises: draft.exercises.filter((_, j) => j !== i) }); setActiveExercise(Math.max(0, Math.min(activeExercise, draft.exercises.length - 2))); };

  const setEx = (i: number, ex: WorkoutExercise) => setDraft({ ...draft, exercises: draft.exercises.map((x, j) => (j === i ? ex : x)) });
  // D76: unsaved = the draft differs from what is stored (a new day's draft is unsaved until recorded)
  const dirty = !existing || JSON.stringify(draft) !== JSON.stringify(existing);
  const save = async () => {
    await withToast(() => db.transaction('rw', db.workouts, db.entries, async () => {
      await db.workouts.put(draft);
      const entry = await db.entries.where('at').startsWith(date).filter((e) => e.workoutId === draft.id).first();
      await db.entries.put({ id: entry?.id ?? newId(), at: entry?.at ?? atLocal(date, date === todayISO() ? format(new Date(), 'HH:mm') : '18:00'),
        kind: 'workout', status: 'done', title: L.title, workoutId: draft.id, checkKey: 'workout' });
    }), t.toast.workout);
    setAiAdvice('');
  };

  return (
    <section className="space-y-4 pt-4">
      <header className="protocol-scene-header flex items-center gap-2">
        <button type="button" onClick={() => shift(-1)} aria-label={t.day.prev}
          className="flex min-h-tap min-w-tap items-center justify-center rounded-xl border border-line bg-surface"><ChevronLeft size={20} /></button>
        <div className="flex-1 text-center">
          <h1 className="text-xl font-semibold">{L.title} · {L.week(week)}</h1>
          <p className="text-sm text-muted first-letter:uppercase">{dm(date)} · {EQUIPMENT}</p>
        </div>
        <button type="button" onClick={() => shift(1)} aria-label={t.day.next}
          className="flex min-h-tap min-w-tap items-center justify-center rounded-xl border border-line bg-surface"><ChevronRight size={20} /></button>
      </header>
      <ExampleNotice plan={plan} />

      <section aria-label="Огляд тренування" className="protocol-card space-y-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="protocol-eyebrow">{existing ? 'Записане тренування' : 'Ваш план на сьогодні'}</span>
          <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">{L.week(week)}</span>
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{existing ? 'Ваш результат' : 'Рух у своєму темпі'}</h2>
          <p className="mt-1 text-sm text-muted">{existing ? 'Перегляньте або відредагуйте виконані вправи.' : 'План можна змінювати під свій стан. Почніть із комфортного навантаження.'}</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-2xl bg-bg p-3"><Dumbbell size={18} className="mb-2 text-accent" aria-hidden /><p className="text-xl font-semibold tabular">{draft.exercises.length}</p><p className="text-xs text-muted">Вправ</p></div>
          <div className="rounded-2xl bg-bg p-3"><Check size={18} className="mb-2 text-accent" aria-hidden /><p className="text-xl font-semibold tabular">{draft.exercises.reduce((n, ex) => n + ex.sets.length, 0)}</p><p className="text-xs text-muted">{existing ? 'Підходів у записі' : 'Підходів у плані'}</p></div>
          <div className="rounded-2xl bg-bg p-3"><Clock3 size={18} className="mb-2 text-accent" aria-hidden /><p className="text-xl font-semibold tabular">{existing ? existing.durationMin : '—'}</p><p className="text-xs text-muted">{existing ? 'Записано, хв' : 'Хвилин — після запису'}</p></div>
        </div>
        <button type="button" onClick={() => { exercisesHeading.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); exercisesHeading.current?.focus({ preventScroll: true }); }} className="flex min-h-tap items-center justify-center rounded-xl bg-accent px-4 font-semibold text-surface">{existing ? 'Переглянути вправи' : 'Перейти до вправ'}</button>
      </section>

      {draft.exercises.length > 0 && (
        <div className="rounded-2xl border border-line bg-surface p-3">
          <button type="button" aria-pressed={focused} onClick={() => setFocused((v) => !v)}
            className="flex min-h-tap w-full items-center justify-center rounded-xl border border-accent px-4 font-semibold text-accent">
            {focused ? 'Показати всі вправи' : 'Тренуватися по одній вправі'}
          </button>
          {focused && <div role="group" className="mt-3 flex items-center justify-between gap-2" aria-label="Навігація вправами">
            <button type="button" disabled={activeExercise === 0} onClick={() => setActiveExercise(activeExercise - 1)}
              className="min-h-tap rounded-xl border border-line px-3 disabled:opacity-40">← Назад</button>
            <span role="status" className="text-sm font-medium tabular">Вправа {activeExercise + 1} з {draft.exercises.length}</span>
            <button type="button" disabled={activeExercise >= draft.exercises.length - 1} onClick={() => setActiveExercise(activeExercise + 1)}
              className="min-h-tap rounded-xl border border-line px-3 disabled:opacity-40">Далі →</button>
          </div>}
          {focused && <p className="mt-2 text-center text-xs text-muted">Заповнюйте підходи у своєму темпі. Дані залишаються в чернетці до збереження.</p>}
        </div>
      )}

      {(() => { // D61: the week in numbers, personal bests of the last workout
        const m = motivation(workouts, date);
        if (!m.week && !m.records.length) return null;
        return (
          <div className="space-y-1 rounded-2xl border border-accent/30 bg-accent/10 p-3 text-sm">
            {m.week > 0 && <p className="font-medium">{L.weekNumbers(m.week, String(m.tonnesWeek).replace('.', ','))}</p>}
            {m.records.map((r) => <p key={r.exercise.id} className="text-accent">{L.record(r.exercise.name, r.value, r.exercise.timed)}</p>)}
          </div>
        );
      })()}

      {!existing && <AiWorkoutPanel workouts={workouts.filter((w) => w.date < date)} plan={plan}
        onDraft={(xs, advice, forDate) => {
          if (forDate !== shownDate.current) return;
          setDraft((d) => (d && d.date === forDate ? { ...d, exercises: xs } : d));
          setAiAdvice(advice);
        }} date={date} />}
      {aiAdvice && (
        <div role="status" className="space-y-1 rounded-2xl border border-accent/30 bg-accent/10 p-3 text-sm">
          <p><span className="font-semibold">{t.aiWorkout.advice}: </span>{aiAdvice}</p>
          <p className="text-muted">{t.aiWorkout.draft}</p>
        </div>
      )}

      {!existing && (
        <p className="flex items-start gap-2 protocol-card rounded-2xl border border-line bg-surface p-3 text-sm">
          <Info size={18} className="mt-0.5 shrink-0 text-muted" />
          {schedule.postponed ?? (schedule.due ? L.today : `${L.notToday}. ${schedule.next ? L.nextOn(dm(schedule.next)) : ''}`)}
        </p>
      )}

      <h2 ref={exercisesHeading} tabIndex={-1} id="workout-exercises" className="scroll-mt-6 text-lg font-semibold">Вправи тренування</h2>
      {draft.exercises.map((ex, i) => {
        if (focused && i !== activeExercise) return null;
        const lib = exerciseOf(ex);
        const timed = lib?.timed ?? ex.name === 'Планка';
        const hint = pressHint(ex);
        const rows: number[][] = [];
        ex.sets.forEach((s, j) => { const k = s.side === 'L' ? rows.length - 1 : rows.length; if (s.side === 'L' && k >= 0) rows[k]!.push(j); else rows.push([j]); });
        return (
          <fieldset key={`${i}-${ex.name}`} className="protocol-card rounded-2xl border border-line bg-surface p-3">
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
            {lib && !existing && (() => { // D61: the last numbers and what they suggest — the person decides
              const { last, advice: a } = adviceFor(lib, workouts, date);
              if (!last) return null;
              return (
                <div className="mb-2 space-y-1 text-sm">
                  <p className="tabular text-muted">{L.last(`${lib.unilateral ? `${L.right}/${L.left} ` : ''}${lastNumbers(last, lib.timed)}`)}</p>
                  {a && <p className={a.kind === 'pain' || a.kind === 'hold' ? 'text-warn' : 'text-accent'}>
                    {a.kind === 'more-reps' ? L.moreReps(a.to, lib.timed) : a.kind === 'harder' ? L.harder(a.exercise.name)
                      : a.kind === 'heavier' ? L.heavier(a.kg) : a.kind === 'hold' ? L.hold : L.pain}</p>}
                  {a?.kind === 'harder' && <button type="button" onClick={() => replace(i, a.exercise)}
                    className="min-h-tap rounded-xl border border-accent px-3 font-medium text-accent">{L.tryIt(a.exercise.name)}</button>}
                </div>
              );
            })()}
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={() => setPicking({})} className="flex min-h-tap items-center gap-2 px-1 font-medium text-accent">
            <Plus size={18} aria-hidden />{E.add}</button>
          <Link to="/exercises" className="flex min-h-tap items-center px-1 text-sm text-muted underline">{E.library}</Link>{/* D78: moved here from «Ще» */}
        </div>
      )}

      <div className="protocol-card rounded-2xl border border-line bg-surface p-3">
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

      {/* D76: a long list of sets — the save button floats above the tab bar while scrolling and rests here at the end */}
      <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-10 md:bottom-4">
        <button type="button" onClick={() => void save()} disabled={!dirty}
          className={`flex min-h-[3.25rem] w-full items-center justify-center gap-2 rounded-2xl px-4 font-semibold shadow-lg ${dirty
            ? 'bg-accent text-surface' : 'border border-accent/40 bg-surface text-accent'}`}>
          {dirty ? <Save size={20} aria-hidden /> : <Check size={20} aria-hidden />}
          {dirty ? (existing ? L.saveChanges : L.save) : L.saved}</button>
      </div>
      {card && <ExerciseCard exercise={card} onClose={() => setCard(null)} />}
    </section>
  );
}
