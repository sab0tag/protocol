// D191 («Очередь агента», задача 13.1): «Запитати лікаря». A phrase in the one field («запитати лікаря, чи можна каву з
// Омепразолом») or the card in «Що сказав лікар» puts a question on the list; three days before the visit the list is on
// «Сьогодні» and goes into the report (as «Мої питання» did); after the visit — «Спитав» and the answer in one line, kept apart.
import { differenceInCalendarDays, parseISO } from 'date-fns';
import type { ISODate, Plan } from './types';

export interface Answered { q: string; a: string; at: ISODate }

const ASK = /^(?:запит(?:ати|аю|айте)|спит(?:ати|аю|айте)|питання)\s+(?:(?:у|в)\s+)?лікар(?:я|ю|еві|а)(?!\p{L})\s*[,:—–-]?\s*(.+)$/iu;
/** The question in a phrase addressed to the doctor, as it will be asked: a capital letter, a question mark; null otherwise. */
export function doctorQuestion(text: string): string | null {
  const m = ASK.exec(text.trim());
  const q = m?.[1]?.trim().replace(/[.!?…\s]+$/u, '');
  if (!q || q.length < 3) return null;
  return `${q[0]!.toLocaleUpperCase('uk')}${q.slice(1)}?`;
}

/** Days to the plan's visit when it is 0–3 days away (the list goes on «Сьогодні»); otherwise null. */
export function visitSoon(plan: Pick<Plan, 'nextCheckup'> | undefined, today: ISODate): number | null {
  const d = plan?.nextCheckup?.date;
  if (!d) return null;
  const n = differenceInCalendarDays(parseISO(d), parseISO(today));
  return n >= 0 && n <= 3 ? n : null;
}

/** The visit has happened — its date is today or past, or the person said «Візит відбувся» in the last 14 days. */
export function afterVisit(plan: Pick<Plan, 'nextCheckup' | 'lastVisit'> | undefined, today: ISODate): boolean {
  const d = plan?.nextCheckup?.date;
  if (d && d <= today) return true;
  const v = plan?.lastVisit;
  return !!v && differenceInCalendarDays(parseISO(today), parseISO(v)) <= 14;
}

/** «Спитав»: the question leaves the open list, its answer (one line, may be empty) is kept with the date. */
export function answer(plan: Pick<Plan, 'questions' | 'answered'>, q: string, a: string, today: ISODate): Pick<Plan, 'questions' | 'answered'> {
  return { questions: (plan.questions ?? []).filter((x) => x !== q), answered: [...(plan.answered ?? []), { q, a: a.trim().replace(/\s+/g, ' ').slice(0, 200), at: today }] };
}
