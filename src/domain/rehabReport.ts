// D182 (task 7, step 7): the rehabilitation complex in the report to the doctor — how many sessions were done of those
// prescribed, pain after them by day, the days with swelling, the stage and the limits in the doctor's words. Counts, not
// conclusions; days before the complex entered the plan are not counted as missed.
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { currentStage } from './rehab';
import { activeRestrictions, restrictionText } from './trainingRules';
import type { DayEntry, ISODate, Plan } from './types';

export interface RehabReport {
  done: number; due: number; perDay: number; stage: string;
  days: { date: ISODate; sessions: number; maxPain: number; swelling: boolean }[];
  limits: string[];
}

/** `to` — the last day counted (today at the latest). Nothing when the plan has no complex. */
export function rehabReport(plan: Plan | undefined, entries: readonly DayEntry[], from: ISODate, to: ISODate): { rehab: RehabReport } | null {
  const c = plan?.rehab;
  if (!c?.stages.length) return null;
  const start = c.since && c.since > from ? c.since : from;
  const span = start > to ? 0 : differenceInCalendarDays(parseISO(to), parseISO(start)) + 1;
  const byDay = new Map<ISODate, { sessions: number; maxPain: number; swelling: boolean }>();
  for (const e of entries) {
    if (e.kind !== 'workout' || e.status !== 'done' || !e.rehab) continue;
    const d = e.at.slice(0, 10);
    if (d < from || d > to) continue;
    const x = byDay.get(d) ?? { sessions: 0, maxPain: 0, swelling: false };
    byDay.set(d, { sessions: x.sessions + 1, maxPain: Math.max(x.maxPain, e.rehab.pain), swelling: x.swelling || e.rehab.swelling });
  }
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, x]) => ({ date, ...x }));
  return { rehab: { done: days.reduce((a, d) => a + d.sessions, 0), due: span * c.perDay, perDay: c.perDay, stage: currentStage(c).title, days,
    limits: activeRestrictions(plan, to).map(restrictionText) } };
}

export function rehabLines(r: RehabReport, dm: (d: ISODate) => string): string[] {
  const swollen = r.days.filter((d) => d.swelling).map((d) => dm(d.date));
  return [
    `ЛФК (${r.stage}): зроблено ${r.done} з ${r.due} призначених (${r.perDay} на день)`,
    r.days.length ? `Біль після занять, найбільший за день (0–10): ${r.days.map((d) => `${dm(d.date)} — ${d.maxPain}`).join('; ')}` : 'Занять не записано',
    r.days.length ? (swollen.length ? `Набряк відмічено: ${swollen.join(', ')}` : 'Набряку не відмічено') : '',
    r.limits.length ? `Обмеження лікаря: ${r.limits.join('; ')}` : '',
  ].filter(Boolean);
}
