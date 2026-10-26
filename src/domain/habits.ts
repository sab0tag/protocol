// What a person usually eats (D28): frequent lines for an empty search, earlier meals of the same name to
// repeat, and the week in numbers for «Прогрес». Pure.
import { addDays, format, parseISO } from 'date-fns';
import { buildChecklist } from './checklist';
import { byAt, dateOf, timeOf } from './dates';
import { dayTotals, effectiveTargets } from './nutrition';
import type { DayEntry, Food, ISODate, MealItem, Plan, Workout } from './types';
import { coverage, neutralDay, observedToday, scoredDay, trackingInfo, type Observation } from './observation';
import { lightDayHistory, type LightDayHistory } from './lightDay';

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
      else { prev.count += 1; if (Date.parse(e.at) > Date.parse(prev.last)) { prev.item = it; prev.last = e.at; } }
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
    && e.title === title && dateOf(e.at) < before).sort((a, b) => byAt(b, a));
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
  entries.filter((e) => e.kind === 'meal' && e.status !== 'skipped' && dateOf(e.at) === date).sort(byAt);

export const copyTime = (e: DayEntry) => timeOf(e.at);

// ------------------------------------------------------------------ the week in numbers (D29)
export interface WeekSummary {
  from: ISODate; to: ISODate; days: number; // days with anything written
  carbsOk?: number; proteinOk?: number; waterOk?: number;
  workouts: number;
  checklistPct?: number;
  knownDays?: Partial<Record<'carbs' | 'protein' | 'water', number>>;
  showWorkouts?: boolean;
  lightDays?: LightDayHistory;
  lightDayWorkouts?: number;
}

/** The last 7 days up to `today`: how many days kept the carbs limit (or minimum), reached ≥ 90 % of the
 *  protein and the water target; workouts; checklist ticks. Only days with entries count; R06: the same day flags as the
 *  habits and the report — what the records cannot prove is not counted either way. */
export function weekSummary(args: { plan: Plan | undefined; entries: DayEntry[]; workouts: Workout[]; foods: Map<string, Food>; today: ISODate; observation?: Observation }): WeekSummary {
  const { plan, entries, workouts, foods, observation } = args;
  const today = observation && args.today > observedToday(observation) ? observedToday(observation) : args.today;
  const from = format(addDays(parseISO(today), -6), 'yyyy-MM-dd');
  let days = 0, carbsOk = 0, proteinOk = 0, waterOk = 0, done = 0, total = 0;
  let hasCarbs = false, hasProtein = false, hasWater = false;
  const knownDays = { carbs: 0, protein: 0, water: 0 };
  for (let i = 0; i < 7; i++) {
    const d = format(addDays(parseISO(from), i), 'yyyy-MM-dd');
    const day = entries.filter((e) => dateOf(e.at) === d);
    if (!day.length && !(observation && workouts.some((w) => w.date === d))) continue;
    days += 1;
    const tg = effectiveTargets(plan, d);
    const f = dayFlags(plan, day, d, workouts, foods, observation);
    if (observation ? f.carbs !== undefined : tg.carbsG?.max != null || tg.carbsG?.min != null) { hasCarbs = true; knownDays.carbs++; if (f.carbs) carbsOk += 1; }
    if (observation ? f.protein !== undefined : tg.proteinG) { hasProtein = true; knownDays.protein++; if (f.protein) proteinOk += 1; }
    if (observation ? f.water !== undefined : tg.waterMl) { hasWater = true; knownDays.water++; if (f.water) waterOk += 1; }
    const c = buildChecklist({ plan, date: d, entries: day, workouts, foods, now: new Date(`${d}T23:59:00`), observation });
    done += c.done; total += c.total;
  }
  return {
    from, to: today, days, workouts: workouts.filter((w) => w.date >= from && w.date <= today && !(observation && neutralDay(observation, 'workout', w.date))).length,
    ...(observation && !observation.demo ? { lightDays: lightDayHistory(observation.events, from, today, observation.now),
      lightDayWorkouts: workouts.filter((w) => w.date >= from && w.date <= today && neutralDay(observation, 'workout', w.date)).length } : {}),
    ...(hasCarbs ? { carbsOk } : {}), ...(hasProtein ? { proteinOk } : {}), ...(hasWater ? { waterOk } : {}),
    ...(total ? { checklistPct: Math.round((done / total) * 100) } : {}),
    ...(observation ? { knownDays, showWorkouts: workouts.some((w) => w.date >= from && w.date <= today)
      || trackingInfo(observation, from, today, ['workout']).intervals.length > 0 } : {}),
  };
}

// ------------------------------------------------------------------ good habits, gently (D38)
export type HabitKey = 'protein' | 'carbs' | 'water' | 'meds' | 'plan';
export interface Habit { key: HabitKey; streak: number; best: number; last7: number; days7: number }

/** Per habit: calendar days in a row up to today (R06: a day without records or not provable breaks the run — it is not a
 *  run of «days with records»; today counts only once it is met — an unfinished day breaks nothing), the best run of the last
 *  30 days, and how many of the last 7 days with a known result met it («N з M днів із записами»). Only habits the plan has a
 *  target for. */
export function habits(args: { plan: Plan | undefined; entries: DayEntry[]; workouts: Workout[]; foods: Map<string, Food>; today: ISODate; observation?: Observation }): Habit[] {
  const { plan, entries, workouts, foods, observation } = args;
  const today = observation && args.today > observedToday(observation) ? observedToday(observation) : args.today;
  const byDay = new Map<string, DayEntry[]>();
  for (const e of entries) { const d = dateOf(e.at); if (d <= today) byDay.set(d, [...(byDay.get(d) ?? []), e]); }
  const flags: { d: string; f: Partial<Record<HabitKey, boolean>> }[] = [];
  for (let i = 29; i >= 0; i--) { // every calendar day — one with no records has no flags
    const d = format(addDays(parseISO(today), -i), 'yyyy-MM-dd');
    const day = byDay.get(d);
    flags.push({ d, f: day?.length ? dayFlags(plan, day, d, workouts, foods, observation) : {} });
  }
  const keys: HabitKey[] = ['protein', 'carbs', 'water', 'meds', 'plan'];
  const week = format(addDays(parseISO(today), -6), 'yyyy-MM-dd');
  return keys.flatMap((key) => {
    const rows = flags.filter((x) => x.f[key] !== undefined);
    if (!rows.length) return [];
    let best = 0, run = 0;
    const paused = (d: string) => {
      const owner = key === 'protein' || key === 'carbs' ? 'food' : key === 'water' ? 'water' : undefined;
      return !!observation && !!owner && coverage(observation, owner, d) === 'on' && neutralDay(observation, owner, d);
    };
    for (const r of flags) { if (paused(r.d)) continue; run = r.f[key] ? run + 1 : 0; best = Math.max(best, run); }
    let streak = 0;
    for (let i = flags.length - 1; i >= 0; i--) {
      const r = flags[i]!;
      if (paused(r.d)) continue;
      if (r.f[key]) streak += 1;
      else if (r.d === today) continue; // today is not over yet
      else break;
    }
    const w = rows.filter((r) => r.d >= week);
    return [{ key, streak, best, last7: w.filter((r) => r.f[key]).length, days7: w.length }];
  });
}

// ------------------------------------------------------------------ how complete a day's food is (R06)
/** A note that the person confirmed the day's food is all written — one tap on «День», and it can be taken back. */
export const FOOD_COMPLETE = 'food:complete';
export type FoodState = 'none' | 'partial' | 'complete';
/** No food recorded; some recorded (the day may hold more — «за записами»); the person said it is all there. */
export function foodState(day: DayEntry[]): FoodState {
  if (day.some((e) => e.kind === 'note' && e.checkKey === FOOD_COMPLETE && e.status === 'done')) return 'complete';
  return day.some((e) => e.kind === 'meal' && e.status === 'done') ? 'partial' : 'none';
}

/** One day against the plan: which habits were met (only those the plan has a target for). R06: what the records cannot prove is
 *  left unknown — a day with no food is no success of a carbs limit (a sum of zero), a partial day under the protein target or
 *  under a carbs limit proves neither a shortfall nor keeping the limit; reaching a target and going over a limit are proven. */
export function dayFlags(plan: Plan | undefined, day: DayEntry[], d: ISODate, workouts: Workout[], foods: Map<string, Food>, observation?: Observation): Partial<Record<HabitKey, boolean>> {
  if (observation && d > observedToday(observation)) return {};
  const hasMeds = (plan?.prescriptions ?? []).some((p) => (p.kind === 'medication' || p.kind === 'supplement') && p.schedule?.times.length);
  const tg = effectiveTargets(plan, d);
  const tot = dayTotals(day, foods);
  const c = buildChecklist({ plan, date: d, entries: day, workouts, foods, now: new Date(`${d}T23:59:00`), observation });
  const food = foodState(day);
  const f: Partial<Record<HabitKey, boolean>> = {};
  if (tg.proteinG && food !== 'none' && scoredDay(observation, 'food', d)) {
    if (tot.protein >= tg.proteinG * 0.9) f.protein = true; else if (food === 'complete') f.protein = false;
  }
  if ((tg.carbsG?.max != null || tg.carbsG?.min != null) && food !== 'none' && scoredDay(observation, 'food', d)) {
    const over = tg.carbsG.max != null && tot.carbs > tg.carbsG.max, reached = tg.carbsG.min == null || tot.carbs >= tg.carbsG.min;
    if (over) f.carbs = false; else if (food === 'complete') f.carbs = reached; else if (tg.carbsG.max == null && reached) f.carbs = true;
  }
  const closed = !observation || d < observedToday(observation);
  if (tg.waterMl && scoredDay(observation, 'water', d) && (tot.waterMl >= tg.waterMl || closed)) f.water = tot.waterMl >= tg.waterMl;
  const meds = c.items.filter((x) => x.kind === 'med');
  if (hasMeds && (!observation || (meds.length > 0 && scoredDay(observation, 'meds', d) && (meds.every((x) => x.done) || closed)))) f.meds = meds.every((x) => x.done);
  if (c.total && (closed || c.done / c.total >= 0.8)) f.plan = c.done / c.total >= 0.8;
  return f;
}
