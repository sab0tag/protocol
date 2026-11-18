// ТЗ «упрощение» 17.11, step 3 (D164): the quick marks on «Сьогодні». Pure: which doses one tap on «Ліки» means,
// and how a tile says its state — in words or numbers, never by colour alone.
import { NOW_AFTER_MIN, NOW_BEFORE_MIN } from './reminders';
import type { CheckItem } from './checklist';

export const GLASS_ML = 250;

const minutes = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h! * 60 + m!; };

/** Doses of today that are open (not ticked, skipped or uncertain), in the plan's order. */
export const openDoses = (items: readonly CheckItem[]): CheckItem[] =>
  items.filter((i) => i.kind === 'med' && !i.done && !i.skipped && !i.uncertain);

/** The doses one tap on «Ліки» is about: open doses whose time is now — from 30 min before to an hour after.
 *  One — the tap marks it; several — a list with ticks; none — the day's list. Never one picked at random. */
export function dosesNow(items: readonly CheckItem[], now: Date): CheckItem[] {
  const at = now.getHours() * 60 + now.getMinutes();
  return openDoses(items).filter((i) => i.time !== undefined && minutes(i.time) - NOW_BEFORE_MIN <= at && at <= minutes(i.time) + NOW_AFTER_MIN);
}

/** «2 з 5»: ticked doses of the day out of all of them. */
export function medsState(items: readonly CheckItem[]): { done: number; total: number } {
  const meds = items.filter((i) => i.kind === 'med');
  return { done: meds.filter((i) => i.done).length, total: meds.length };
}

/** The wellbeing scale in words, worst first (1…5) — no emoji. */
export const MOOD_WORDS = ['Дуже погано', 'Погано', 'Так собі', 'Добре', 'Чудово'] as const;
