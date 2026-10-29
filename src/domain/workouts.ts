// The kettlebell programme (SPEC.md §9.2) and the every-other-day schedule (§5.6). Pure functions.
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import { exerciseById, exerciseOf, type Exercise } from '../data/exercises';
import type { ISODate, Plan, Workout, WorkoutExercise } from './types';

/** What a set list is made from — a library exercise (D60). */
export type ExerciseTemplate = Pick<Exercise, 'id' | 'name' | 'target' | 'sets' | 'unilateral' | 'timed'>;

const BASE = ['goblet-squat', 'kb-deadlift', 'row', 'press', 'plank'];
const FROM_WEEK_5 = ['swing'];

export const EQUIPMENT = 'Гиря 16 кг';

/** Week of the programme, counted from the first workout (week 1 when there is none yet). */
export function programmeWeek(first: ISODate | undefined, date: ISODate): number {
  if (!first) return 1;
  return Math.floor(Math.max(0, differenceInCalendarDays(parseISO(date), parseISO(first))) / 7) + 1;
}

export function programme(week: number): ExerciseTemplate[] {
  return (week >= 5 ? [...BASE, ...FROM_WEEK_5] : BASE).map((id) => exerciseById.get(id)!);
}

/** D60: where a new workout starts — the programme of the week, or the person's own set of the last workout if they
 *  changed it (added, replaced, removed): their choice is kept, not reset to the programme every time. */
export function startingSet(last: Workout | undefined, lastWeek: number, week: number): ExerciseTemplate[] {
  const own = last?.exercises.map((x) => exerciseOf(x)).filter((e): e is Exercise => !!e) ?? [];
  const planned = programme(lastWeek).map((e) => e.id);
  const changed = own.length > 0 && (own.length !== planned.length || own.some((e, i) => e.id !== planned[i]));
  return changed ? own : programme(week);
}

/** Empty sets for the form: one per set and, for one-arm work, one per side (П first, then Л). */
export function blankExercise(t: ExerciseTemplate): WorkoutExercise {
  const sets = Array.from({ length: t.sets }, () =>
    t.unilateral ? [{ side: 'R' as const }, { side: 'L' as const }] : [{}]).flat();
  return { exerciseId: t.id, name: t.name, target: t.target, sets };
}

/** D141: the plan of one set as the target says it — «10» of «3 × 10 кожною», «30–45» of «3 × 30–45 с». */
export function plannedPerSet(target: string): string | undefined {
  const m = /×\s*(\d+(?:\s*[–-]\s*\d+)?)/.exec(target);
  return m?.[1]!.replace(/\s*[–-]\s*/, '–');
}

/** Held for seconds, not counted in reps; an old record without a library id is known by its name. */
export const timedExercise = (ex: WorkoutExercise): boolean => exerciseOf(ex)?.timed ?? ex.name === 'Планка';

export interface WorkoutTally { planned: number; done: number; reps: number; seconds: number }

/** D141: plan against fact. Every slot of the form is a planned set (each arm apart for one-arm work); a set is done
 *  only when a number above zero was typed in it — an empty slot is not a set done, and the plan's numbers are never
 *  counted as the person's. */
export function workoutTally(exercises: WorkoutExercise[]): WorkoutTally {
  const out: WorkoutTally = { planned: 0, done: 0, reps: 0, seconds: 0 };
  for (const ex of exercises) {
    const byTime = timedExercise(ex);
    for (const s of ex.sets) {
      out.planned += 1;
      const v = byTime ? s.seconds : s.reps;
      if (v == null || v <= 0) continue;
      out.done += 1;
      if (byTime) out.seconds += v; else out.reps += v;
    }
  }
  return out;
}

/** «Наступного разу обома по Л»: in the press the left arm did fewer reps than the right. */
export function pressHint(ex: WorkoutExercise): string | undefined {
  if (exerciseOf(ex)?.id !== 'press') return undefined;
  const sum = (side: 'L' | 'R') => ex.sets.filter((s) => s.side === side).reduce((n, s) => n + (s.reps ?? 0), 0);
  const l = sum('L'), r = sum('R');
  return l > 0 && l < r ? 'Ліва слабша — наступного разу обома руками по Л' : undefined;
}

/** Tests the plan has on a date (a test prescription due then, or the next check-up). */
export function testsOn(plan: Plan | undefined, date: ISODate): string[] {
  if (!plan) return [];
  const due = plan.prescriptions.filter((p) => p.kind === 'test' && p.dueDate === date).map((p) => p.title);
  const checkup = plan.nextCheckup?.date === date ? plan.nextCheckup.tests : [];
  return [...due, ...checkup];
}

export interface WorkoutDay {
  due: boolean;
  /** Why today is not a training day though it would be (a test tomorrow). */
  postponed?: string;
  next?: ISODate;
}

/** Every other day: due when the last workout was two or more days ago (or there was none).
 *  A test the next day moves it — training the day before a test can change the results. */
export function workoutDay(plan: Plan | undefined, workouts: Pick<Workout, 'date'>[], date: ISODate): WorkoutDay {
  const done = workouts.filter((w) => w.date <= date).map((w) => w.date).sort();
  const last = done.at(-1);
  if (last === date) return { due: true };
  const byRhythm = !last || differenceInCalendarDays(parseISO(date), parseISO(last)) >= 2;
  const tomorrow = format(addDays(parseISO(date), 1), 'yyyy-MM-dd');
  const tests = testsOn(plan, tomorrow);
  if (byRhythm && tests.length) {
    return { due: false, postponed: `Завтра аналіз (${tests.join(', ')}) — тренування перенесено на післязавтра`,
      next: format(addDays(parseISO(date), 2), 'yyyy-MM-dd') };
  }
  return byRhythm ? { due: true } : { due: false, next: format(addDays(parseISO(last!), 2), 'yyyy-MM-dd') };
}
