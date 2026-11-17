// D159: the day's food as tiles — Сніданок, Обід, Вечеря, and as many snacks as were eaten (D161). A tile is the meal itself: nothing is asked
// about which meal or when. Pure: what a tile shows, which time a new line gets, what is offered before anything is typed.
import { addDays, format, parseISO } from 'date-fns';
import { byAt, dateOf, timeOf } from './dates';
import { FOOD_COMPLETE, frequentItems } from './habits';
import { mealCategoryFor, type MealCategory } from './mealCategory';
import type { RuleHit } from './rules';
import type { DayEntry, ISODate, MealItem, Plan } from './types';

export type Slot = MealCategory;
export const SLOTS: readonly Slot[] = [0, 1, 2, 3];

/** A main meal's window ends here: after it the tile says «не записано». The snack has no window. */
export const SLOT_END: Readonly<Record<0 | 1 | 2, number>> = { 0: 11, 1: 16, 2: 21 };
/** Used when the person adds a past meal and the history has no usual time for it. */
export const SLOT_DEFAULT_TIME: Readonly<Record<Slot, string>> = { 0: '08:00', 1: '13:00', 2: '19:00', 3: '16:00' };

export const slotOf = (e: Pick<DayEntry, 'title' | 'at'>): Slot => mealCategoryFor(e.title, e.at);

/** The meal going on now: the same hours a title-less meal is sorted by. */
export const slotAt = (now: Date): Slot => { const h = now.getHours(); return h < 11 ? 0 : h < 16 ? 1 : h < 21 ? 2 : 3; };

const isMeal = (e: DayEntry) => e.kind === 'meal' && e.checkKey !== FOOD_COMPLETE;

/** The meal records of one tile on that date, oldest first. */
export function slotEntries(entries: DayEntry[], date: ISODate, slot: Slot): { done: DayEntry[]; planned: DayEntry[] } {
  const mine = entries.filter((e) => isMeal(e) && dateOf(e.at) === date && slotOf(e) === slot).sort(byAt);
  return { done: mine.filter((e) => e.status === 'done' && e.items?.length), planned: mine.filter((e) => e.status === 'planned' && e.items?.length) };
}

/** The person's usual time for this meal: the median of the last 60 days, if there are at least two records. */
export function usualTime(entries: DayEntry[], slot: Slot, today: ISODate): string | undefined {
  const since = format(addDays(parseISO(today), -60), 'yyyy-MM-dd');
  const minutes = entries.filter((e) => isMeal(e) && e.status === 'done' && !e.timeUnknown && dateOf(e.at) >= since && dateOf(e.at) < today && slotOf(e) === slot)
    .map((e) => { const [h, m] = timeOf(e.at).split(':').map(Number); return h! * 60 + m!; }).sort((a, b) => a - b);
  if (minutes.length < 2) return undefined;
  const mid = minutes[Math.floor((minutes.length - 1) / 2)]!;
  return `${String(Math.floor(mid / 60)).padStart(2, '0')}:${String(mid % 60).padStart(2, '0')}`;
}

/** The time a new line of this tile is written with — never asked. Today, for the meal going on now (or one ahead of
 *  its hour, eaten early) — now; a meal already over, or another day — the person's usual time, else 08:00 / 13:00 / 19:00. */
export function slotTime(args: { slot: Slot; date: ISODate; now: Date; entries: DayEntry[] }): string {
  const { slot, date, now, entries } = args;
  const today = format(now, 'yyyy-MM-dd');
  if (date === today && (slot === 3 || slot >= slotAt(now))) return format(now, 'HH:mm');
  return usualTime(entries, slot, today) ?? SLOT_DEFAULT_TIME[slot];
}

/** One block of «Їжа». Сніданок, Обід, Вечеря are always there (each can be «не записано»); a snack is not one fixed tile:
 *  every snack record is a block of its own, and «Додати їжу → Перекус» opens a new, empty one. */
export interface MealBlock { key: string; slot: Slot; entry?: DayEntry; at?: string }
export const NEW_SNACK = 'snack:new';
/** The block a «which meal» choice opens: the main meal's tile, or a new snack. */
export const blockKeyFor = (slot: Slot): string => (slot === 3 ? NEW_SNACK : `s${slot}`);

/** The day's blocks in eating order: a snack stands between the meals around its time, by their usual hours 08:00 / 13:00 /
 *  19:00 (10:30 — between breakfast and lunch, 16:30 — before dinner); several snacks by time. `newSnackAt` — the time an
 *  opened new snack will be written with. */
export function mealBlocks(day: DayEntry[], date: ISODate, newSnackAt?: string): MealBlock[] {
  const snacks = day.filter((e) => isMeal(e) && dateOf(e.at) === date && slotOf(e) === 3 && !!e.items?.length
    && (e.status === 'done' || e.status === 'planned'));
  const rankAt = (at: string) => 2 * ([0, 1, 2] as const).filter((m) => SLOT_DEFAULT_TIME[m] <= timeOf(at)).length - 1;
  const blocks: (MealBlock & { rank: number })[] = [
    ...([0, 1, 2] as const).map((slot) => ({ key: `s${slot}`, slot, rank: 2 * slot })),
    ...snacks.map((entry) => ({ key: `e:${entry.id}`, slot: 3 as Slot, entry, at: entry.at, rank: rankAt(entry.at) })),
    ...(newSnackAt ? [{ key: NEW_SNACK, slot: 3 as Slot, at: newSnackAt, rank: rankAt(newSnackAt) }] : []),
  ];
  return blocks.sort((a, b) => a.rank - b.rank || (a.at ?? '').localeCompare(b.at ?? '')).map(({ rank: _rank, ...block }) => block);
}

/** Has the window of this meal closed with nothing in it? Never for a snack, a light day, a day said to be complete. */
export function slotMissed(args: { slot: Slot; date: ISODate; now: Date; day: DayEntry[]; light: boolean }): boolean {
  const { slot, date, now, day, light } = args;
  if (slot === 3 || light) return false;
  if (day.some((e) => e.checkKey === FOOD_COMPLETE && e.status === 'done')) return false;
  if (slotEntries(day, date, slot).done.length) return false;
  const today = format(now, 'yyyy-MM-dd');
  return date < today || (date === today && now.getHours() >= SLOT_END[slot]);
}

export type TileState = 'recorded' | 'planned' | 'ahead' | 'open' | 'missed';

/** A light day (D139) quiets the planned menu too: the tile is only for what the person chooses to write. */
export function tileState(args: { slot: Slot; date: ISODate; now: Date; day: DayEntry[]; light: boolean }): TileState {
  const { done, planned } = slotEntries(args.day, args.date, args.slot);
  if (done.length) return 'recorded';
  if (planned.length && !args.light) return 'planned';
  if (slotMissed(args)) return 'missed';
  const today = format(args.now, 'yyyy-MM-dd');
  return args.slot !== 3 && args.date === today && args.slot > slotAt(args.now) ? 'ahead' : 'open';
}

/** «Метформін прийнято о 08:00 — що було на сніданок?»: a medicine the doctor said to take with food, ticked in this meal's
 *  hours, while the meal itself is empty. Only doses with a real time; one medicine is named. */
export function withFoodDose(args: { slot: Slot; date: ISODate; day: DayEntry[]; plan: Plan | undefined }): { title: string; time: string } | undefined {
  const { slot, date, day, plan } = args;
  if (slot === 3 || slotEntries(day, date, slot).done.length) return undefined;
  const withFood = new Set((plan?.prescriptions ?? []).filter((p) => p.schedule?.withFood === true).map((p) => p.id));
  const dose = day.filter((e) => e.kind === 'med' && e.status === 'done' && !e.timeUnknown && e.prescriptionId && withFood.has(e.prescriptionId)
    && dateOf(e.at) === date && slotAt(parseISO(e.at)) === slot).sort(byAt)[0];
  return dose ? { title: dose.title, time: timeOf(dose.at) } : undefined;
}

/** The items of yesterday's same meal — the «Як учора» chip; nothing if yesterday had none. */
export function yesterdaySlot(entries: DayEntry[], date: ISODate, slot: Slot): MealItem[] {
  const prev = format(addDays(parseISO(date), -1), 'yyyy-MM-dd');
  return slotEntries(entries, prev, slot).done.flatMap((e) => e.items ?? []);
}

/** D164 (learning from Calorize's reviews: a photo read «4,5 г» as «45 г»): an amount more than 3 times off this person's
 *  usual portion of the same food is marked «Перевірте» in the draft. No usual portion — nothing to compare with. */
export function portionSuspect(grams: number, usualGrams: number | undefined): boolean {
  return !!usualGrams && usualGrams > 0 && grams > 0 && (grams > 3 * usualGrams || grams * 3 < usualGrams);
}

/** D164 («Як у понеділок»): the same meal on each of the last 7 days that had it, newest first — a long press on «Як учора». */
export function recentSlotDays(entries: DayEntry[], date: ISODate, slot: Slot, days = 7): { date: ISODate; items: MealItem[] }[] {
  return Array.from({ length: days }, (_, i) => format(addDays(parseISO(date), -(i + 1)), 'yyyy-MM-dd'))
    .map((d) => ({ date: d, items: slotEntries(entries, d, slot).done.flatMap((e) => e.items ?? []) }))
    .filter((d) => d.items.length > 0);
}

const keyOf = (it: MealItem) => it.recipe ? `r:${it.recipe.id}` : it.foodId ? `f:${it.foodId}` : `n:${it.name.toLocaleLowerCase('uk')}`;
export const sameFood = (a: MealItem, b: MealItem) => keyOf(a) === keyOf(b);

/** What this person usually eats at this meal (the last 60 days), with the amount used last time; lines already in the tile left out. */
export function usualForSlot(entries: DayEntry[], date: ISODate, slot: Slot, limit = 5, have: MealItem[] = []): MealItem[] {
  const mine = entries.filter((e) => isMeal(e) && slotOf(e) === slot && dateOf(e.at) < date);
  return frequentItems(mine, date, 60, limit + have.length).map((f) => f.item).filter((it) => !have.some((h) => sameFood(h, it))).slice(0, limit);
}

/** A short word for a plan hit next to a line: «сіль», «смажене» — a hint, not an alarm. */
export function hitLabel(hit: RuleHit): string {
  switch (hit.reason) {
    case 'sodium': return 'сіль';
    case 'gallbladder': return /^жирне/iu.test(hit.message) ? 'жирне' : 'смажене';
    case 'lactose': return 'лактоза';
    case 'glycemic': return /цукор/iu.test(hit.message) ? 'цукор' : 'швидкі вуглеводи';
    case 'iron': return 'печінка';
    case 'oxalate': return /кальцій/iu.test(hit.message) ? 'кальцій' : 'оксалати';
    case 'allergy': return 'алерген';
    case 'diet': { const title = hit.message.split(': ').slice(1).join(': ').split(' — ')[0] ?? ''; return title.toLocaleLowerCase('uk') || 'дієта'; }
    default: return 'план';
  }
}

/** Distinct labels of a set of hits, in order. */
export const hitLabels = (hits: RuleHit[]): string[] => [...new Set(hits.filter((h) => h.verdict !== 'ok').map(hitLabel))];
