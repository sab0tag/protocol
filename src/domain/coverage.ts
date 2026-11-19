// D189 («Очередь агента», задача 11): an honest week. Coverage comes first — «записано днів: N з 7»; under 4 recorded days
// there are no averages and no conclusions, only «мало даних». Food averages count complete days only (all three meals
// written, or the person said «усе записано»); the rest are named, not averaged. A day with a context («хворів / свята /
// поїздка / інше», an extension of «Легкий день», D139) is marked and draws no conclusion.
import { addDays, format, parseISO } from 'date-fns';
import { dateOf } from './dates';
import { foodState } from './habits';
import { mealCategoryFor } from './mealCategory';
import { dayTotals, saltG } from './nutrition';
import type { DayEntry, Food, ISODate } from './types';

export const MIN_DAYS = 4;

/** A day with its food written in full: «усе записано» marked, or breakfast, lunch and dinner are there. */
export function dayComplete(day: DayEntry[]): boolean {
  if (foodState(day) === 'complete') return true;
  const slots = new Set(day.filter((e) => e.kind === 'meal' && e.status === 'done').map((e) => mealCategoryFor(e.title, e.at)));
  return ([0, 1, 2] as const).every((s) => slots.has(s));
}

export interface Coverage {
  /** calendar days in the period (up to today) */
  of: number;
  /** days with anything marked as done — a meal, a dose, water, a symptom, a workout */
  recorded: number;
  /** days with the food complete — the only days food averages count */
  complete: ISODate[];
  /** days with some food but not all of it — shown, never averaged */
  partial: ISODate[];
}

const FACT = new Set<DayEntry['kind']>(['meal', 'med', 'water', 'symptom', 'workout', 'note']);
/** `also` — dates recorded outside the day's entries: a weighing, a wellbeing score, a workout. */
export function recordCoverage(entries: DayEntry[], from: ISODate, to: ISODate, also: readonly ISODate[] = []): Coverage {
  const other = new Set(also);
  const byDay = new Map<ISODate, DayEntry[]>();
  for (const e of entries) {
    const d = dateOf(e.at);
    if (d < from || d > to) continue;
    byDay.set(d, [...(byDay.get(d) ?? []), e]);
  }
  let of = 0, recorded = 0;
  const complete: ISODate[] = [], partial: ISODate[] = [];
  for (let d = from; d <= to; d = format(addDays(parseISO(d), 1), 'yyyy-MM-dd')) {
    of += 1;
    const day = byDay.get(d) ?? [];
    if (other.has(d) || day.some((e) => e.status === 'done' && FACT.has(e.kind))) recorded += 1;
    if (dayComplete(day)) complete.push(d);
    else if (day.some((e) => e.kind === 'meal' && e.status === 'done')) partial.push(d);
  }
  return { of, recorded, complete, partial };
}

/** Food averages over complete days only — and only when there are at least MIN_DAYS of them. */
export interface FoodAverage { days: number; partial: number; kcal: number; protein: number; carbs: number; saltG?: number }
export function foodAverage(entries: DayEntry[], foods: Map<string, Food>, cov: Coverage): FoodAverage | undefined {
  if (cov.recorded < MIN_DAYS || cov.complete.length < MIN_DAYS) return undefined;
  const totals = cov.complete.map((d) => dayTotals(entries.filter((e) => dateOf(e.at) === d), foods));
  const avg = (f: (x: (typeof totals)[number]) => number) => Math.round(totals.reduce((a, x) => a + f(x), 0) / totals.length);
  const saltKnown = totals.every((x) => !x.partial.sodiumMg);
  return { days: totals.length, partial: cov.partial.length, kcal: avg((x) => x.kcal), protein: avg((x) => x.protein), carbs: avg((x) => x.carbs),
    ...(saltKnown ? { saltG: Math.round((totals.reduce((a, x) => a + saltG(x.sodiumMg), 0) / totals.length) * 10) / 10 } : {}) };
}
