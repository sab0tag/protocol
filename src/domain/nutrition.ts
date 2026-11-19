// Pure nutrition arithmetic: no React, no storage.
import { EXTRA_KEYS, type DayEntry, type ExtraKey, type Food, type MealItem, type Mode, type Plan, type Targets } from './types';

/** A sum: the five always counted, and the four a table may not know (D188) — `partial` names those some line did not know,
 *  so their sum is «не менше …», never a full number. */
export interface Sum { kcal: number; protein: number; fat: number; carbs: number; calciumMg: number
  sodiumMg: number; fiberG: number; sugarsG: number; satFatG: number; partial: Partial<Record<ExtraKey, true>> }
export const ZERO: Sum = { kcal: 0, protein: 0, fat: 0, carbs: 0, calciumMg: 0, sodiumMg: 0, fiberG: 0, sugarsG: 0, satFatG: 0, partial: {} };

function extras(src: Partial<Record<ExtraKey, number>> | undefined, k: number, counts: boolean): Pick<Sum, ExtraKey | 'partial'> {
  const out = { sodiumMg: 0, fiberG: 0, sugarsG: 0, satFatG: 0, partial: {} as Sum['partial'] };
  for (const key of EXTRA_KEYS) {
    const v = src?.[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v * k;
    else if (counts) out.partial[key] = true; // a line that weighs something and does not know it: the sum is «не менше»
  }
  return out;
}

/** Nutrients of one meal line: the food's per-100 g values × grams, or the hand-entered values of a free line. */
export function itemNutrients(item: MealItem, food: Food | undefined): Sum {
  const counts = item.grams > 0;
  if (item.manual) {
    const m = item.manual;
    return { kcal: m.kcal, protein: m.protein, fat: m.fat, carbs: m.carbs, calciumMg: m.calciumMg ?? 0, ...extras(m, 1, counts) };
  }
  if (!food) return { ...ZERO, ...extras(undefined, 0, counts) };
  const k = item.grams / 100;
  const p = food.per100g;
  return { kcal: p.kcal * k, protein: p.protein * k, fat: p.fat * k, carbs: p.carbs * k, calciumMg: (p.calciumMg ?? 0) * k, ...extras(p, k, counts) };
}

export function add(a: Sum, b: Sum): Sum {
  return {
    kcal: a.kcal + b.kcal, protein: a.protein + b.protein, fat: a.fat + b.fat, carbs: a.carbs + b.carbs, calciumMg: a.calciumMg + b.calciumMg,
    sodiumMg: a.sodiumMg + b.sodiumMg, fiberG: a.fiberG + b.fiberG, sugarsG: a.sugarsG + b.sugarsG, satFatG: a.satFatG + b.satFatG,
    partial: { ...a.partial, ...b.partial },
  };
}

/** D188: salt in grams from sodium (salt = sodium × 2.5). */
export const saltG = (sodiumMg: number) => (sodiumMg * 2.5) / 1000;
/** D188: grams of salt to a person — one decimal, a comma */
export const gramsText = (g: number) => (Math.round(g * 10) / 10).toLocaleString('uk-UA', { maximumFractionDigits: 1 });

/** D188: the plan limits salt (its «sodium» rule); the grams when its words say them — «сіль до 5 г», «не більше 6 г на добу».
 *  No rule — null: salt is then only in the details, like the other three. */
export function saltLimit(plan: Pick<Plan, 'constraints'> | undefined): { maxG?: number } | null {
  const c = plan?.constraints.find((x) => x.active && x.tag === 'sodium');
  if (!c) return null;
  const m = `${c.title} ${c.reason ?? ''}`.match(/(\d+(?:[.,]\d+)?)\s*(?:г|g)(?!\p{L})/u);
  const g = m ? Number(m[1]!.replace(',', '.')) : NaN;
  return g > 0 && g <= 15 ? { maxG: g } : {};
}
/** «сіль ~3,8 г з 5» — the day's (or a meal's) salt against the plan's limit; «не менше» when some line did not know its sodium */
export function saltLine(sum: Pick<Sum, 'sodiumMg' | 'partial'>, limit: { maxG?: number }, text: (have: string, max: string | undefined, partial: boolean) => string): string {
  return text(gramsText(saltG(sum.sodiumMg)), limit.maxG !== undefined ? gramsText(limit.maxG) : undefined, !!sum.partial.sodiumMg);
}

/** D188: kcal the macros give — 4 × protein + 9 × fat + 4 × carbohydrates. */
export const kcalFromMacros = (protein: number, fat: number, carbs: number) => 4 * protein + 9 * fat + 4 * carbs;
/** D188: the kcal said and the kcal of the macros differ by more than 20 % — the macros' number for «Перевірте»; never a block
 *  (alcohol and fibre make an honest difference). Tiny values (< 20 kcal both) are not checked. */
export function kcalOff(kcal: number, protein: number, fat: number, carbs: number): number | null {
  const e = kcalFromMacros(protein, fat, carbs);
  if (e < 20 && kcal < 20) return null;
  return Math.abs(kcal - e) / Math.max(e, 1) > 0.2 ? Math.round(e) : null;
}
/** D188: the four of a per-100 g, scaled — for a food turned into a free line (only those it knows; unknown stays unknown). */
export function scaledExtras(p: Partial<Record<ExtraKey, number | undefined>>, k: number): Partial<Record<ExtraKey, number>> {
  const out: Partial<Record<ExtraKey, number>> = {};
  for (const key of EXTRA_KEYS) { const v = p[key]; if (typeof v === 'number') out[key] = v * k; }
  return out;
}

/** One meal line: a dish sums its components, anything else is the food (or the hand-entered values). */
export function lineNutrients(item: MealItem, foods: Map<string, Food>): Sum {
  if (item.components?.length) return mealNutrients(item.components, foods);
  return itemNutrients(item, item.foodId ? foods.get(item.foodId) : undefined);
}

export function mealNutrients(items: MealItem[], foods: Map<string, Food>): Sum {
  return items.reduce((sum, it) => add(sum, lineNutrients(it, foods)), { ...ZERO });
}

export interface DayTotals extends Sum {
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
  // D183: the person's own weight goal fills only what the plan leaves empty — a doctor's number always wins
  const own: Targets = plan?.ownGoal ? { kcal: plan.ownGoal.kcal, proteinG: plan.ownGoal.proteinG[0] } : {};
  const base = { ...own, ...Object.fromEntries(Object.entries(plan?.targets ?? {}).filter(([, v]) => v !== undefined)) } as Targets;
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
