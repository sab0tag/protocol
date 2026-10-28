// D139: local calendar dates are durable history. Midnight changes today's projection, never yesterday's row.
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import { isLightDay, lightDayChoice, isLocalDate, type LightDayChoice, type ModuleEvent } from './modulePreferences';
import type { ISODate } from './types';

export interface LightDayHistory { dates: ISODate[]; count: number; days: number }
const date = (d: Date) => format(d, 'yyyy-MM-dd');
const shift = (d: ISODate, n: number) => date(addDays(parseISO(d), n));

/** Current UI and push share the command's origin window after travel. Past history remains a date. */
export function lightDayOnDate(events: readonly ModuleEvent[], day: ISODate, now: Date): boolean {
  const choice = lightDayChoice(events, day);
  if (!choice?.enabled) return false;
  return day !== date(now) || choice.from === undefined || choice.until === undefined
    ? isLightDay(events, day) : now.getTime() >= choice.from && now.getTime() < choice.until;
}

/** Latest per-date decisions, unique dates, clipped to the selected calendar period and today's local date. */
export function lightDayHistory(events: readonly ModuleEvent[], from: ISODate, to: ISODate, now: Date): LightDayHistory {
  const until = to < date(now) ? to : date(now);
  if (!isLocalDate(from) || !isLocalDate(to) || from > until) return { dates: [], count: 0, days: 0 };
  const choices = new Map<ISODate, LightDayChoice>();
  for (const e of events) {
    if (e.kind !== 'light-day' || e.date < from || e.date > until) continue;
    const old = choices.get(e.date);
    if (!old || e.at > old.at || (e.at === old.at && e.id > old.id)) choices.set(e.date, e);
  }
  const dates = [...choices.values()].filter((e) => e.enabled).map((e) => e.date).sort();
  return { dates, count: dates.length, days: differenceInCalendarDays(parseISO(until), parseISO(from)) + 1 };
}

/** More than 7 of the last 14 calendar dates. A new episode begins only after the rolling count returned to <=7.
 *  Scan only dates at which that count changes; gaps, DST and long histories do not require a daily timer. */
export function lightDayNotice(events: readonly ModuleEvent[], now: Date): { episode: ISODate; count: number } | undefined {
  const today = date(now);
  const dates = lightDayHistory(events, '0001-01-01', today, now).dates;
  const changes = new Map<ISODate, number>();
  for (const d of dates) {
    changes.set(d, (changes.get(d) ?? 0) + 1);
    const out = shift(d, 14); changes.set(out, (changes.get(out) ?? 0) - 1);
  }
  let count = 0, episode: ISODate | undefined;
  for (const [d, delta] of [...changes].sort(([a], [b]) => a.localeCompare(b))) {
    if (d > today) break;
    const before = count; count += delta;
    if (count <= 7) episode = undefined;
    else if (before <= 7) episode = d;
  }
  if (!episode) return;
  // A late sync may move the inferred episode start. A real display inside the current episode still counts.
  if (events.some((e) => e.kind === 'light-day-notice' && e.date >= episode! && e.date <= today)) return;
  return { episode, count };
}
