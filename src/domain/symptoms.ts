// «Мені погано» (SPEC.md D56): a symptom with its time, and what was eaten in the hours before it — the food and
// symptom diary a gastroenterologist or an allergist asks for. Nothing here decides anything: it shows what was
// recorded, side by side. Danger signs are named so the screen can say «телефонуйте 103» at once. Pure.
import type { DayEntry } from './types';

/** Common ones first; «своє» can be typed. */
export const SYMPTOMS = ['Здуття', 'Печія', 'Нудота', 'Біль у животі', 'Тяжкість після їжі', 'Біль у правому боці', 'Діарея',
  'Висип', 'Свербіж', 'Головний біль', 'Втома'] as const;

/** Signs of a reaction that can be dangerous — not something to note and wait. */
export const DANGER = ['Набряк губ, язика чи горла', 'Важко дихати', 'Висип по всьому тілу', 'Різка слабкість чи запаморочення'] as const;

export const isDanger = (s: string) => (DANGER as readonly string[]).includes(s);

/** How far back «що їли перед цим» looks. */
export const BEFORE_HOURS = 6;

/** Meals eaten (done) within `hours` before `at`, the latest first — across midnight too. */
export function eatenBefore(entries: DayEntry[], at: string, hours = BEFORE_HOURS): DayEntry[] {
  const t = Date.parse(at), from = t - hours * 3_600_000;
  return entries
    .filter((e) => e.kind === 'meal' && e.status === 'done' && !e.timeUnknown && Date.parse(e.at) <= t && Date.parse(e.at) >= from)
    .sort((a, b) => b.at.localeCompare(a.at));
}
