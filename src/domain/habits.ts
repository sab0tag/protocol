// What a person usually eats (D28): frequent lines for an empty search, earlier meals of the same name to
// repeat, and the week in numbers for «Прогрес». Pure.
import { addDays, format, parseISO } from 'date-fns';
import { buildChecklist } from './checklist';
import { dateOf, timeOf } from './dates';
import { dayTotals, effectiveTargets } from './nutrition';
import type { DayEntry, Food, ISODate, MealItem, Plan, Workout } from './types';

const keyOf = (it: MealItem) => it.recipe ? `r:${it.recipe.id}` : it.foodId ? `f:${it.foodId}:${it.unit?.name ?? 'г'}` : `n:${it.name.toLowerCase()}`;

export interface Frequent { item: MealItem; count: number }

/** Lines eaten most often in the last `days` days, each with the amount used last time. */
export function frequentItems(entries: DayEntry[], today: ISODate, days = 30, limit = 8): Frequent[] {
  const since = format(addDays(parseISO(today), -days), 'yyyy-MM-dd');
  const seen = new Map<string, Frequent & { last: string }>();
  for (const e of entries) {
    if (e.kind !== 'meal' || e.status !== 'done' || dateOf(e.at) < since || dateOf(e.at) > today) continue;
    for (const it of e.items ?? []) {
      const k = keyOf(it);
      const prev = seen.get(k);
      if (!prev) seen.set(k, { item: it, count: 1, last: e.at });
      else { prev.count += 1; if (e.at > prev.last) { prev.item = it; prev.last = e.at; } }
    }
  }
  return [...seen.values()].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last)).slice(0, limit)
    .map(({ item, count }) => ({ item, count }));
}

/** Earlier meals with this title («Сніданок»), newest first, one per distinct set of lines. */
export function earlierMeals(entries: DayEntry[], title: string, before: ISODate, limit = 3): DayEntry[] {
  const out: DayEntry[] = [];
  const sigs = new Set<string>();
  const sorted = entries.filter((e) => e.kind === 'meal' && e.status !== 'skipped' && e.items?.length
    && e.title === title && dateOf(e.at) < before).sort((a, b) => b.at.localeCompare(a.at));
  for (const e of sorted) {
    const sig = e.items!.map((i) => `${keyOf(i)}:${i.grams}`).sort().join('|');
    if (sigs.has(sig)) continue;
    sigs.add(sig); out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

/** The meals of a day to copy («як учора»), at their own times. */
export const mealsOf = (entries: DayEntry[], date: ISODate) =>
  entries.filter((e) => e.kind === 'meal' && e.status !== 'skipped' && dateOf(e.at) === date).sort((a, b) => a.at.localeCompare(b.at));

export const copyTime = (e: DayEntry) => timeOf(e.at);

// ------------------------------------------------------------------ the week in numbers (D29)
export interface WeekSummary {
  from: ISODate; to: ISODate; days: number; // days with anything written
  carbsOk?: number; proteinOk?: number; waterOk?: number;
  workouts: number;
  checklistPct?: number;
}

/** The last 7 days up to `today`: how many days kept the carbs limit (or minimum), reached ≥ 90 % of the
 *  protein and the water target; workouts; checklist ticks. Only days with entries count. */
export function weekSummary(args: { plan: Plan | undefined; entries: DayEntry[]; workouts: Workout[]; foods: Map<string, Food>; today: ISODate }): WeekSummary {
  const { plan, entries, workouts, foods, today } = args;
  const from = format(addDays(parseISO(today), -6), 'yyyy-MM-dd');
  let days = 0, carbsOk = 0, proteinOk = 0, waterOk = 0, done = 0, total = 0;
  let hasCarbs = false, hasProtein = false, hasWater = false;
  for (let i = 0; i < 7; i++) {
    const d = format(addDays(parseISO(from), i), 'yyyy-MM-dd');
    const day = entries.filter((e) => dateOf(e.at) === d);
    if (!day.length) continue;
    days += 1;
    const tg = effectiveTargets(plan, d);
    const tot = dayTotals(day, foods);
    if (tg.carbsG?.max != null || tg.carbsG?.min != null) {
      hasCarbs = true;
      if ((tg.carbsG.max == null || tot.carbs <= tg.carbsG.max) && (tg.carbsG.min == null || tot.carbs >= tg.carbsG.min)) carbsOk += 1;
    }
    if (tg.proteinG) { hasProtein = true; if (tot.protein >= tg.proteinG * 0.9) proteinOk += 1; }
    if (tg.waterMl) { hasWater = true; if (tot.waterMl >= tg.waterMl) waterOk += 1; }
    const c = buildChecklist({ plan, date: d, entries: day, workouts, foods, now: new Date(`${d}T23:59:00`) });
    done += c.done; total += c.total;
  }
  return {
    from, to: today, days, workouts: workouts.filter((w) => w.date >= from && w.date <= today).length,
    ...(hasCarbs ? { carbsOk } : {}), ...(hasProtein ? { proteinOk } : {}), ...(hasWater ? { waterOk } : {}),
    ...(total ? { checklistPct: Math.round((done / total) * 100) } : {}),
  };
}
