// D118, R01: a medicine «за потреби» with the doctor's daily limit («Парацетамол 500 мг — при болю, не більше 4 табл. на добу»).
// No dose is due (D100), so it is not on the checklist; it is marked by «Прийняв зараз» with how much was taken and counted in
// the limit's own unit: a limit in intakes counts records («3 рази» — two tablets at once are one intake), in tablets, capsules,
// ml or mg — the amounts in that unit. Never converted: mg are not tablets without a confirmed strength, an old limit with no
// unit is not given one, a record with no amount is not guessed — then «Не вдалося зіставити одиниці», never a false remainder.
// At the limit the app quotes the doctor — a quote, never advice — and the record is still made if it was taken. Pure.
import { dateOf } from './dates';
import type { AmountUnit, DailyLimit, DayEntry, ISODate, LimitUnit, Plan, Prescription } from './types';

// «не більше 4 табл. на добу», «не більше 3 разів на день», «максимум 2 г за добу», «до 20 мл на добу»
const LIMIT = /(?:не\s+більше|не\s+більш|максимум|макс\.?|до)\s+(\d+(?:[.,]\d+)?)\s*([\p{L}.]+\s+)?(?:на|за)\s+(?:добу|день)/iu;
const UNIT: [RegExp, LimitUnit, number][] = [
  [/^(раз\p{L}*|прийом\p{L}*)$/u, 'intake', 1],
  [/^(табл\p{L}*\.?|таб\.?|т\.)$/u, 'tablet', 1],
  [/^(капс\p{L}*\.?|кап\.)$/u, 'capsule', 1],
  [/^(мл|мілілітр\p{L}*)\.?$/u, 'ml', 1],
  [/^(мг|міліграм\p{L}*)\.?$/u, 'mg', 1],
  [/^(г|грам\p{L}*)\.?$/u, 'mg', 1000], // grams are mg by definition — a unit, not a strength
];
const num = (s: string) => Number(s.replace(',', '.'));

/** The limit in the doctor's words, with its unit when the words name one; a number with no unit is a limit of unknown unit. */
export function parseLimit(text: string, source: DailyLimit['source'] = 'paper'): DailyLimit | undefined {
  const m = LIMIT.exec(text);
  const v = m ? num(m[1]!) : NaN;
  if (!m || !(v > 0)) return undefined;
  const word = (m[2] ?? '').trim().toLowerCase();
  const u = word ? UNIT.find(([re]) => re.test(word)) : undefined; // «шт.» and anything else — the unit is not known
  return { value: u ? v * u[2] : v, unit: u ? u[1] : 'unknown', sourceText: m[0].trim(), source };
}

/** The doctor's daily limit: set in the plan or read off the paper; the old number-only limit (D118) — of unknown unit. */
export function prnLimit(p: Pick<Prescription, 'limit' | 'maxPerDay' | 'notes'>): DailyLimit | undefined {
  if (p.limit) return p.limit;
  if (p.maxPerDay) return { value: p.maxPerDay, unit: 'unknown', sourceText: '', source: 'legacy' };
  return p.notes ? parseLimit(p.notes) : undefined;
}

/** What a record of «Прийняв зараз» proposes: the limit's own countable unit, else what the dose says («1 табл.», «10 мл»). */
export function proposedAmount(p: Pick<Prescription, 'limit' | 'maxPerDay' | 'notes' | 'dose'>): { qty?: number; unit: AmountUnit } {
  const l = prnLimit(p);
  if (l && (l.unit === 'tablet' || l.unit === 'capsule')) return { qty: 1, unit: l.unit };
  if (l && (l.unit === 'ml' || l.unit === 'mg')) return { unit: l.unit }; // how much — the person says
  const d = /^(\d+(?:[.,]\d+)?)\s*([\p{L}.]+)/u.exec(p.dose?.trim() ?? '');
  const u = d ? UNIT.find(([re, unit]) => unit !== 'intake' && re.test(d[2]!.toLowerCase())) : undefined;
  if (d && u && (u[1] === 'tablet' || u[1] === 'capsule')) return { qty: num(d[1]!), unit: u[1] as AmountUnit };
  return { qty: 1, unit: 'tablet' };
}

/** The plan's «за потреби» medicines in force that day (not before they entered the plan, not after the course). */
export const prnMeds = (plan: Plan | undefined, date: ISODate): Prescription[] =>
  (plan?.prescriptions ?? []).filter((p) => (p.kind === 'medication' || p.kind === 'supplement') && p.asNeeded
    && !(p.since && date < p.since) && !(p.until && date > p.until));

export const prnRecords = (p: Prescription, entries: DayEntry[], date: ISODate): DayEntry[] =>
  entries.filter((e) => e.kind === 'med' && e.status === 'done' && e.prescriptionId === p.id && dateOf(e.at) === date);

/** How many times it was taken that day — records, whatever the amount. */
export const prnTaken = (p: Prescription, entries: DayEntry[], date: ISODate): number => prnRecords(p, entries, date).length;

export type Used = { matched: true; used: number; limit: DailyLimit } | { matched: false; intakes: number; limit: DailyLimit };

/** A day's use in the limit's unit — or not matched (a limit of unknown unit, a record with no amount or in another unit). */
export function prnUsed(limit: DailyLimit, records: DayEntry[]): Used {
  if (limit.unit === 'intake') return { matched: true, used: records.length, limit };
  if (limit.unit === 'unknown' || records.some((e) => e.amount?.unit !== limit.unit)) return { matched: false, intakes: records.length, limit };
  return { matched: true, used: Math.round(records.reduce((s, e) => s + e.amount!.qty, 0) * 1000) / 1000, limit };
}

export interface PrnLine { title: string; dose?: string; limit?: DailyLimit; total: number; days: number; over: ISODate[]; unmatched: number }

/** For the report: each «за потреби» medicine — how many times, on how many days, the days over the doctor's limit (in its
 *  unit), and the days that could not be matched to it. */
export function prnReport(plan: Plan | undefined, entries: DayEntry[], from: ISODate, to: ISODate): PrnLine[] {
  const out: PrnLine[] = [];
  for (const p of (plan?.prescriptions ?? []).filter((x) => x.asNeeded)) {
    const byDay = new Map<ISODate, DayEntry[]>();
    for (const e of entries) {
      const d = dateOf(e.at);
      if (e.kind === 'med' && e.status === 'done' && e.prescriptionId === p.id && d >= from && d <= to) byDay.set(d, [...(byDay.get(d) ?? []), e]);
    }
    const total = [...byDay.values()].reduce((a, b) => a + b.length, 0);
    if (!total) continue;
    const limit = prnLimit(p);
    const used = limit ? [...byDay.entries()].map(([d, es]) => [d, prnUsed(limit, es)] as const) : [];
    out.push({ title: p.title, ...(p.dose ? { dose: p.dose } : {}), ...(limit ? { limit } : {}), total, days: byDay.size,
      over: used.filter(([, u]) => u.matched && u.used > u.limit.value).map(([d]) => d).sort(), unmatched: used.filter(([, u]) => !u.matched).length });
  }
  return out;
}
