// R03: one evaluation of food against the plan for every way in — the field, the voice window, the menu, the assistant, the
// evening tips, a repeat, an import. Pure: the same input gives the same answer. The context is built here from the person's
// entries, not passed half-empty by each caller (F03): the day's eaten food, kept apart from what is only planned; the last 7
// days for the rules that look back (liver once a week); the temporary mode of that date. Two intents: «recorded» — what was
// eaten, judged against what else was eaten; «proposed» — a forecast after adding it, with the day's planned meals too (the
// candidate itself excluded, never counted twice). A swap is offered only if the meal with it passes as a whole (R03).
import { addDays, format, parseISO } from 'date-fns';
import { dateOf } from './dates';
import { dietCoverage, type DietCoverage } from './diets';
import { activeMode } from './nutrition';
import { applySwaps, checkMeal, type ItemCheck } from './rules';
import type { DayEntry, Food, ISODate, MealItem, Plan } from './types';

export interface EvaluationContext {
  plan: Plan;
  date: ISODate;
  intent: 'recorded' | 'proposed';
  /** the person's entries — at least that day and the 7 before it; anything else is ignored */
  entries: DayEntry[];
  /** the entry being edited or added — it is the candidate, not part of the day */
  exclude?: string;
  foods: Map<string, Food>;
  meal: MealItem[];
}

export interface Evaluation { checks: ItemCheck[]; coverage: DietCoverage[] }

/** The day around a candidate: what the rules may count. */
export function contextOf(c: Omit<EvaluationContext, 'meal'>) {
  const weekAgo = format(addDays(parseISO(c.date), -7), 'yyyy-MM-dd');
  const meals = c.entries.filter((e) => e.kind === 'meal' && e.id !== c.exclude);
  const day = meals.filter((e) => dateOf(e.at) === c.date && (e.status === 'done' || (c.intent === 'proposed' && e.status === 'planned')));
  const recent = meals.filter((e) => { const d = dateOf(e.at); return e.status === 'done' && d < c.date && d >= weekAgo; });
  const mode = activeMode(c.plan, c.date)?.mode;
  return { plan: c.plan, date: c.date, foods: c.foods, dayEntries: day, recentEntries: recent, ...(mode ? { activeMode: mode } : {}) };
}

export function evaluate(c: EvaluationContext): Evaluation {
  return { checks: checkMeal({ ...contextOf(c), meal: c.meal }), coverage: dietCoverage(c.plan) };
}

/** A candidate passes: no hit at all for it, in the context of the day (a suggestion, a tip, a top-up). */
export const passes = (c: Omit<EvaluationContext, 'meal' | 'intent'>, item: MealItem): boolean =>
  evaluate({ ...c, intent: 'proposed', meal: [item] }).checks.every((x) => x.hits.length === 0);

/** «Записати заміну» only with swaps that keep the meal within the plan as a whole: a replacement that breaks another limit (or
 *  is itself flagged) is not offered — its hit stays, without a swap, «заміни, що підходить, немає». One pass, never a chain. */
export function safeSwaps(c: Omit<EvaluationContext, 'meal'>, checks: ItemCheck[]): { checks: ItemCheck[]; swapped: MealItem[] } {
  const strip = (x: ItemCheck): ItemCheck => ({ ...x, hits: x.hits.map((h) => (h.swap && h.swap.kind !== 'drop'
    ? { ...h, swap: undefined, suggestion: undefined, noSwap: true } : h)), ...(x.parts ? { parts: x.parts.map(strip) } : {}) });
  const out = checks.map((x) => {
    if (!x.hits.some((h) => h.swap && h.swap.kind !== 'drop')) return x;
    const [after] = applySwaps([x], c.foods);
    if (!after) return x; // dropped
    const others = checks.filter((y) => y !== x).map((y) => y.item);
    const again = evaluate({ ...c, intent: 'proposed', meal: [after, ...others] }).checks[0]!;
    return again.hits.length ? strip(x) : x;
  });
  return { checks: out, swapped: applySwaps(out, c.foods) };
}
