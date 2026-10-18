import { format, parseISO } from 'date-fns';
import type { ISODate, ISODateTime } from './types';

export const todayISO = (): ISODate => format(new Date(), 'yyyy-MM-dd');

/** A local date and "HH:mm" as an ISO date-time with the device's offset ("2026-10-04T08:40:00+03:00"). */
export function atLocal(date: ISODate, time: string): ISODateTime {
  return format(new Date(`${date}T${time}:00`), "yyyy-MM-dd'T'HH:mm:ssxxx");
}

export const dateOf = (at: ISODateTime): ISODate => format(parseISO(at), 'yyyy-MM-dd');
export const timeOf = (at: ISODateTime): string => format(parseISO(at), 'HH:mm');
/** D52: the time to show for an entry — none when the person did not remember it. */
export const shownTime = (e: { at: ISODateTime; timeUnknown?: true }): string | undefined => (e.timeUnknown ? undefined : timeOf(e.at));

/** Entries in time order by the instant, not the text: across the autumn hour and across time zones
 *  «03:10+02:00» is after «03:30+03:00» (D75). */
export const byAt = (a: { at: ISODateTime }, b: { at: ISODateTime }): number => Date.parse(a.at) - Date.parse(b.at);
export const isPast = (at: ISODateTime, now = Date.now()): boolean => Date.parse(at) < now;

export const newId = (): string => crypto.randomUUID();

/** D99: the week arrows — to the next week's Monday or the previous week's Sunday (the day next to where you were:
 *  from Sunday 18 «→» is Monday 19, not Sunday 25); today, when it is in that week. */
export function weekStep(date: ISODate, dir: 1 | -1, today: ISODate): ISODate {
  const d = parseISO(date), wd = (d.getDay() + 6) % 7; // Monday = 0
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - wd + dir * 7);
  const days = Array.from({ length: 7 }, (_, i) => format(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i), 'yyyy-MM-dd'));
  return days.includes(today) ? today : dir > 0 ? days[0]! : days[6]!;
}
