/** Input review policy, not a diagnosis or a recommended rate of weight change. */
import { format, isValid, parseISO } from 'date-fns';
import { todayISO } from './dates';
import type { WeightLog } from './types';
export type WeightProblem = 'value' | 'date' | 'jump';
export function validWeightDate(date: string, today = todayISO()): boolean {
  const d = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? parseISO(date) : undefined;
  return !!d && isValid(d) && format(d, 'yyyy-MM-dd') === date && date <= today;
}
export function weightInputProblem(date: string, kg: number, today = todayISO()): WeightProblem | undefined {
  if (!validWeightDate(date, today)) return 'date';
  // Deliberately broad unit-entry bounds, shared by all age categories. No clinical normal range is inferred.
  if (typeof kg !== 'number' || !Number.isFinite(kg) || kg < 0.1 || kg > 1000) return 'value';
  return undefined;
}
export function weightQuality(logs: readonly WeightLog[], today = todayISO()): { accepted: WeightLog[]; pending: { record: WeightLog; reason: WeightProblem }[] } {
  const accepted: WeightLog[] = [], pending: { record: WeightLog; reason: WeightProblem }[] = [];
  for (const record of [...logs].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    let reason = weightInputProblem(record.date, record.kg, today);
    const previous = accepted.at(-1);
    // Review a >10% difference from the last accepted entry, irrespective of elapsed time.
    // Long-term intentional changes can be confirmed. An unreviewed typo can never become the next baseline.
    if (!reason && previous && Math.abs(record.kg - previous.kg) / previous.kg > 0.1 + Number.EPSILON && record.reviewedKg !== record.kg) reason = 'jump';
    if (reason) pending.push({ record, reason }); else accepted.push(record);
  }
  return { accepted, pending };
}
