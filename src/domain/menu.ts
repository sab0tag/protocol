// «Меню на завтра» (SPEC.md D33): what goes to the model and what comes back. Pure. The model only proposes
// names and grams; amounts, nutrients and the dish check come from the app's own base and rules.
import { applySwaps, checkMeal, type RuleHit } from './rules';
import { itemFor } from './foodSearch';
import { activeMode, effectiveTargets, mealNutrients, normalize, ZERO, add } from './nutrition';
import { setPortions, sumGrams } from './recipes';
import type { DayEntry, Food, ISODate, MealItem, Nutrients, Plan, Recipe } from './types';

export interface MenuResult {
  /** `line` — an existing meal line taken as is (D37: «Як учора», an edited draft); the model never sends it */
  meals: { title: string; time: string; items: { name: string; grams: number; count: number | null; line?: MealItem }[] }[];
  tips: string[];
}

export interface MenuDraftMeal {
  title: string;
  time: string;
  items: MealItem[];
  notes: string[]; // what the app changed or still warns about (the rule table's words)
}

export interface MenuDraft {
  date: ISODate;
  meals: MenuDraftMeal[];
  tips: string[];
}

/** The plan's numbers for that day (the active mode included) and the active limits in words. */
export function menuRequest(plan: Plan, date: ISODate) {
  const tg = effectiveTargets(plan, date);
  const targets: Record<string, number | string> = {};
  if (tg.kcal) targets.kcal = tg.kcal;
  if (tg.proteinG) targets.proteinG = tg.proteinG;
  if (tg.carbsG?.min != null) targets.carbsMinG = tg.carbsG.min;
  if (tg.carbsG?.max != null) targets.carbsMaxG = tg.carbsG.max;
  if (tg.fatG) targets.fatG = tg.fatG;
  if (tg.calciumMg) targets.calciumMg = tg.calciumMg;
  if (tg.waterMl) targets.waterMl = tg.waterMl;
  if (tg.lastMealBy) targets.lastMealBy = tg.lastMealBy;
  const rules = plan.constraints.filter((c) => c.active).map((c) => (c.reason ? `${c.title}: ${c.reason}` : c.title));
  const mode = activeMode(plan, date);
  if (mode) rules.push(...mode.mode.notes.map((n) => `${mode.mode.title}: ${n}`));
  return { targets, rules };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const round5 = (g: number) => Math.max(5, Math.round(g / 5) * 5);
const half = (q: number) => Math.max(0.5, Math.round(q * 2) / 2);

/** One line, scaled by `f`: pieces to whole ones, portions and spoons to halves, grams to 5 g. */
export function scaleLine(it: MealItem, f: number): MealItem {
  if (f === 1) return it;
  if (it.recipe && it.components) return setPortions(it, half(it.recipe.portions * f));
  if (it.unit) {
    const qty = it.unit.name.startsWith('шт') ? Math.max(1, Math.round(it.unit.qty * f)) : half(it.unit.qty * f); // whole eggs
    return { ...it, unit: { ...it.unit, qty }, grams: Math.round(qty * it.unit.grams) };
  }
  return { ...it, grams: round5(it.grams * f) };
}

export function draftFrom(result: MenuResult, ctx: {
  plan: Plan; date: ISODate; foods: Map<string, Food>; recipes: Recipe[]; recentEntries: DayEntry[];
  dishItem: (r: Recipe, portions: number) => MealItem; scale?: boolean;
  /** D54: while the draft is being edited a meal emptied by ✕ stays, so something can be added to it again. */
  keepEmpty?: boolean;
}): MenuDraft {
  const { plan, date, foods, recipes } = ctx;
  const byName = new Map<string, Food | Recipe>();
  for (const f of foods.values()) byName.set(normalize(f.name), f);
  for (const r of recipes) byName.set(normalize(r.name), r);
  const lastBy = effectiveTargets(plan, date).lastMealBy;
  const mode = activeMode(plan, date)?.mode;

  const meals: MenuDraftMeal[] = [];
  for (const m of result.meals) {
    let items: MealItem[] = [];
    for (const x of m.items) {
      if (x.line) { items.push(x.line); continue; }
      const hit = byName.get(normalize(x.name));
      if (!hit || !(x.grams > 0)) continue;
      if ('items' in hit) {
        const one = sumGrams(hit.items) || x.grams;
        items.push(ctx.dishItem(hit, half(x.grams / one)));
      } else {
        items.push(x.count && hit.units?.length ? itemFor(hit, { qty: x.count }) : itemFor(hit, { qty: Math.round(x.grams), measure: 'г' }));
      }
    }
    if (items.length === 0) {
      if (ctx.keepEmpty) meals.push({ title: m.title, time: HHMM.test(m.time) ? m.time : '13:00', items: [], notes: [] });
      continue;
    }
    let time = HHMM.test(m.time) ? m.time : '13:00';
    if (lastBy && time > lastBy) time = lastBy;

    // the app's own dish check: take every swap it offers, keep what it still warns about
    const others = meals.map((d, i): DayEntry => ({ id: `d${i}`, at: `${date}T${d.time}:00`, kind: 'meal', status: 'planned', title: d.title, items: d.items }));
    const check = (meal: MealItem[]) => checkMeal({ plan, activeMode: mode, dayEntries: others, date, meal, recentEntries: ctx.recentEntries, foods });
    const first = check(items);
    const notes: string[] = [];
    const swapped = applySwaps(first, foods);
    first.forEach((c) => {
      const changed = c.hits.filter((h) => h.swap);
      if (changed.length) notes.push(`${c.item.name}: ${changed.map((h) => h.message).join(', ')} — замінено`);
    });
    items = swapped;
    const warn = (hits: RuleHit[]) => hits.filter((h) => h.verdict !== 'ok' && !h.swap);
    for (const c of check(items)) for (const h of warn(c.hits)) notes.push(`${h.itemName}: ${h.message}${h.suggestion ? ` (${h.suggestion})` : ''}`);
    meals.push({ title: m.title, time, items, notes: [...new Set(notes)] });
  }
  meals.sort((a, b) => a.time.localeCompare(b.time));

  // portions to the calorie target (±10 % is left as is; never more than a quarter either way)
  const kcal = effectiveTargets(plan, date).kcal;
  const total = draftTotals(meals, foods).kcal;
  if (ctx.scale !== false && kcal && total > 0 && Math.abs(total / kcal - 1) > 0.1) {
    const f = Math.min(1.25, Math.max(0.75, kcal / total));
    for (const m of meals) m.items = m.items.map((it) => scaleLine(it, f));
  }
  return { date, meals, tips: result.tips.map((s) => s.trim()).filter(Boolean).slice(0, 5) };
}

export function draftTotals(meals: { items: MealItem[] }[], foods: Map<string, Food>): Required<Nutrients> {
  return meals.reduce((sum, m) => add(sum, mealNutrients(m.items, foods)), { ...ZERO });
}

/** «Прийняти»: planned meals for the day; an earlier menu's meals not yet ticked are replaced. */
export function acceptPlan(draft: MenuDraft, existing: DayEntry[], newId: () => string, atLocal: (d: ISODate, t: string) => string) {
  const remove = existing.filter((e) => e.menu && e.status === 'planned').map((e) => e.id);
  const add: DayEntry[] = draft.meals.filter((m) => m.items.length).map((m, i) => ({
    id: newId(), at: atLocal(draft.date, m.time), kind: 'meal', status: 'planned', title: m.title, items: m.items,
    menu: i === 0 && draft.tips.length ? { tips: draft.tips } : {},
  }));
  return { remove, add };
}

// ------------------------------------------------------------------ editing a draft (D37)
const pieces = (it: MealItem) => (it.unit?.name.startsWith('шт') ? it.unit.qty : null);

/** A draft (or written meals) back to the model's shape — to check it again after an edit, or to start from. */
export function asResult(meals: { title: string; time: string; items: MealItem[] }[], tips: string[] = []): MenuResult {
  return { tips, meals: meals.map((m) => ({ title: m.title, time: m.time,
    items: m.items.map((it) => ({ name: it.name, grams: it.grams, count: pieces(it), line: it })) })) };
}

/** «Як учора»: the meals of the day before as a draft for `date` (no model, no cost). */
export function likeYesterday(entries: DayEntry[], date: ISODate): MenuResult | null {
  const prev = new Date(Date.parse(`${date}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const meals = entries.filter((e) => e.kind === 'meal' && e.status !== 'skipped' && e.items?.length && e.at.startsWith(prev))
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((e) => ({ title: e.title, time: e.at.slice(11, 16), items: e.items! }));
  return meals.length ? asResult(meals) : null;
}

const KEEP_GRAMS = new Set(['veg', 'fruit', 'condiment', 'fat']);

/** ↻: the next food of the same kind (first tag), or the next dish; about the same calories (vegetables and fruit
 *  keep their grams). Pass the current line; null when there is nothing to swap to. */
export function nextAlternative(it: MealItem, foods: Map<string, Food>, recipes: Recipe[], dishItem: (r: Recipe, portions: number) => MealItem): MealItem | null {
  if (it.recipe) {
    const list = [...recipes].sort((a, b) => a.name.localeCompare(b.name, 'uk'));
    if (list.length < 2) return null;
    const i = list.findIndex((r) => r.id === it.recipe!.id);
    return dishItem(list[(i + 1) % list.length]!, it.recipe.portions);
  }
  const food = it.foodId ? foods.get(it.foodId) : undefined;
  const tag = food?.tags[0];
  if (!food || !tag) return null;
  const dry = (f: Food) => /\((сух|сир)/i.test(f.name); // «Гречка (суха)», «Куряче філе (сире)» — not ready to eat
  const list = [...foods.values()].filter((f) => f.tags[0] === tag && dry(f) === dry(food)).sort((a, b) => a.name.localeCompare(b.name, 'uk'));
  if (list.length < 2) return null;
  const next = list[(list.findIndex((f) => f.id === food.id) + 1) % list.length]!;
  const kcal = (food.per100g.kcal * it.grams) / 100;
  const grams = KEEP_GRAMS.has(tag) || next.per100g.kcal <= 0 ? it.grams : Math.min(600, Math.max(20, Math.round(kcal / next.per100g.kcal * 100 / 5) * 5));
  return { foodId: next.id, name: next.name, grams, ...(it.cooking ? { cooking: it.cooking } : {}) };
}
