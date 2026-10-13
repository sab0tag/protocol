// «Прогрес» (SPEC.md §5.7, §6.4): weekly weight, too-fast loss, lab table, noticed patterns. Pure.
import { format, parseISO, startOfISOWeek } from 'date-fns';
import { coincidences, coincidenceText } from './symptoms';
import { dateOf } from './dates';
import { normalize } from './nutrition';
import type { DayEntry, Food, LabResult, WeightLog, Wellbeing, Workout } from './types';

export interface WeekWeight {
  week: string; // Monday "yyyy-MM-dd"
  kg: number; // mean of the week's weighings
  change?: number; // vs the previous week with data, kg (negative = lost)
  tooFast: boolean;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function weeklyWeights(logs: WeightLog[], maxLossPerWeek?: number): WeekWeight[] {
  const byWeek = new Map<string, number[]>();
  for (const l of [...logs].sort((a, b) => a.date.localeCompare(b.date))) {
    const w = format(startOfISOWeek(parseISO(l.date)), 'yyyy-MM-dd');
    byWeek.set(w, [...(byWeek.get(w) ?? []), l.kg]);
  }
  const weeks: WeekWeight[] = [];
  for (const [week, kgs] of byWeek) {
    const kg = r1(kgs.reduce((a, b) => a + b, 0) / kgs.length);
    const prev = weeks.at(-1);
    const change = prev ? r1(kg - prev.kg) : undefined;
    weeks.push({ week, kg, ...(change !== undefined ? { change } : {}),
      tooFast: maxLossPerWeek != null && change !== undefined && -change > maxLossPerWeek });
  }
  return weeks;
}

/** §5.7: the loss was faster than allowed two weeks in a row (the latest two weeks with a change). */
export function tooFastTwoWeeks(weeks: WeekWeight[]): boolean {
  const withChange = weeks.filter((w) => w.change !== undefined);
  return withChange.length >= 2 && withChange.slice(-2).every((w) => w.tooFast);
}

/** D38: the weight's pace — the average change of the last (up to) two weeks with a change, kg per week. */
export function pace(weeks: WeekWeight[]): number | undefined {
  const ch = weeks.filter((w) => w.change !== undefined).slice(-2).map((w) => w.change!);
  return ch.length ? r1(ch.reduce((a, b) => a + b, 0) / ch.length) : undefined;
}

export function weightSummary(logs: WeightLog[]): { start?: WeightLog; now?: WeightLog; delta?: number } {
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date));
  const start = sorted[0], now = sorted.at(-1);
  return { ...(start ? { start } : {}), ...(now ? { now } : {}), ...(start && now ? { delta: r1(now.kg - start.kg) } : {}) };
}

export interface LabRow { name: string; unit: string; was: LabResult; now: LabResult; target?: string }

/** One row per test: the first result («було»), the latest, and the latest stated target. */
export function labRows(labs: LabResult[]): LabRow[] {
  const by = new Map<string, LabResult[]>();
  for (const l of [...labs].sort((a, b) => a.date.localeCompare(b.date))) by.set(l.name, [...(by.get(l.name) ?? []), l]);
  return [...by.entries()].map(([name, rs]) => {
    const target = [...rs].reverse().find((r) => r.target)?.target;
    return { name, unit: rs.at(-1)!.unit, was: rs[0]!, now: rs.at(-1)!, ...(target ? { target } : {}) };
  });
}

// ------------------------------------------------------------------ patterns (§6.4)
const MEAT = ['мясо', 'курк', 'курят', 'філе', 'стегн', 'яловичин', 'свинин', 'телятин', 'індич', 'качк', 'печінк', 'котлет', 'фарш'];
export const MEAT_MEAL_G = 200;

function meatGrams(items: DayEntry['items'], foods: Map<string, Food>): number {
  return (items ?? []).filter((it) => (it.foodId && foods.get(it.foodId)?.tags.includes('meat'))
    || MEAT.some((m) => normalize(it.name).includes(m))).reduce((g, it) => g + it.grams, 0);
}

export interface Pattern { text: string }

export function patterns(args: { entries: DayEntry[]; wellbeing: Wellbeing[]; workouts: Workout[]; foods: Map<string, Food> }): Pattern[] {
  const { entries, wellbeing, workouts, foods } = args;
  const out: Pattern[] = [];
  const bigMeatDays = new Set(entries.filter((e) => e.kind === 'meal' && e.status === 'done' && meatGrams(e.items, foods) > MEAT_MEAL_G)
    .map((e) => dateOf(e.at)));
  const symptomDays = new Map<string, string[]>();
  for (const w of wellbeing) for (const s of w.symptoms) symptomDays.set(s, [...(symptomDays.get(s) ?? []), w.date]);
  for (const [symptom, days] of symptomDays) {
    if (days.length < 3) continue;
    const withMeat = days.filter((d) => bigMeatDays.has(d)).length;
    if (withMeat / days.length >= 0.7) {
      out.push({ text: `«${symptom}» — ${withMeat} з ${days.length} разів у дні, коли м’яса за один прийом було більше ${MEAT_MEAL_G} г` });
    }
  }
  out.push(...coincidences(entries, foods).map((c) => ({ text: coincidenceText(c) }))); // D59
  const scored = wellbeing.filter((w) => w.energy != null);
  if (scored.length >= 10) {
    const trained = new Set(workouts.map((w) => w.date));
    const avg = (xs: Wellbeing[]) => xs.reduce((a, w) => a + (w.energy ?? 0), 0) / xs.length;
    const on = scored.filter((w) => trained.has(w.date)), off = scored.filter((w) => !trained.has(w.date));
    if (on.length && off.length) {
      out.push({ text: `Енергія в дні тренувань — ${avg(on).toFixed(1)}, в інші дні — ${avg(off).toFixed(1)} (з 5)` });
    }
  }
  return out;
}
