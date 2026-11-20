// D194 («Очередь агента», задача 13.4): a new medicine's side effects. For the first 14 days after it entered the plan — one tap a
// day «є побічні? ні / так» and a word «які»; the summary goes into the report to the doctor. Danger words in the answer bring the
// 103 card as everywhere (D130); nothing here judges whether it is a side effect.
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import { dateOf } from './dates';
import type { DayEntry, ISODate, Plan, Prescription } from './types';

export const SIDE_DAYS = 14;
export const sideKey = (prescriptionId: string) => `side:${prescriptionId}`;

/** Medicines in their first 14 days today, with the day number (1–14). */
export function newMedicines(plan: Pick<Plan, 'prescriptions'> | undefined, today: ISODate): { p: Prescription; day: number }[] {
  return (plan?.prescriptions ?? []).filter((p) => p.kind === 'medication' && p.since && !p.asNeeded && !(p.until && p.until < today))
    .map((p) => ({ p, day: differenceInCalendarDays(parseISO(today), parseISO(p.since!)) + 1 })).filter((x) => x.day >= 1 && x.day <= SIDE_DAYS);
}

/** Today's question not yet answered — one medicine at a time, the newest first. */
export function sideAsk(plan: Pick<Plan, 'prescriptions'> | undefined, day: readonly DayEntry[], today: ISODate): { p: Prescription; day: number } | null {
  const answered = new Set(day.filter((e) => e.kind === 'note' && e.checkKey?.startsWith('side:') && dateOf(e.at) === today).map((e) => e.checkKey));
  return newMedicines(plan, today).filter((x) => !answered.has(sideKey(x.p.id))).sort((a, b) => a.day - b.day)[0] ?? null;
}

export interface SideReport { title: string; since: ISODate; asked: number; yes: { date: ISODate; text: string }[] }
/** The report's lines: for each medicine asked about in the period — how many days answered, and the «так» days with their words. */
export function sideReport(plan: Pick<Plan, 'prescriptions'> | undefined, entries: readonly DayEntry[], from: ISODate, to: ISODate): SideReport[] {
  const out: SideReport[] = [];
  for (const p of plan?.prescriptions ?? []) {
    if (p.kind !== 'medication' || !p.since) continue;
    const end = format(addDays(parseISO(p.since), SIDE_DAYS - 1), 'yyyy-MM-dd');
    const rows = entries.filter((e) => e.kind === 'note' && e.checkKey === sideKey(p.id) && e.side && dateOf(e.at) >= from && dateOf(e.at) <= to && dateOf(e.at) <= end);
    if (!rows.length) continue;
    out.push({ title: p.title, since: p.since, asked: rows.length,
      yes: rows.filter((e) => e.side!.yes).map((e) => ({ date: dateOf(e.at), text: e.side!.text ?? '' })).sort((a, b) => a.date.localeCompare(b.date)) });
  }
  return out;
}
