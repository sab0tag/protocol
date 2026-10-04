import { useLiveQuery } from 'dexie-react-hooks';
import type { DayEntry, Food } from '../domain/types';
import { db } from './db';

export function useDayEntries(date: string): DayEntry[] | undefined {
  return useLiveQuery(() => db.entries.where('at').startsWith(date).sortBy('at'), [date]);
}

export function useFoods(): Map<string, Food> | undefined {
  return useLiveQuery(async () => new Map((await db.foods.toArray()).map((f) => [f.id, f])), []);
}

export function usePlan() {
  return useLiveQuery(() => db.plan.get('main'), []);
}
