import { useLiveQuery } from 'dexie-react-hooks';
import type { DayEntry, Food, Wellbeing, Workout } from '../domain/types';
import { db, normalizePlan } from './db';

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
  return useLiveQuery(async () => normalizePlan(await db.plan.get('main')), []);
}

export function useWorkouts(): Workout[] | undefined {
  return useLiveQuery(() => db.workouts.orderBy('date').toArray(), []);
}

export function useWellbeing(date: string): Wellbeing | undefined | null {
  return useLiveQuery(async () => (await db.wellbeing.get(date)) ?? null, [date]);
}

export function useWeights() {
  return useLiveQuery(() => db.weights.orderBy('date').toArray(), []);
}

export function useLabs() {
  return useLiveQuery(() => db.labs.toArray(), []);
}

export function useAllWellbeing() {
  return useLiveQuery(() => db.wellbeing.toArray(), []);
}

/** All entries — a personal diary stays small (a few thousand rows a year). */
export function useAllEntries() {
  return useLiveQuery(() => db.entries.orderBy('at').toArray(), []);
}

/** Dishes to eat — a draft «Потрібен склад» (D123) has no lines and is not in the meal search, the menu or the assistant. */
export function useRecipes() {
  return useLiveQuery(() => db.recipes.orderBy('name').filter((r) => !r.needsMake).toArray(), []);
}
/** «Мої страви»: every dish, drafts too. */
export function useAllRecipes() {
  return useLiveQuery(() => db.recipes.orderBy('name').toArray(), []);
}

export function useFavorites() {
  return useLiveQuery(() => db.favorites.orderBy('title').toArray(), []);
}
