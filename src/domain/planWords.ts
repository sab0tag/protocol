// D165: «Що сказав лікар» — the plan retold in plain words, one line per thing, the way the doctor would say it.
// Only what the person entered or confirmed; nothing is added, interpreted or advised.
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { days } from './results';
import type { Constraint, ISODate, Prescription } from './types';

const dm = (d: ISODate) => format(parseISO(d), 'dd.MM');
const joinAnd = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} і ${xs.at(-1)}`);

/** «Метформін 500 мг — о 08:00 і 20:00, під час їжі, ще 13 днів» */
export function medicineWords(p: Prescription, today: ISODate): { name: string; how: string } {
  const name = [p.title, p.dose].filter(Boolean).join(' ');
  const parts: string[] = [];
  if (p.asNeeded) parts.push('за потреби');
  else if (p.schedule?.times.length) parts.push(`о ${joinAnd([...p.schedule.times].sort())}`);
  else parts.push('раз на день');
  if (p.schedule?.withFood === true) parts.push('під час їжі');
  if (p.schedule?.withFood === false) parts.push('натщесерце');
  if (p.until) {
    const left = differenceInCalendarDays(parseISO(p.until), parseISO(today));
    parts.push(left < 0 ? `курс закінчився ${dm(p.until)}` : left === 0 ? 'останній день' : left <= 30 ? `ще ${left} ${days(left)}` : `до ${dm(p.until)}`);
  }
  if (p.since && p.since > today) parts.push(`з ${dm(p.since)}`);
  return { name, how: parts.join(', ') };
}

/** «Стіл №5 (ЩД) — без смаженого» from a constraint's own words: its title, and the reason the doctor gave. */
export function constraintWords(c: Constraint): string {
  return c.reason?.trim() ? `${c.title} — ${c.reason.trim().replace(/\.$/u, '').replace(/^./u, (x) => x.toLowerCase())}` : c.title;
}

/** Who and when, as far as the plan says it: its sources, without inventing a doctor's name. */
export function whoWords(sources: string[]): string | undefined {
  const named = [...new Set(sources.map((s) => s.trim()).filter(Boolean))];
  if (!named.length) return undefined;
  return named.length > 2 ? `${named.slice(0, 2).join(', ')} і ще ${named.length - 2}` : named.join(', ');
}
