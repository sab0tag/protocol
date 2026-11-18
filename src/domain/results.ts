// D165: «Результати» as the spec draws it — the week in one phrase («Ліки — 26 з 28, їжа за планом 5 днів з 7»), three
// numbers and the time left to the doctor's visit. Pure: counted from the person's records against their own plan, never a
// health score. A dose counts only where it was due and observed (a light day or a module off is neither kept nor missed).
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import { buildChecklist } from './checklist';
import { dateOf } from './dates';
import { evaluate } from './evaluate';
import { FOOD_COMPLETE } from './habits';
import { scoredDay, type Observation } from './observation';
import { dayTotals, effectiveTargets } from './nutrition';
import type { DayEntry, Food, ISODate, Plan, WeightLog, Workout } from './types';
import { weightQuality } from './weightQuality';

export interface WeekResults {
  from: ISODate; to: ISODate;
  /** due doses marked taken / due doses — undefined when the plan has no timed medicine this week */
  meds?: { done: number; total: number };
  /** days whose recorded food had no plan remark / days of the week — undefined without active food limits or food records */
  food?: { onPlan: number; days: number };
  /** days the water target was reached / days with a target — undefined without a target */
  water?: { met: number; days: number };
  /** weight change over the week, kg — only with a goal weight and two weighings in the week */
  weight?: { delta: number };
  /** days with anything recorded */
  recorded: number;
}

export function weekResults(args: { plan: Plan | undefined; entries: DayEntry[]; workouts: Workout[]; foods: Map<string, Food>;
  weights?: WeightLog[]; today: ISODate; now?: Date; observation?: Observation }): WeekResults {
  const { plan, entries, workouts, foods, today, observation } = args;
  const from = format(addDays(parseISO(today), -6), 'yyyy-MM-dd');
  let done = 0, total = 0, onPlan = 0, foodDays = 0, met = 0, waterDays = 0, recorded = 0;
  const limits = !!plan?.constraints.some((c) => c.active);
  for (let i = 0; i < 7; i++) {
    const d = format(addDays(parseISO(from), i), 'yyyy-MM-dd');
    const day = entries.filter((e) => dateOf(e.at) === d);
    if (day.some((e) => e.status !== 'planned' && e.checkKey !== FOOD_COMPLETE)) recorded += 1;
    // a dose of today counts once its time has passed — the day is not over yet
    const end = d === today ? args.now ?? new Date() : new Date(`${d}T23:59:00`);
    const meds = buildChecklist({ plan, date: d, entries: day, workouts, foods, now: end, observation }).items
      .filter((x) => x.kind === 'med' && (d < today || !x.time || x.time <= format(end, 'HH:mm')));
    total += meds.length; done += meds.filter((x) => x.done).length;
    const meals = day.filter((e) => e.kind === 'meal' && e.status === 'done' && e.items?.length);
    if (plan && limits && scoredDay(observation, 'food', d)) {
      foodDays += 1;
      if (meals.length && meals.every((m) => evaluate({ plan, date: d, foods, entries, intent: 'recorded', exclude: m.id, meal: m.items! }).checks
        .every((c) => c.hits.every((h) => h.verdict === 'ok')))) onPlan += 1;
    }
    const target = effectiveTargets(plan, d).waterMl;
    if (target && scoredDay(observation, 'water', d) && d <= today) {
      waterDays += 1;
      if (dayTotals(day, foods).waterMl >= target) met += 1;
    }
  }
  const inWeek = weightQuality(args.weights ?? [], today).accepted.filter((w) => w.date >= from && w.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const weight = plan?.targets.weightGoalKg != null && inWeek.length >= 2 ? { delta: Math.round((inWeek.at(-1)!.kg - inWeek[0]!.kg) * 10) / 10 } : undefined;
  return { from, to: today, recorded,
    ...(total ? { meds: { done, total } } : {}),
    ...(foodDays && entries.some((e) => e.kind === 'meal' && e.status === 'done' && dateOf(e.at) >= from && dateOf(e.at) <= today) ? { food: { onPlan, days: foodDays } } : {}),
    ...(waterDays ? { water: { met, days: waterDays } } : {}),
    ...(weight ? { weight } : {}) };
}

/** The week in one phrase: medicines and food, as far as the plan has them; nothing invented for what is not there. */
export function weekPhrase(r: WeekResults): string {
  const parts = [r.meds && `Ліки — ${r.meds.done} з ${r.meds.total}`, r.food && `їжа за планом ${r.food.onPlan} ${days(r.food.onPlan)} з ${r.food.days}`].filter(Boolean) as string[];
  if (!parts.length) return r.recorded ? `Записи є ${r.recorded} ${days(r.recorded)} з 7` : 'Цього тижня записів ще немає';
  return parts.join(', ');
}

/** «2 місяці», «3 тижні», «5 днів», «завтра», «сьогодні» — the time to the visit; undefined once it is past. */
export function untilVisit(date: ISODate | undefined, today: ISODate): string | undefined {
  if (!date) return undefined;
  const n = differenceInCalendarDays(parseISO(date), parseISO(today));
  if (n < 0) return undefined;
  if (n === 0) return 'сьогодні';
  if (n === 1) return 'завтра';
  if (n < 14) return `${n} ${days(n)}`;
  if (n < 60) { const w = Math.round(n / 7); return `${w} ${plural(w, 'тиждень', 'тижні', 'тижнів')}`; }
  const m = Math.round(n / 30.4); return `${m} ${plural(m, 'місяць', 'місяці', 'місяців')}`;
}

const plural = (n: number, one: string, few: string, many: string) => {
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
};
export const days = (n: number) => plural(n, 'день', 'дні', 'днів');
