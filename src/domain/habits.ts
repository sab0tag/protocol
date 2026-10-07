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

// ------------------------------------------------------------------ good habits, gently (D38)
export type HabitKey = 'protein' | 'carbs' | 'water' | 'meds' | 'plan';
export interface Habit { key: HabitKey; streak: number; best: number; last7: number; days7: number }

/** Per habit: days in a row up to today (today counts only once it is met — an unfinished day breaks nothing),
 *  the best run of the last 30 days, and how many of the last 7 days with entries met it. Days without any
 *  entries are skipped, not counted as misses. Only habits the plan has a target for. */
export function habits(args: { plan: Plan | undefined; entries: DayEntry[]; workouts: Workout[]; foods: Map<string, Food>; today: ISODate }): Habit[] {
  const { plan, entries, workouts, foods, today } = args;
  const byDay = new Map<string, DayEntry[]>();
  for (const e of entries) { const d = dateOf(e.at); if (d <= today) byDay.set(d, [...(byDay.get(d) ?? []), e]); }
  const flags: { d: string; f: Partial<Record<HabitKey, boolean>> }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = format(addDays(parseISO(today), -i), 'yyyy-MM-dd');
    const day = byDay.get(d);
    if (day?.length) flags.push({ d, f: dayFlags(plan, day, d, workouts, foods) });
  }
  const keys: HabitKey[] = ['protein', 'carbs', 'water', 'meds', 'plan'];
  const week = format(addDays(parseISO(today), -6), 'yyyy-MM-dd');
  return keys.flatMap((key) => {
    const rows = flags.filter((x) => x.f[key] !== undefined);
    if (!rows.length) return [];
    let best = 0, run = 0;
    for (const r of rows) { run = r.f[key] ? run + 1 : 0; best = Math.max(best, run); }
    let streak = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i]!;
      if (r.f[key]) streak += 1;
      else if (r.d === today) continue; // today is not over yet
      else break;
    }
    const w = rows.filter((r) => r.d >= week);
    return [{ key, streak, best, last7: w.filter((r) => r.f[key]).length, days7: w.length }];
  });
}

/** One day against the plan: which habits were met (only those the plan has a target for). */
export function dayFlags(plan: Plan | undefined, day: DayEntry[], d: ISODate, workouts: Workout[], foods: Map<string, Food>): Partial<Record<HabitKey, boolean>> {
  const hasMeds = (plan?.prescriptions ?? []).some((p) => (p.kind === 'medication' || p.kind === 'supplement') && p.schedule?.times.length);
  const tg = effectiveTargets(plan, d);
  const tot = dayTotals(day, foods);
  const c = buildChecklist({ plan, date: d, entries: day, workouts, foods, now: new Date(`${d}T23:59:00`) });
  const f: Partial<Record<HabitKey, boolean>> = {};
  if (tg.proteinG) f.protein = tot.protein >= tg.proteinG * 0.9;
  if (tg.carbsG?.max != null || tg.carbsG?.min != null) f.carbs = (tg.carbsG.max == null || tot.carbs <= tg.carbsG.max) && (tg.carbsG.min == null || tot.carbs >= tg.carbsG.min);
  if (tg.waterMl) f.water = tot.waterMl >= tg.waterMl;
  if (hasMeds) f.meds = c.items.filter((x) => x.kind === 'med').every((x) => x.done);
  if (c.total) f.plan = c.done / c.total >= 0.8;
  return f;
}
