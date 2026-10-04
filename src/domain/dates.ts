import { format, parseISO } from 'date-fns';
import type { ISODate, ISODateTime } from './types';

export const todayISO = (): ISODate => format(new Date(), 'yyyy-MM-dd');

/** A local date and "HH:mm" as an ISO date-time with the device's offset ("2026-10-04T08:40:00+03:00"). */
export function atLocal(date: ISODate, time: string): ISODateTime {
  return format(new Date(`${date}T${time}:00`), "yyyy-MM-dd'T'HH:mm:ssxxx");
}

export const dateOf = (at: ISODateTime): ISODate => format(parseISO(at), 'yyyy-MM-dd');
export const timeOf = (at: ISODateTime): string => format(parseISO(at), 'HH:mm');

export const newId = (): string => crypto.randomUUID();
