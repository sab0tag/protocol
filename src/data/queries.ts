import { useLiveQuery } from 'dexie-react-hooks';
import type { DayEntry, Food, Wellbeing, Workout } from '../domain/types';
import { db } from './db';

export function useDayEntries(date: string): DayEntry[] | undefined {
  return useLiveQuery(() => db.entries.where('at').startsWith(date).sortBy('at'), [date]);
}

/** Entries of the `days` days up to `date` (for «liver once a week»). */
export function useRecentEntries(date: string, days = 7): DayEntry[] | undefined {
  return useLiveQuery(() => {
    const from = new Date(Date.parse(date + 'T00:00:00Z') - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    return db.entries.where('at').between(from, date + '\uffff').toArray();
  }, [date, days]);
}

export function useFoods(): Map<string, Food> | undefined {
  return useLiveQuery(async () => new Map((await db.foods.toArray()).map((f) => [f.id, f])), []);
}

export function usePlan() {
  return useLiveQuery(() => db.plan.get('main'), []);
}

export function useWorkouts(): Workout[] | undefined {
  return useLiveQuery(() => db.workouts.orderBy('date').toArray(), []);
}

export function useWellbeing(date: string): Wellbeing | undefined | null {
  return useLiveQuery(async () => (await db.wellbeing.get(date)) ?? null, [date]);
}
