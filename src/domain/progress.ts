// «Прогрес» (SPEC.md §5.7, §6.4): weekly weight, too-fast loss, lab table, noticed patterns. Pure.
import { addDays, format, parseISO, startOfISOWeek } from 'date-fns';
import { coincidences, coincidenceText } from './symptoms';
import { flatItems } from './rules';
import { dateOf } from './dates';
import { dayTotals, effectiveTargets, normalize } from './nutrition';
import type { DayEntry, Food, LabResult, Plan, WeightLog, Wellbeing, Workout } from './types';

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

export function patterns(args: { entries: DayEntry[]; wellbeing: Wellbeing[]; workouts: Workout[]; foods: Map<string, Food>; plan?: Plan }): Pattern[] {
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
  out.push(...wellbeingCoincidences(entries, wellbeing, foods, args.plan)); // D71
  const scored = wellbeing.filter((w) => w.energy != null);
  if (scored.length >= 10) {
    const trained = new Set(workouts.map((w) => w.date));
    const avg = (xs: Wellbeing[]) => xs.reduce((a, w) => a + (w.energy ?? 0), 0) / xs.length;
    const on = scored.filter((w) => trained.has(w.date)), off = scored.filter((w) => !trained.has(w.date));
    if (on.length && off.length) {
      out.push({ text: `Енергія в дні тренувань — ${avg(on).toFixed(1).replace('.', ',')}, в інші дні — ${avg(off).toFixed(1).replace('.', ',')} (з 5)` });
    }
  }
  return out;
}

// ------------------------------------------------------------------ wellbeing and the day (D71)
type Score = 'energy' | 'mood' | 'sleep';
const SCORE: Record<Score, string> = { energy: 'Енергія', mood: 'Настрій', sleep: 'Сон' };
export const MIN_DAYS = 5, MIN_DIFF = 0.7;

/** Counted, not concluded: the average 1–5 score on days with a factor vs days without, both MIN_DAYS+ and MIN_DIFF+
 *  apart. Sleep is set against the day before (a late dinner shows in the night after it). */
export function wellbeingCoincidences(entries: DayEntry[], wellbeing: Wellbeing[], foods: Map<string, Food>, plan: Plan | undefined): Pattern[] {
  const byDay = new Map<string, DayEntry[]>();
  for (const e of entries) if (e.kind === 'meal' && e.status === 'done') byDay.set(dateOf(e.at), [...(byDay.get(dateOf(e.at)) ?? []), e]);
  const factors: { name: (d: string) => string; on: (d: string) => boolean | undefined }[] = [
    { name: (d) => `вечеря пізніше ${effectiveTargets(plan, d).lastMealBy ?? ''}`, on: (d) => {
      const by = effectiveTargets(plan, d).lastMealBy, ms = byDay.get(d);
      return by && ms ? ms.some((m) => !m.timeUnknown && m.at.slice(11, 16) > by) : undefined; } },
    { name: () => 'алкоголь', on: (d) => (byDay.get(d) ? byDay.get(d)!.some((m) => flatItems(m.items).some((it) => it.foodId && foods.get(it.foodId)?.tags.includes('alcohol'))) : undefined) },
    { name: () => 'вуглеводів понад межу', on: (d) => {
      const max = effectiveTargets(plan, d).carbsG?.max, ms = byDay.get(d);
      return max != null && ms ? dayTotals(ms, foods).carbs > max : undefined; } },
  ];
  const out: Pattern[] = [];
  const avg = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
  const dec = (n: number) => n.toFixed(1).replace('.', ',');
  for (const score of ['energy', 'mood', 'sleep'] as Score[]) for (const f of factors) {
    const yes: number[] = [], no: number[] = [];
    let label = '';
    for (const w of wellbeing) {
      const v = w[score];
      if (v == null) continue;
      const d = score === 'sleep' ? format(addDays(parseISO(w.date), -1), 'yyyy-MM-dd') : w.date;
      const on = f.on(d);
      if (on === undefined) continue;
      if (on) { yes.push(v); label = f.name(d); } else no.push(v);
    }
    if (yes.length < MIN_DAYS || no.length < MIN_DAYS || Math.abs(avg(yes) - avg(no)) < MIN_DIFF) continue;
    out.push({ text: score === 'sleep'
      ? `Сон після днів, коли ${label}, — ${dec(avg(yes))}, після інших — ${dec(avg(no))} (з 5; ${yes.length} і ${no.length} ночей)`
      : `${SCORE[score]} в дні, коли ${label}, — ${dec(avg(yes))}, в інші — ${dec(avg(no))} (з 5; ${yes.length} і ${no.length} дн.)` });
  }
  return out;
}


// ------------------------------------------------------------------ checking a read form (D75)
/** What to look at again on the paper before a number read from a photo is kept: another unit than this test had
 *  before (numbers in different units are not comparable), or a value far from the last one. Hints, not verdicts. */
export type LabHint = { kind: 'unit'; before: string } | { kind: 'far'; before: number };
const unitKey = (u: string) => u.toLowerCase().replace(/\s+/g, '').replace('μ', 'мк').replace('µ', 'мк');

export function labHint(known: LabRow | undefined, unit: string, value: number): LabHint | null {
  if (!known || Number.isNaN(value)) return null;
  if (unit.trim() && known.unit.trim() && unitKey(unit) !== unitKey(known.unit)) return { kind: 'unit', before: known.unit };
  const last = known.now.value;
  if (last > 0 && (value / last > 1.5 || value / last < 1 / 1.5)) return { kind: 'far', before: last };
  return null;
}
