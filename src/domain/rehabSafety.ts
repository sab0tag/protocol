// D181 (task 7, step 6): safety in rehabilitation. The app only reminds and records; the load is changed by the doctor alone.
// - Pain 7 or more after a session, or the day's pain rising three days in a row → a calm card «Зупиніть ці вправи і
//   зателефонуйте лікарю». No diagnosis, no model.
// - Red flags with a cast, a fracture or after an operation — static words, not a model: pain growing under a cast; numb,
//   bluish or cold fingers or toes; pain and swelling of the calf; breathlessness or chest pain → the 103 card. They hold while
//   the plan has a rehab complex or a doctor's limit for training (the app's sign of an injury). The text is a draft until a
//   doctor reads and signs it — said so on screen.
// - «Помічник» answers a question about exercises in that state only from the plan, with «запитайте лікаря» — never the model.
import type { DayEntry, ISODate, Plan } from './types';
import { activeRestrictions, restrictionText } from './trainingRules';
import { currentStage } from './rehab';

export const PAIN_STOP = 7;

/** The doctor's words for the red flags — a draft (by NHS «after a fracture / with a cast» advice), not yet signed by a doctor. */
export const RED_FLAGS = [
  'Біль під гіпсом чи пов’язкою посилюється',
  'Пальці німіють, синіють, бліднуть або холодні',
  'Литка болить і набрякла',
  'Задишка або біль у грудях',
] as const;
export const RED_FLAGS_SIGNED = false; // the owner sets true once a traumatologist has read and signed the list

const FLAG_WORDS = [
  /(?:біль|болить|боли\S*)\s+(?:\S+\s+){0,3}(?:під|под)\s+(?:гіпс|гипс|пов[’'ʼ]?язк)/iu,
  /(?:під|под)\s+(?:гіпс|гипс)\S*\s+(?:\S+\s+){0,2}(?:болить|біль|боли\S*)/iu,
  /пальц\S*\s+(?:\S+\s+){0,2}(?:німі|онімі|оніміл|синію|посин|синюш|сині|блід|холодн|немеют|синеют|холодн)/iu,
  /(?:німі|онімі|оніміл|посині|синію|синюш|холодн\S*|немеют|посинел)\s+(?:\S+\s+){0,2}пальц/iu,
  /литк\S*\s+(?:\S+\s+){0,3}(?:набря|опух|отек|отёк)|(?:набря\S*|опух\S*|отек\S*|отёк\S*)\s+(?:\S+\s+){0,2}литк|ікр\S*\s+(?:\S+\s+){0,3}(?:набря|опух)/iu,
];
/** A red flag in free words — only meaningful with an injury in the plan (`injured`). Breathlessness and chest pain are
 *  danger signs for everyone already (`dangerInText`). */
export const redFlagInText = (text: string): boolean => FLAG_WORDS.some((re) => re.test(text));

/** The plan says there is an injury: a rehab complex, or a doctor's limit for training on that day. */
export const injured = (plan: Pick<Plan, 'rehab' | 'restrictions'> | undefined, date: ISODate): boolean =>
  !!plan?.rehab?.stages.length || activeRestrictions(plan, date).length > 0;

/** Pain 7+ in the last session today, or the day's highest pain rising three days in a row (ending today). */
export function painAlert(entries: readonly DayEntry[], today: ISODate): 'high' | 'rising' | null {
  const sessions = entries.filter((e) => e.kind === 'workout' && e.status === 'done' && e.rehab).sort((a, b) => a.at.localeCompare(b.at));
  const todays = sessions.filter((e) => e.at.startsWith(today));
  if (todays.length && todays.at(-1)!.rehab!.pain >= PAIN_STOP) return 'high';
  const byDay = new Map<string, number>();
  for (const e of sessions) { const d = e.at.slice(0, 10); byDay.set(d, Math.max(byDay.get(d) ?? 0, e.rehab!.pain)); }
  const days = [...byDay.keys()].sort();
  if (days.at(-1) !== today || days.length < 3) return null;
  const last = days.slice(-3);
  // three days in a row, by the calendar, each higher than the day before
  const consecutive = last.every((d, i) => i === 0 || Date.parse(`${d}T12:00:00Z`) - Date.parse(`${last[i - 1]}T12:00:00Z`) === 86_400_000);
  const v = last.map((d) => byDay.get(d)!);
  return consecutive && v[0]! < v[1]! && v[1]! < v[2]! ? 'rising' : null;
}

const EXERCISE_Q = /вправ|тренув|займат|навантаж|присід|присед|біга|бега|ходи(ти|ть)|ходьб|гир|упражн|нагрузк|спорт|розтяж|растяж/iu;
/** «Помічник» with an injury in the plan: a question about exercise is answered from the plan alone. Null — not such a question. */
export function rehabAnswer(text: string, plan: Plan, date: ISODate): string | null {
  if (!injured(plan, date) || !EXERCISE_Q.test(text)) return null;
  const lines: string[] = [];
  if (plan.rehab?.stages.length) {
    const s = currentStage(plan.rehab);
    lines.push(`У вашому плані — комплекс ЛФК, ${s.title}: ${s.exercises.map((x) => (x.dose ? `${x.name} (${x.dose})` : x.name)).join('; ')}; ${plan.rehab.perDay} раз(и) на день.`);
  }
  const limits = activeRestrictions(plan, date).map(restrictionText);
  if (limits.length) lines.push(`Обмеження лікаря: ${limits.join('; ')}.`);
  lines.push('Про інші вправи й навантаження запитайте лікаря — застосунок їх не радить.');
  return lines.join(' ');
}
