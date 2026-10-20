// The dish check (SPEC.md §6): deterministic pure functions, no React, no storage. A rule fires only when
// its constraint is active in the plan; it speaks only the words of the SPEC rule table.
import { dateOf } from '../dates';
import { itemNutrients, normalize } from '../nutrition';
import { dietOf } from '../diets';
import type { ConstraintTag, DayEntry, EstTag, Food, ISODate, MealItem, Mode, Plan } from '../types';
import * as K from './keywords.uk';
import { allergyHits, planAllergies } from '../allergens';
import { t } from '../../i18n/uk';

const ALLERGEN_NAME = t.allergen.name;

export type Verdict = 'ok' | 'replace' | 'remove' | 'adjust';

/** What «Записати заміну» does with an item (decision D13). */
export type Swap =
  | { kind: 'food'; foodId: string; grams: 'same' | 'same-carbs' }
  | { kind: 'cooking'; cooking: 'airfryer' }
  | { kind: 'drop' };

export interface RuleHit {
  itemName: string;
  verdict: Verdict;
  message: string;
  reason: ConstraintTag;
  suggestion?: string;
  swap?: Swap;
}

export interface RuleContext {
  plan: Plan;
  activeMode?: Mode;
  dayEntries: DayEntry[]; // the day's other entries (this meal excluded)
  date: ISODate;
  /** D14: the whole meal (for «add calcium to this meal») and the last days (liver once a week). */
  meal: MealItem[];
  recentEntries: DayEntry[];
  foods: Map<string, Food>;
}

export type Rule = (item: MealItem, food: Food | undefined, ctx: RuleContext) => RuleHit | null;

// ------------------------------------------------------------------ matching
const startsWord = (name: string, stem: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(name);
export const matchesAny = (name: string, stems: string[]) => stems.some((s) => startsWord(normalize(name), normalize(s)));

/** D111: what the model marked an estimated ingredient as — read only for such lines (a base food has its own tags). */
const est = (it: MealItem, tag: EstTag) => !!it.est?.tags.includes(tag);
const active = (ctx: RuleContext, tag: ConstraintTag) => ctx.plan.constraints.some((c) => c.tag === tag && c.active);
const carbsMin = (ctx: RuleContext) => ctx.activeMode?.targetsOverride.carbsG?.min;

// ------------------------------------------------------------------ rules (SPEC §6.1)
const oxalate: Rule = (item, _food, ctx) => {
  if (!active(ctx, 'oxalate')) return null;
  if (matchesAny(item.name, K.OXALATE_HIGH) || est(item, 'oxalate-high'))
    return { itemName: item.name, verdict: 'replace', reason: 'oxalate', message: 'Багато оксалатів',
      suggestion: 'Броколі, капуста, огірок', swap: { kind: 'food', foodId: 'broccoli', grams: 'same' } };
  if (matchesAny(item.name, K.OXALATE_NUTS) && item.grams > K.NUTS_OXALATE_G)
    return { itemName: item.name, verdict: 'replace', reason: 'oxalate', message: 'Багато оксалатів',
      suggestion: `Не більше ${K.NUTS_OXALATE_G} г` };
  return null;
};

const isOxalateish = (it: MealItem) =>
  matchesAny(it.name, K.OXALATE_HIGH) || matchesAny(it.name, K.OXALATE_MODERATE) || matchesAny(it.name, K.OXALATE_NUTS) || est(it, 'oxalate-high');
const isCalciumSource = (it: MealItem, foods: Map<string, Food>) =>
  (it.foodId !== undefined && foods.get(it.foodId)?.tags.includes('calcium')) || matchesAny(it.name, K.CALCIUM_SOURCES) || est(it, 'calcium');

/** Said once per meal, on its first oxalate item: «Додайте кальцій у цей прийом». */
const oxalateCalcium: Rule = (item, _food, ctx) => {
  if (!active(ctx, 'oxalate')) return null;
  const first = ctx.meal.find(isOxalateish);
  if (first !== item || ctx.meal.some((it) => isCalciumSource(it, ctx.foods))) return null;
  return { itemName: item.name, verdict: 'adjust', reason: 'oxalate', message: 'Додайте кальцій у цей прийом',
    suggestion: '25 г твердого сиру або кефір' };
};

const gallbladder: Rule = (item, _food, ctx) => {
  if (!active(ctx, 'gallbladder')) return null;
  if (item.cooking === 'fried' || matchesAny(item.name, K.GALLBLADDER) || est(item, 'fried') || est(item, 'fatty'))
    return { itemName: item.name, verdict: 'replace', reason: 'gallbladder', message: est(item, 'fatty') && !est(item, 'fried') ? 'Жирне навантажує жовчний' : 'Смажене навантажує жовчний',
      suggestion: 'Аерогриль, запікання', ...(item.cooking === 'fried' ? { swap: { kind: 'cooking' as const, cooking: 'airfryer' as const } } : {}) };
  return null;
};

const lactose: Rule = (item, food, ctx) => {
  if (!active(ctx, 'lactose') || food?.tags.includes('dairy-low-lactose') || food?.tags.includes('cheese-aged') || est(item, 'cheese-aged')) return null;
  if (!matchesAny(item.name, K.LACTOSE) && !est(item, 'lactose')) return null;
  const milk = matchesAny(item.name, ['молоко']);
  return { itemName: item.name, verdict: 'replace', reason: 'lactose', message: 'Лактоза',
    suggestion: 'Кефір, тверді витримані сири, безлактозне',
    ...(milk ? { swap: { kind: 'food' as const, foodId: 'kefir', grams: 'same' as const } } : {}) };
};

/** D81: sugar added to a drink — «з цукром» and the like, never «без цукру». The same drink without it is the swap. */
const ADDED_SUGAR = /(^|[\s(])(з|із|зі)?\s*цукр/u, NO_SUGAR = /без\s+цукр/u;
const UNSWEETENED: Record<string, string> = { 'tea-sugar': 'tea', 'coffee-sugar': 'coffee' };
const addedSugar = (name: string) => { const n = normalize(name); return ADDED_SUGAR.test(n) && !NO_SUGAR.test(n); };

const glycemic: Rule = (item, food, ctx) => {
  if (!active(ctx, 'glycemic') || food?.tags.includes('condiment')) return null; // a teaspoon of lemon juice is no «сік»
  const toSlow: Swap = { kind: 'food', foodId: 'buckwheat', grams: 'same-carbs' };
  const preparing = carbsMin(ctx) !== undefined; // §6.2: a mode with a carbs minimum never cuts carbs
  if (!preparing && addedSugar(item.name)) {
    const plain = item.foodId ? UNSWEETENED[item.foodId] : undefined;
    return { itemName: item.name, verdict: plain ? 'replace' : 'remove', reason: 'glycemic', message: 'Доданий цукор',
      suggestion: plain ? 'Без цукру' : 'Прибрати', swap: plain ? { kind: 'food', foodId: plain, grams: 'same' } : { kind: 'drop' } };
  }
  // D81: sweets by what the food is, not only by its name («Сирок глазурований», «Курага»)
  const sweet = (!!food?.tags.includes('sweet') && !food.tags.includes('slow-carb')) || est(item, 'sweet');
  if (matchesAny(item.name, K.GLYCEMIC_REPLACE) || est(item, 'fast-carb') || (preparing && matchesAny(item.name, K.GLYCEMIC_REMOVE)))
    return { itemName: item.name, verdict: 'replace', reason: 'glycemic',
      message: preparing ? 'Швидкі вуглеводи — замініть на повільні, не зменшуючи кількість' : 'Швидкі вуглеводи',
      suggestion: 'Гречка, кіноа, бурий рис', swap: toSlow };
  if (!preparing && (sweet || matchesAny(item.name, K.GLYCEMIC_REMOVE)))
    return { itemName: item.name, verdict: 'remove', reason: 'glycemic', message: 'Швидкі вуглеводи',
      suggestion: 'Прибрати', swap: { kind: 'drop' } };
  return null;
};

const iron: Rule = (item, _food, ctx) => {
  if (!active(ctx, 'iron') || !matchesAny(item.name, K.LIVER)) return null;
  const since = shiftDate(ctx.date, -(K.LIVER_EVERY_DAYS - 1));
  const recently = ctx.recentEntries.some((e) => e.kind === 'meal' && e.status !== 'skipped'
    && dateOf(e.at) >= since && dateOf(e.at) <= ctx.date && flatItems(e.items).some((it) => matchesAny(it.name, K.LIVER)));
  if (!recently && item.grams <= K.LIVER_MAX_G) return null;
  return { itemName: item.name, verdict: 'adjust', reason: 'iron', message: `Печінка — раз на тиждень, до ${K.LIVER_MAX_G} г` };
};

const sodium: Rule = (item, _food, ctx) => {
  const isSalty = (it: MealItem) => matchesAny(it.name, K.SALTY) || est(it, 'salty');
  if (!active(ctx, 'sodium') || !isSalty(item)) return null;
  const salty = (items: MealItem[] = []) => items.filter(isSalty).reduce((g, it) => g + it.grams, 0);
  const day = ctx.dayEntries.filter((e) => e.kind === 'meal' && e.status !== 'skipped').reduce((g, e) => g + salty(flatItems(e.items)), 0);
  if (day + salty(ctx.meal) <= K.SODIUM_PORTION_G * K.SODIUM_MAX_PORTIONS) return null;
  return { itemName: item.name, verdict: 'adjust', reason: 'sodium', message: 'Багато солі за день' };
};

/** D58: an allergy confirmed by a doctor — a line that holds it goes («Прибрати»); a line whose make-up is unknown
 *  (a free line, an own food never checked against its package) is flagged, never passed as safe. */
const allergy: Rule = (item, food, ctx) => {
  const want = planAllergies(ctx.plan);
  if (!want.size) return null;
  // D111: an estimated ingredient whose estimate names an allergy of the plan goes; one that names none is still not known
  const said = (item.est?.allergens ?? []).filter((a) => want.has(a));
  if (said.length) return { itemName: item.name, verdict: 'remove', reason: 'allergy', message: `Алергія: ${said.map((a) => ALLERGEN_NAME[a]).join(', ')} (за оцінкою ІІ)`,
    suggestion: 'Прибрати', swap: { kind: 'drop' } };
  if (!food || (food.custom && !food.allergens))
    return { itemName: item.name, verdict: 'adjust', reason: 'allergy', message: item.est ? 'Склад оцінено ІІ — перевірте на алергени' : 'Склад невідомий — перевірте на алергени' };
  const hit = allergyHits(food, want);
  if (!hit.length) return null;
  return { itemName: item.name, verdict: 'remove', reason: 'allergy', message: `Алергія: ${hit.map((a) => ALLERGEN_NAME[a]).join(', ')}`,
    suggestion: 'Прибрати', swap: { kind: 'drop' } };
};

/** D90: a diet of Наказ №931 — its rules that a dietitian checked and the person did not switch off. Unchecked — silent. */
const diet: Rule = (item, food, ctx) => {
  for (const c of ctx.plan.constraints) {
    if (c.tag !== 'diet' || !c.active) continue;
    for (const r of dietOf(c.diet)?.rules ?? []) {
      if (!r.checkedBy || c.off?.includes(r.id)) continue;
      const m = r.match, name = normalize(item.name);
      const hit = (m.cooking?.includes(item.cooking!) ?? false) || (m.words?.some((w) => name.includes(normalize(w))) ?? false)
        || (m.tags?.some((tg) => food?.tags.includes(tg) || (item.est?.tags as string[] | undefined)?.includes(tg)) ?? false);
      if (hit) return { itemName: item.name, verdict: r.kind === 'exclude' ? 'remove' : 'adjust', reason: 'diet',
        message: `${c.diet}: ${r.title}`, ...(r.kind === 'exclude' ? { suggestion: 'Прибрати', swap: { kind: 'drop' as const } } : {}) };
    }
  }
  return null;
};

export const RULES: Rule[] = [allergy, oxalate, oxalateCalcium, gallbladder, lactose, glycemic, iron, sodium, diet];

// ------------------------------------------------------------------ the meal as a whole (SPEC §6.3)
export interface ItemCheck {
  item: MealItem;
  hits: RuleHit[]; // empty = «Так»; for a dish — the hits of its ingredients
  parts?: ItemCheck[]; // D27: a dish, ingredient by ingredient
}

/** Dishes opened up into their ingredients. */
export const flatItems = (items: MealItem[] = []): MealItem[] => items.flatMap((it) => (it.components?.length ? it.components : [it]));

/** Every rule runs on the ingredients (a dish is checked by what is in it — D27); the result is per meal line. */
export function checkMeal(ctx: RuleContext): ItemCheck[] {
  const fctx = { ...ctx, meal: flatItems(ctx.meal) };
  const one = (item: MealItem): ItemCheck => {
    const food = item.foodId ? ctx.foods.get(item.foodId) : undefined;
    return { item, hits: RULES.map((r) => r(item, food, fctx)).filter((h): h is RuleHit => h !== null) };
  };
  return ctx.meal.map((item) => {
    if (!item.components?.length) return one(item);
    const parts = item.components.map(one);
    return { item, hits: parts.flatMap((p) => p.hits), parts };
  });
}

export interface MealVerdict {
  fits: boolean; // «Підходить» / what needs attention (D74)
  okCount: number;
  total: number;
}

export function mealVerdict(checks: ItemCheck[]): MealVerdict {
  const okCount = checks.filter((c) => c.hits.every((h) => h.verdict === 'ok')).length;
  return { fits: okCount === checks.length, okCount, total: checks.length };
}

/** «Записати заміну»: every swap an item's hits offer, together — drop wins; then the food swap (first one);
 *  then the cooking swap, so «spinach, fried» becomes «broccoli, air fryer», not «broccoli, fried». */
export function applySwaps(checks: ItemCheck[], foods: Map<string, Food>): MealItem[] {
  const out: MealItem[] = [];
  for (const { item, hits, parts } of checks) {
    if (parts) { // a dish: swap inside it
      const components = applySwaps(parts, foods);
      out.push({ ...item, components, grams: components.reduce((g, c) => g + c.grams, 0) });
      continue;
    }
    const swaps = hits.flatMap((h) => (h.swap ? [h.swap] : []));
    if (swaps.some((s) => s.kind === 'drop')) continue;
    let next: MealItem = item;
    const foodSwap = swaps.find((s): s is Extract<Swap, { kind: 'food' }> => s.kind === 'food');
    const food = foodSwap && foods.get(foodSwap.foodId);
    if (foodSwap && food) {
      let grams = item.grams;
      if (foodSwap.grams === 'same-carbs') {
        const carbs = itemNutrients(item, item.foodId ? foods.get(item.foodId) : undefined).carbs;
        // Unknown carbs (a free line without nutrients): a usual dry-grain portion, shown before saving.
        grams = carbs > 0 && food.per100g.carbs > 0 ? Math.round((carbs / food.per100g.carbs) * 100) : K.DEFAULT_GRAIN_PORTION_G;
      }
      next = { foodId: food.id, name: food.name, grams, ...(item.cooking ? { cooking: item.cooking } : {}) };
    }
    const cookingSwap = swaps.find((s): s is Extract<Swap, { kind: 'cooking' }> => s.kind === 'cooking');
    if (cookingSwap) next = { ...next, cooking: cookingSwap.cooking };
    out.push(next);
  }
  return out;
}

export const hasSwaps = (checks: ItemCheck[]): boolean => checks.some((c) => c.hits.some((h) => h.swap));

function shiftDate(date: ISODate, days: number): ISODate {
  const d = new Date(Date.parse(date + 'T00:00:00Z') + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}
