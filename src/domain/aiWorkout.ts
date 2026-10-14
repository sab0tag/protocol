// «Скласти тренування» (SPEC.md D63): what goes to the model — the library of the chosen levels, the last workouts
// as numbers, the doctor's limits — and how its answer becomes a draft: every line checked against the library
// (an unknown or off-level id is dropped), sets and reps kept within sane bounds. Nothing is written here. Pure.
import { EXERCISES, exerciseById, type Level } from '../data/exercises';
import { blankExercise, EQUIPMENT } from './workouts';
import { lastNumbers } from './progression';
import { exerciseOf } from '../data/exercises';
import type { Plan, Workout, WorkoutExercise } from './types';

export interface WorkoutBody {
  exercises: { id: string; name: string; level: number; pattern: string; unilateral: boolean; timed: boolean }[];
  history: { date: string; feeling: string; items: string[] }[];
  rules: string[];
  equipment: string;
  minutes: number;
  wish: string;
}
export interface AiWorkout { exercises: { id: string; sets: number; reps: number | null; seconds: number | null }[]; advice: string }

export function workoutRequest(args: { levels: Level[]; workouts: Workout[]; plan: Plan | undefined; minutes: number; wish: string }): WorkoutBody {
  return {
    exercises: EXERCISES.filter((e) => args.levels.includes(e.level))
      .map(({ id, name, level, pattern, unilateral, timed }) => ({ id, name, level, pattern, unilateral, timed })),
    history: args.workouts.slice(-6).map((w) => ({ date: w.date, feeling: w.feeling ?? '',
      items: w.exercises.map((x) => `${x.name}: ${lastNumbers(x, exerciseOf(x)?.timed ?? false)}`) })),
    rules: (args.plan?.constraints ?? []).filter((c) => c.active).map((c) => (c.reason ? `${c.title}: ${c.reason}` : c.title)),
    equipment: EQUIPMENT, minutes: args.minutes, wish: args.wish.trim(),
  };
}

const clamp = (n: number | null | undefined, lo: number, hi: number) => (n == null ? undefined : Math.min(hi, Math.max(lo, Math.round(n))));

export function draftFromAi(r: AiWorkout, levels: Level[]): { exercises: WorkoutExercise[]; dropped: number } {
  const seen = new Set<string>();
  const out: WorkoutExercise[] = [];
  for (const x of r.exercises) {
    const e = exerciseById.get(x.id);
    if (!e || !levels.includes(e.level) || seen.has(e.id)) continue;
    seen.add(e.id);
    const sets = clamp(x.sets, 1, 5) ?? e.sets;
    const each = e.unilateral ? ' кожною' : '';
    const target = e.timed ? `${sets} × ${clamp(x.seconds, 10, 180) ?? 30} с${each}` : `${sets} × ${clamp(x.reps, 1, 30) ?? 8}${each}`;
    out.push(blankExercise({ ...e, sets, target }));
  }
  return { exercises: out, dropped: r.exercises.length - out.length };
}
