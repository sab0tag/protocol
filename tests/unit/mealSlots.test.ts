import { describe, expect, it } from 'vitest';
import { FOOD_COMPLETE } from '../../src/domain/habits';
import { blockKeyFor, hitLabel, portionSuspect, recentSlotDays, hitLabels, mealBlocks, NEW_SNACK, slotAt, slotMissed, slotTime, tileState, usualForSlot, usualTime, withFoodDose, yesterdaySlot } from '../../src/domain/mealSlots';
import type { RuleHit } from '../../src/domain/rules';
import type { DayEntry, MealItem, Plan } from '../../src/domain/types';

const meal = (date: string, time: string, title: string, items: MealItem[], status: DayEntry['status'] = 'done'): DayEntry =>
  ({ id: `${date}${time}${title}`, at: `${date}T${time}:00+02:00`, kind: 'meal', status, title, items });
const oats: MealItem = { foodId: 'oatmeal-water', name: 'Вівсянка на воді', grams: 250, unit: { name: 'порція', qty: 1, grams: 250 } };
const egg: MealItem = { foodId: 'egg-boiled', name: 'Яйце варене', grams: 50, unit: { name: 'шт', qty: 1, grams: 50 } };
const coffee: MealItem = { foodId: 'coffee', name: 'Кава', grams: 200 };
const soup: MealItem = { foodId: 'borscht', name: 'Борщ', grams: 300 };
const at = (date: string, time: string) => new Date(`${date}T${time}:00`);
const D = '2026-11-17', Y = '2026-11-16';

describe('meal tiles (D159)', () => {
  it('the meal going on now: before 11 breakfast, before 16 lunch, before 21 dinner, then a snack', () => {
    expect([slotAt(at(D, '07:00')), slotAt(at(D, '10:59')), slotAt(at(D, '11:00')), slotAt(at(D, '16:00')), slotAt(at(D, '21:30'))]).toEqual([0, 0, 1, 2, 3]);
  });

  it('a breakfast not written by 12:00 is «не записано»; not at 10:00, not on a light day, not once the day is said to be complete', () => {
    expect(slotMissed({ slot: 0, date: D, now: at(D, '12:00'), day: [], light: false })).toBe(true);
    expect(slotMissed({ slot: 0, date: D, now: at(D, '10:00'), day: [], light: false })).toBe(false);
    expect(slotMissed({ slot: 0, date: D, now: at(D, '12:00'), day: [], light: true })).toBe(false);
    const complete: DayEntry = { id: 'c', at: `${D}T23:59:00+02:00`, kind: 'note', status: 'done', title: 'x', checkKey: FOOD_COMPLETE };
    expect(slotMissed({ slot: 0, date: D, now: at(D, '12:00'), day: [complete], light: false })).toBe(false);
    expect(slotMissed({ slot: 0, date: D, now: at(D, '12:00'), day: [meal(D, '08:00', 'Сніданок', [oats])], light: false })).toBe(false);
    expect(slotMissed({ slot: 3, date: D, now: at(D, '23:00'), day: [], light: false })).toBe(false); // a snack is never missed
    expect(slotMissed({ slot: 2, date: Y, now: at(D, '08:00'), day: [], light: false })).toBe(true); // a past day's dinner
  });

  it('the tile state: recorded, planned, ahead (grey) and open', () => {
    const day = [meal(D, '08:00', 'Сніданок', [oats]), meal(D, '19:00', 'Вечеря', [soup], 'planned')];
    const s = (slot: 0 | 1 | 2 | 3, time: string) => tileState({ slot, date: D, now: at(D, time), day, light: false });
    expect([s(0, '09:00'), s(1, '09:00'), s(2, '09:00'), s(3, '09:00')]).toEqual(['recorded', 'ahead', 'planned', 'open']);
    expect(s(1, '12:00')).toBe('open');
    expect(s(1, '17:00')).toBe('missed');
  });

  it('a new line\'s time is never asked: now for the meal going on, the usual time for one already over, else the default', () => {
    expect(slotTime({ slot: 0, date: D, now: at(D, '08:42'), entries: [] })).toBe('08:42');
    expect(slotTime({ slot: 2, date: D, now: at(D, '08:42'), entries: [] })).toBe('08:42'); // eaten ahead of its hour
    expect(slotTime({ slot: 1, date: D, now: at(D, '17:00'), entries: [] })).toBe('13:00');
    const history = ['12:30', '12:40', '12:50', '14:00'].map((time, i) => meal(`2026-11-1${i}`, time, 'Обід', [soup]));
    expect(usualTime(history, 1, D)).toBe('12:40');
    expect(slotTime({ slot: 1, date: D, now: at(D, '17:00'), entries: history })).toBe('12:40');
    expect(slotTime({ slot: 0, date: Y, now: at(D, '08:42'), entries: [] })).toBe('08:00'); // another day
  });

  it('«Як учора» is yesterday\'s same meal; the usual chips are this meal\'s, without what is already in it', () => {
    const all = [meal(Y, '08:00', 'Сніданок', [oats, coffee]), meal('2026-11-15', '08:00', 'Сніданок', [oats, egg]), meal(Y, '13:00', 'Обід', [soup])];
    expect(yesterdaySlot(all, D, 0).map((x) => x.name)).toEqual(['Вівсянка на воді', 'Кава']);
    expect(yesterdaySlot(all, D, 2)).toEqual([]);
    expect(usualForSlot(all, D, 0).map((x) => x.name)).toEqual(['Вівсянка на воді', 'Кава', 'Яйце варене']);
    expect(usualForSlot(all, D, 0, 5, [oats]).map((x) => x.name)).toEqual(['Кава', 'Яйце варене']);
    expect(usualForSlot(all, D, 1).map((x) => x.name)).toEqual(['Борщ']);
  });

  it('a medicine «з їжею» ticked at breakfast with no breakfast written asks what was eaten', () => {
    const plan = { constraints: [], targets: {}, modes: [], prescriptions: [
      { id: 'met', kind: 'medication', title: 'Метформін', schedule: { times: ['08:00'], withFood: true }, source: 'x' },
      { id: 'd', kind: 'supplement', title: 'Вітамін D', schedule: { times: ['08:00'] }, source: 'x' },
    ] } as Plan;
    const dose = (id: string, title: string, time: string): DayEntry => ({ id: `${id}${time}`, at: `${D}T${time}:00+02:00`, kind: 'med', status: 'done', title, prescriptionId: id });
    expect(withFoodDose({ slot: 0, date: D, day: [dose('met', 'Метформін', '08:00')], plan })).toEqual({ title: 'Метформін', time: '08:00' });
    expect(withFoodDose({ slot: 0, date: D, day: [dose('d', 'Вітамін D', '08:00')], plan })).toBeUndefined();
    expect(withFoodDose({ slot: 1, date: D, day: [dose('met', 'Метформін', '08:00')], plan })).toBeUndefined();
    expect(withFoodDose({ slot: 0, date: D, day: [dose('met', 'Метформін', '08:00'), meal(D, '08:10', 'Сніданок', [oats])], plan })).toBeUndefined();
  });

  it('a plan hit is a short word: «сіль», «смажене»', () => {
    const hit = (reason: RuleHit['reason'], message: string): RuleHit => ({ itemName: 'x', verdict: 'adjust', reason, message });
    expect(hitLabel(hit('sodium', 'Багато солі за день'))).toBe('сіль');
    expect(hitLabel(hit('gallbladder', 'Смажене навантажує жовчний'))).toBe('смажене');
    expect(hitLabel(hit('gallbladder', 'Жирне навантажує жовчний'))).toBe('жирне');
    expect(hitLabel(hit('diet', 'ЩД: Смажене — за день 30 з 0 г'))).toBe('смажене');
    expect(hitLabels([hit('sodium', 'a'), hit('sodium', 'b'), { ...hit('lactose', 'Лактоза'), verdict: 'ok' }])).toEqual(['сіль']);
  });

  it('D161: several snacks are separate blocks, each between the meals around its time; a new one is placed by its time', () => {
    const day = [meal(D, '08:00', 'Сніданок', [oats]), meal(D, '10:30', 'Перекус', [egg]), meal(D, '15:00', 'Перекус', [coffee]),
      meal(D, '16:30', 'Перекус', [soup], 'planned'), meal(D, '22:00', 'Перекус', [coffee])];
    expect(mealBlocks(day, D).map((b) => b.key)).toEqual(['s0', `e:${D}10:30Перекус`, 's1', `e:${D}15:00Перекус`, `e:${D}16:30Перекус`, 's2', `e:${D}22:00Перекус`]);
    expect(mealBlocks([meal(D, '07:00', 'Перекус', [egg])], D).map((b) => b.key)).toEqual([`e:${D}07:00Перекус`, 's0', 's1', 's2']);
    expect(mealBlocks([], D).map((b) => b.key)).toEqual(['s0', 's1', 's2']); // no fixed empty «Перекус»
    expect(mealBlocks([], D, `${D}T12:15:00+02:00`).map((b) => b.key)).toEqual(['s0', NEW_SNACK, 's1', 's2']); // 12:15 — before lunch at 13:00
    expect([0, 1, 2, 3].map((s) => blockKeyFor(s as 0 | 1 | 2 | 3))).toEqual(['s0', 's1', 's2', NEW_SNACK]);
  });

  it('D164: «Як у понеділок» — the same meal on each of the last 7 days that had it, newest first', () => {
    const all = [meal(Y, '08:10', 'Сніданок', [oats]), meal('2026-11-14', '08:00', 'Сніданок', [egg, coffee]), meal('2026-11-14', '13:00', 'Обід', [soup]),
      meal('2026-11-09', '08:00', 'Сніданок', [coffee]), meal('2026-11-15', '08:00', 'Сніданок', [egg], 'planned')];
    expect(recentSlotDays(all, D, 0).map((d) => [d.date, d.items.map((i) => i.name)])).toEqual([
      [Y, ['Вівсянка на воді']], ['2026-11-14', ['Яйце варене', 'Кава']]]); // 11-09 is 8 days back; a planned one is not eaten
  });

  it('D164: an amount more than 3× off the usual portion is «Перевірте» — 4,5 г read as 45 г; no usual portion, no mark', () => {
    expect(portionSuspect(500, 150)).toBe(true); expect(portionSuspect(450, 150)).toBe(false); // exactly 3× is still plausible
    expect(portionSuspect(45, 150)).toBe(true);
    expect(portionSuspect(400, 150)).toBe(false);
    expect(portionSuspect(60, 150)).toBe(false);
    expect(portionSuspect(450, undefined)).toBe(false);
  });
});

