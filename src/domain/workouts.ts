// The kettlebell programme (SPEC.md §9.2) and the every-other-day schedule (§5.6). Pure functions.
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import type { ISODate, Plan, Workout, WorkoutExercise } from './types';

export interface ExerciseTemplate {
  name: string;
  target: string; // "3 × 10"
  sets: number;
  unilateral: boolean; // each side separately (П/Л)
  timed: boolean; // seconds instead of reps
}

const BASE: ExerciseTemplate[] = [
  { name: 'Гоблет-присід', target: '3 × 10', sets: 3, unilateral: false, timed: false },
  { name: 'Станова з гирею', target: '3 × 10', sets: 3, unilateral: false, timed: false },
  { name: 'Тяга в нахилі', target: '3 × 10 кожною', sets: 3, unilateral: true, timed: false },
  { name: 'Жим стоячи', target: '3 × 8 кожною, за слабшою рукою', sets: 3, unilateral: true, timed: false },
  { name: 'Планка', target: '3 × 30–45 с', sets: 3, unilateral: false, timed: true },
];
const FROM_WEEK_5: ExerciseTemplate[] = [{ name: 'Махи', target: '3 × 15', sets: 3, unilateral: false, timed: false }];

export const EQUIPMENT = 'Гиря 16 кг';
export const PRESS = 'Жим стоячи';

/** Week of the programme, counted from the first workout (week 1 when there is none yet). */
export function programmeWeek(first: ISODate | undefined, date: ISODate): number {
  if (!first) return 1;
  return Math.floor(Math.max(0, differenceInCalendarDays(parseISO(date), parseISO(first))) / 7) + 1;
}

export function programme(week: number): ExerciseTemplate[] {
  return week >= 5 ? [...BASE, ...FROM_WEEK_5] : BASE;
}

/** Empty sets for the form: one per set and, for one-arm work, one per side (П first, then Л). */
export function blankExercise(t: ExerciseTemplate): WorkoutExercise {
  const sets = Array.from({ length: t.sets }, () =>
    t.unilateral ? [{ side: 'R' as const }, { side: 'L' as const }] : [{}]).flat();
  return { name: t.name, target: t.target, sets };
}

/** «Наступного разу обома по Л»: in the press the left arm did fewer reps than the right. */
export function pressHint(ex: WorkoutExercise): string | undefined {
  if (ex.name !== PRESS) return undefined;
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
