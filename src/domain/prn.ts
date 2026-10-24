// D118: a medicine «за потреби» with the doctor's daily limit («Парацетамол 500 мг — при болю, не більше 4 табл. на добу»).
// No dose is due (D100), so it is not on the checklist; it is marked by «Прийняв зараз» and counted: «сьогодні 2 з 4». At the
// limit the app quotes the doctor — «Лікар указав: не більше 4 на добу» — a quote, never advice, and the record is still made
// if the person took it (a record is what happened). The report shows how often and which days went over. Pure.
import { dateOf } from './dates';
import type { DayEntry, ISODate, Plan, Prescription } from './types';

const LIMIT = /не\s+більше\s+(\d+)\s*(?:[\p{L}.]+\s+)?(?:на|за)\s+(?:добу|день)/iu;

/** The doctor's daily limit: set in the plan, or read from the doctor's words («не більше 4 табл. на добу»). */
export function prnLimit(p: Pick<Prescription, 'maxPerDay' | 'notes'>): number | undefined {
  if (p.maxPerDay) return p.maxPerDay;
  const m = p.notes ? LIMIT.exec(p.notes) : null;
  const n = m ? Number(m[1]) : NaN;
  return n >= 1 && n <= 24 ? n : undefined;
}

/** The plan's «за потреби» medicines in force that day (not before they entered the plan, not after the course). */
export const prnMeds = (plan: Plan | undefined, date: ISODate): Prescription[] =>
  (plan?.prescriptions ?? []).filter((p) => (p.kind === 'medication' || p.kind === 'supplement') && p.asNeeded
    && !(p.since && date < p.since) && !(p.until && date > p.until));

export const prnTaken = (p: Prescription, entries: DayEntry[], date: ISODate): number =>
  entries.filter((e) => e.kind === 'med' && e.status === 'done' && e.prescriptionId === p.id && dateOf(e.at) === date).length;

export interface PrnLine { title: string; dose?: string; max?: number; total: number; days: number; over: ISODate[] }

/** For the report: each «за потреби» medicine — how many times, on how many days, the days over the doctor's limit. */
export function prnReport(plan: Plan | undefined, entries: DayEntry[], from: ISODate, to: ISODate): PrnLine[] {
  const out: PrnLine[] = [];
  for (const p of (plan?.prescriptions ?? []).filter((x) => x.asNeeded)) {
    const byDay = new Map<ISODate, number>();
    for (const e of entries) {
      const d = dateOf(e.at);
      if (e.kind === 'med' && e.status === 'done' && e.prescriptionId === p.id && d >= from && d <= to) byDay.set(d, (byDay.get(d) ?? 0) + 1);
    }
    const total = [...byDay.values()].reduce((a, b) => a + b, 0);
    if (!total) continue;
    const max = prnLimit(p);
    out.push({ title: p.title, ...(p.dose ? { dose: p.dose } : {}), ...(max ? { max } : {}), total, days: byDay.size,
      over: max ? [...byDay.entries()].filter(([, n]) => n > max).map(([d]) => d).sort() : [] });
  }
  return out;
}
