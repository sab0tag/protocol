// Pure nutrition arithmetic: no React, no storage.
import type { DayEntry, Food, MealItem, Mode, Nutrients, Plan, Targets } from './types';

export const ZERO: Required<Nutrients> = { kcal: 0, protein: 0, fat: 0, carbs: 0, calciumMg: 0 };

/** Nutrients of one meal line: the food's per-100 g values × grams, or the hand-entered values of a free line. */
export function itemNutrients(item: MealItem, food: Food | undefined): Required<Nutrients> {
  if (item.manual) return { ...ZERO, ...item.manual, calciumMg: item.manual.calciumMg ?? 0 };
  if (!food) return { ...ZERO };
  const k = item.grams / 100;
  const p = food.per100g;
  return {
    kcal: p.kcal * k,
    protein: p.protein * k,
    fat: p.fat * k,
    carbs: p.carbs * k,
    calciumMg: (p.calciumMg ?? 0) * k,
  };
}

export function add(a: Required<Nutrients>, b: Required<Nutrients>): Required<Nutrients> {
  return {
    kcal: a.kcal + b.kcal,
    protein: a.protein + b.protein,
    fat: a.fat + b.fat,
    carbs: a.carbs + b.carbs,
    calciumMg: a.calciumMg + b.calciumMg,
  };
}

export function mealNutrients(items: MealItem[], foods: Map<string, Food>): Required<Nutrients> {
  return items.reduce((sum, it) => add(sum, itemNutrients(it, it.foodId ? foods.get(it.foodId) : undefined)), { ...ZERO });
}

export interface DayTotals extends Required<Nutrients> {
  waterMl: number;
}

/** What was actually eaten and drunk: only «done» entries count. */
export function dayTotals(entries: DayEntry[], foods: Map<string, Food>): DayTotals {
  let n = { ...ZERO };
  let waterMl = 0;
  for (const e of entries) {
    if (e.status !== 'done') continue;
    if (e.kind === 'meal' && e.items) n = add(n, mealNutrients(e.items, foods));
    if (e.kind === 'water') waterMl += e.waterMl ?? 0;
  }
  return { ...n, waterMl };
}

/** The mode in force on a date (the first one if several overlap) and which day of it this is. */
export function activeMode(plan: Plan | undefined, date: string): { mode: Mode; day: number; of: number } | undefined {
  const mode = plan?.modes.find((m) => m.from <= date && date <= m.to);
  if (!mode) return undefined;
  return { mode, day: daysBetween(mode.from, date) + 1, of: daysBetween(mode.from, mode.to) + 1 };
}

/** Plan targets with the active mode's overrides on top (carbs are merged, not replaced half-way). */
export function effectiveTargets(plan: Plan | undefined, date: string): Targets {
  const base = plan?.targets ?? {};
  const active = activeMode(plan, date);
  if (!active) return base;
  const o = active.mode.targetsOverride;
  return { ...base, ...o, carbsG: o.carbsG ? { ...o.carbsG } : base.carbsG };
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000);
}

/** For search and the rules (SPEC.md §6.1): lower case, no apostrophes, single spaces. */
export function normalize(text: string): string {
  return text.toLocaleLowerCase('uk').replace(/['’ʼ`]/g, '').replace(/\s+/g, ' ').trim();
}

export function round(n: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
