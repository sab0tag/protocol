// D169 («Очередь агента» 18.11, task 3): water in litres, and the doctor's norm («пити не менше», `waterMl`) told apart
// from the doctor's limit («не більше», `waterMaxMl`). Under a limit every drink counts — tea, coffee, milk, kefir, juice and
// the liquid of a soup from the food diary — because a fluid limit (heart, kidneys) is about all of it. Pure.
import { dateOf } from './dates';
import type { DayEntry, Food, ISODate, MealItem, Targets } from './types';

/** A food the person drinks — the base's «drink» tag, or «Це напій» ticked on their own food. */
export const DRINK_TAG = 'drink';

/** Liquids in the base that are not tagged «drink» (they are dairy or sweet for the rules) — counted whole. */
const DRUNK: ReadonlySet<string> = new Set(['milk', 'lactose-free-milk', 'kefir', 'kefir-1', 'ayran', 'orange-juice']);

/** The share of liquid in a soup by weight (reference values, D169): a broth is all liquid, a thick soup about four
 *  fifths. A dish made of ingredients (борщ, курячий суп) counts the liquid of what is in it. */
const SOUP_SHARE: Readonly<Record<string, number>> = { 'broth-chicken': 1, 'soup-veg': 0.8 };
const SOUP_DEFAULT = 0.8;

export function liquidShare(food: Food | undefined): number {
  if (!food) return 0;
  if (food.tags.includes(DRINK_TAG) || DRUNK.has(food.id)) return 1;
  if (food.tags.includes('soup')) return SOUP_SHARE[food.id] ?? SOUP_DEFAULT;
  return 0;
}

/** How the person would name it in a list: «чай», «кава», «кефір», «суп», «борщ». */
function word(name: string): string {
  const soup = /(борщ|бульйон|суп|юшка|солянка|розсольник|окрошка)/iu.exec(name);
  return (soup ? soup[1]! : name.split(/[\s,(]/u)[0]!).toLowerCase();
}

/** Millilitres of liquid in one meal line (1 g ≈ 1 ml); a dish counts its ingredients. */
function lineMl(item: MealItem, foods: Map<string, Food>): number {
  if (item.components?.length) return item.components.reduce((ml, c) => ml + lineMl(c, foods), 0);
  return item.foodId ? item.grams * liquidShare(foods.get(item.foodId)) : 0;
}

export interface DayFluid {
  /** water marked as water */
  waterMl: number;
  /** the liquid in drinks and soups written as food */
  drinksMl: number;
  /** what those drinks were, in words, in the order first drunk */
  drinks: string[];
  totalMl: number;
}

export function dayFluid(entries: readonly DayEntry[], foods: Map<string, Food>, date?: ISODate): DayFluid {
  let waterMl = 0, drinksMl = 0;
  const drinks: string[] = [];
  for (const e of entries) {
    if (e.status !== 'done' || (date && dateOf(e.at) !== date)) continue;
    if (e.kind === 'water') waterMl += e.waterMl ?? 0;
    if (e.kind !== 'meal' || !e.items) continue;
    for (const item of e.items) {
      const ml = lineMl(item, foods);
      if (ml < 1) continue;
      drinksMl += ml;
      const w = word(item.name);
      if (!drinks.includes(w)) drinks.push(w);
    }
  }
  drinksMl = Math.round(drinksMl);
  return { waterMl, drinksMl, drinks, totalMl: waterMl + drinksMl };
}

/** What the plan says about water: a limit wins over a norm (the doctor's «не більше» is the safety one). */
export type WaterState =
  | { kind: 'limit'; totalMl: number; maxMl: number; leftMl: number; overMl: number }
  | { kind: 'norm'; totalMl: number; normMl: number; met: boolean; overMl: number }
  | { kind: 'free'; totalMl: number };

export function waterState(fluid: DayFluid, targets: Pick<Targets, 'waterMl' | 'waterMaxMl'> | undefined): WaterState {
  const max = targets?.waterMaxMl, norm = targets?.waterMl;
  if (max) return { kind: 'limit', totalMl: fluid.totalMl, maxMl: max, leftMl: Math.max(0, max - fluid.totalMl), overMl: Math.max(0, fluid.totalMl - max) };
  if (norm) return { kind: 'norm', totalMl: fluid.totalMl, normMl: norm, met: fluid.totalMl >= norm, overMl: Math.max(0, fluid.totalMl - norm) };
  return { kind: 'free', totalMl: fluid.totalMl };
}

/** «1,0», «1,25», «2,5» — litres the way people say them, with a comma; at least one decimal. */
export const litres = (ml: number) => (ml === 0 ? '0' : (ml / 1000).toLocaleString('uk-UA', { minimumFractionDigits: 1, maximumFractionDigits: 2 }));

/** The state once `ml` more water is drunk — what the toast after «+250 мл» says. */
export function withWater(fluid: DayFluid, ml: number): DayFluid {
  return { ...fluid, waterMl: fluid.waterMl + ml, totalMl: fluid.totalMl + ml };
}
