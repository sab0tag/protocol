// D193 («Очередь агента», задача 13.3): a lab test on an empty stomach. The evening before — «завтра аналіз натщесерце» (the hours
// from the referral, or «за правилами лабораторії»); that morning the breakfast tile says «спершу аналіз»; a medicine due that
// morning — «уточніть у лікаря, чи приймати до аналізу», never advice either way.
import { mealCategoryFor } from './mealCategory';
import type { DayEntry, ISODate, Plan, Prescription } from './types';

const WORDS = /натщ|натще|натощак|на голодний шлунок|fasting/iu;
/** A test to take on an empty stomach: marked so in the plan, or its own words say it («Глюкоза натще»). */
export const fasting = (p: Pick<Prescription, 'kind' | 'title' | 'notes' | 'fasting'>) => p.kind === 'test' && (p.fasting === true || WORDS.test(`${p.title} ${p.notes ?? ''}`));

export function fastingTests(plan: Pick<Plan, 'prescriptions'> | undefined, date: ISODate): Prescription[] {
  return (plan?.prescriptions ?? []).filter((p) => p.dueDate === date && fasting(p));
}

/** The hours without food the referral gives (the longest of the day's tests), if any. */
export const fastingHours = (tests: Prescription[]) => tests.reduce<number | undefined>((h, p) => (p.fastingHours && (!h || p.fastingHours > h) ? p.fastingHours : h), undefined);

/** That morning, until breakfast is written: the tests first, and the medicines due before noon to ask the doctor about. */
export function fastingMorning(plan: Pick<Plan, 'prescriptions'> | undefined, date: ISODate, day: readonly DayEntry[]): { tests: string[]; meds: string[] } | null {
  const tests = fastingTests(plan, date);
  if (!tests.length) return null;
  if (day.some((e) => e.kind === 'meal' && e.status === 'done' && mealCategoryFor(e.title, e.at) === 0)) return null;
  const meds = (plan?.prescriptions ?? []).filter((p) => (p.kind === 'medication' || p.kind === 'supplement') && !p.asNeeded
    && (p.schedule?.times ?? []).some((t) => t < '12:00') && !(p.until && p.until < date) && !(p.since && p.since > date)).map((p) => p.title);
  return { tests: tests.map((p) => p.title), meds };
}
