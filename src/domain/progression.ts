// D61: what the records say about the next workout — counted from the person's own sets, no model. With one
// kettlebell the steps are: more reps → a harder variant of the same movement (next level) → a heavier bell.
// «Важко» or «Щось боліло» stops any step up; pain is a reason to ask the doctor, not to push. Pure.
import { addDays, format, parseISO } from 'date-fns';
import { EXERCISES, exerciseOf, type Exercise } from '../data/exercises';
import type { ISODate, Workout, WorkoutExercise } from './types';

export const BELL_KG = 16;

/** «3 × 10», «3 × 8 кожною», «3 × 30–45 с» → the top of the range per set. */
export function targetTop(target: string): number | undefined {
  const m = /×\s*(\d+)(?:\s*[–-]\s*(\d+))?/.exec(target);
  return m ? Number(m[2] ?? m[1]) : undefined;
}

/** The weakest set of a session (for one-arm work — the weaker side). */
export function weakest(ex: WorkoutExercise, timed: boolean): number | undefined {
  const xs = ex.sets.map((s) => (timed ? s.seconds : s.reps)).filter((x): x is number => x != null && x > 0);
  return xs.length && xs.length === ex.sets.length ? Math.min(...xs) : undefined; // an unfinished record is not judged
}

/** «15 · 16 · 15»; one-arm work in pairs, right/left: «10/9 · 10/10 · 9/9». */
export function lastNumbers(ex: WorkoutExercise, timed: boolean): string {
  const v = (s: WorkoutExercise['sets'][number]) => String((timed ? s.seconds : s.reps) ?? '–');
  const out: string[] = [];
  ex.sets.forEach((s, i) => { if (s.side === 'L' && ex.sets[i - 1]?.side === 'R') out[out.length - 1] += `/${v(s)}`; else out.push(v(s)); });
  return out.join(' · ');
}

/** The next level of the same movement — the first one in the library order. */
export const harder = (e: Exercise): Exercise | undefined =>
  EXERCISES.find((x) => x.pattern === e.pattern && x.level === e.level + 1) ?? EXERCISES.find((x) => x.pattern === e.pattern && x.level > e.level);

export type Advice =
  | { kind: 'more-reps'; to: number }
  | { kind: 'harder'; exercise: Exercise }
  | { kind: 'heavier'; kg: number }
  | { kind: 'hold' } // hard last time: the same again
  | { kind: 'pain' }; // «щось боліло»

/** Advice for one exercise from the workouts before `date` that had it (latest last). */
export function adviceFor(e: Exercise, history: Workout[], date: ISODate): { last?: WorkoutExercise; advice?: Advice } {
  const past = history.filter((w) => w.date < date).map((w) => ({ w, x: w.exercises.find((x) => exerciseOf(x)?.id === e.id) }))
    .filter((p): p is { w: Workout; x: WorkoutExercise } => !!p.x);
  const prev = past.at(-1);
  if (!prev) return {};
  if (prev.w.feeling === 'Щось боліло') return { last: prev.x, advice: { kind: 'pain' } };
  if (prev.w.feeling === 'Важко') return { last: prev.x, advice: { kind: 'hold' } };
  const top = targetTop(e.target);
  const two = past.slice(-2).map((p) => weakest(p.x, e.timed));
  if (!top || two.length < 2 || two.some((v) => v === undefined || v < top)) return { last: prev.x };
  const now = Math.min(...(two as number[]));
  if (now >= Math.round(top * 1.5)) {
    const next = harder(e);
    return { last: prev.x, advice: next ? { kind: 'harder', exercise: next } : { kind: 'heavier', kg: BELL_KG + 4 } };
  }
  return { last: prev.x, advice: { kind: 'more-reps', to: now + (e.timed ? 10 : 2) } };
}

export interface Motivation { week: number; tonnesWeek: number; records: { exercise: Exercise; value: number }[] }

/** The week in numbers and the personal bests set in the last workout. Timed work is not weight lifted. */
export function motivation(workouts: Workout[], date: ISODate): Motivation {
  const from = format(addDays(parseISO(date), -6), 'yyyy-MM-dd');
  const week = workouts.filter((w) => w.date >= from && w.date <= date);
  const kg = week.flatMap((w) => w.exercises).filter((x) => !exerciseOf(x)?.timed && exerciseOf(x)?.id !== 'plank')
    .reduce((sum, x) => sum + x.sets.reduce((n, s) => n + (s.reps ?? 0), 0) * BELL_KG, 0);
  const done = workouts.filter((w) => w.date <= date);
  const last = done.at(-1);
  const records: Motivation['records'] = [];
  if (last) for (const x of last.exercises) {
    const e = exerciseOf(x);
    const v = e && weakest(x, e.timed);
    if (!e || v === undefined) continue;
    const before = done.slice(0, -1).flatMap((w) => w.exercises.filter((y) => exerciseOf(y)?.id === e.id)).map((y) => weakest(y, e.timed) ?? 0);
    if (before.length && v > Math.max(...before)) records.push({ exercise: e, value: v });
  }
  return { week: week.length, tonnesWeek: Math.round(kg / 100) / 10, records };
}
