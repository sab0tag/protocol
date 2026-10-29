import { describe, expect, it } from 'vitest';
import { examplePlan } from '../../src/data/seed.example';
import { dayFocus, reminders, scheduleStatus, SCHEDULE_DAYS, type ReminderSettings } from '../../src/domain/reminders';
import type { DayEntry } from '../../src/domain/types';

const plan = examplePlan(new Date('2026-10-01T12:00:00')); // Вітамін D at 08:30
const now = new Date('2026-10-08T07:00:00');
const OFF: ReminderSettings = { meals: false, meds: false, waterEveryH: 0, repeatMin: 15, morning: '', evening: '', visits: false };
const meal = (id: string, at: string, status: DayEntry['status'] = 'planned'): DayEntry => ({ id, at, kind: 'meal', status, title: 'Обід', items: [] });
const keys = (r: ReturnType<typeof reminders>) => r.items.map((i) => i.key);

describe('reminders', () => {
  it('planned meals and the medicine times, with generic words only', () => {
    const r = reminders({ entries: [meal('m1', '2026-10-08T13:00:00+03:00')], plan, settings: { ...OFF, meals: true, meds: true }, now, days: 1 });
    expect(keys(r)).toEqual(['med:2026-10-08:08:30', 'meal:m1:2026-10-08T13:00:00+03:00', 'med:2026-10-09:08:30']);
    expect(r.items[0]!.payload).toMatchObject({ t: 'Ліки', k: 'med', h: '08:30', u: './#/?date=2026-10-08' });
    expect(JSON.stringify(r.items)).not.toContain('Вітамін');
  });

  it('medicine a month ahead by default — they keep coming without opening the app', () => {
    const r = reminders({ entries: [], plan, settings: { ...OFF, meds: true }, now });
    expect(r.items).toHaveLength(31);
    expect(r.items.at(-1)!.key).toBe('med:2026-11-07:08:30');
  });

  it('ticked or skipped ones are «done» — that stops repeats on every device', () => {
    const entries: DayEntry[] = [
      meal('m1', '2026-10-08T06:30:00+03:00', 'done'), meal('m2', '2026-10-08T13:00:00+03:00', 'skipped'),
      { id: 'x', at: '2026-10-08T08:31:00+03:00', kind: 'med', status: 'done', title: 'Вітамін D', checkKey: 'med:p-vitd:08:30' },
    ];
    const r = reminders({ entries, plan, settings: { ...OFF, meals: true, meds: true }, now: new Date('2026-10-08T09:00:00'), days: 1 });
    expect(r.done).toEqual(expect.arrayContaining(['meal:m1:2026-10-08T06:30:00+03:00', 'meal:m2:2026-10-08T13:00:00+03:00', 'med:2026-10-08:08:30']));
    expect(keys(r)).toEqual(['med:2026-10-09:08:30']);
  });

  it('a meal just past is still sent (it may be repeating); water every 3 h from 9 to 21, never repeated', () => {
    const r = reminders({ entries: [meal('m1', '2026-10-08T06:50:00+03:00')], plan, settings: { ...OFF, meals: true, waterEveryH: 3, waterIfBehind: false }, now, days: 1 });
    expect(keys(r).filter((k) => k.includes('2026-10-08'))).toEqual(['meal:m1:2026-10-08T06:50:00+03:00', 'water:2026-10-08:09:00',
      'water:2026-10-08:12:00', 'water:2026-10-08:15:00', 'water:2026-10-08:18:00', 'water:2026-10-08:21:00']);
    expect(r.items.find((i) => i.key.startsWith('water'))!.once).toBe(true);
    expect(reminders({ entries: [meal('m1', '2026-10-08T13:00:00+03:00')], plan, now, days: 1, settings: OFF }).items).toEqual([]);
  });

  it('morning plan, evening prep for tomorrow, the day before and the day of tests and the visit', () => {
    const p = { ...plan, prescriptions: [...plan.prescriptions, { id: 't1', kind: 'test' as const, title: 'ОГТТ', dueDate: '2026-10-10', source: '' }],
      nextCheckup: { date: '2026-10-12', tests: [] } };
    const r = reminders({ entries: [], plan: p, settings: { ...OFF, morning: '07:30', evening: '20:30', visits: true }, now, days: 5 });
    const k = keys(r);
    expect(k.slice(0, 2)).toEqual(['morning:2026-10-08', 'evening:2026-10-08']);
    expect(r.items[1]!.payload).toMatchObject({ k: 'evening', d: '2026-10-09', u: './#/?date=2026-10-09' });
    expect(k).toEqual(expect.arrayContaining(['test:2026-10-10:eve', 'test:2026-10-10', 'visit:2026-10-12:eve', 'visit:2026-10-12']));
    expect(new Date(r.items.find((i) => i.key === 'test:2026-10-10:eve')!.at).toString()).toMatch(/Oct 09 2026 19:00/);
    expect(k).not.toContain('morning:2026-10-07'); // yesterday's never comes late
  });

  it('«Пізніше»: the original is done, a new one comes at the snooze time', () => {
    const until = Date.parse('2026-10-08T13:15:00+03:00');
    const r = reminders({ entries: [meal('m1', '2026-10-08T13:00:00+03:00')], plan, settings: { ...OFF, meals: true }, now, days: 1,
      snoozed: { 'meal:m1:2026-10-08T13:00:00+03:00': until } });
    expect(r.done).toContain('meal:m1:2026-10-08T13:00:00+03:00');
    expect(r.items.map((i) => [i.key, i.at])).toEqual([[`snooze:meal:m1:2026-10-08T13:00:00+03:00:${until}`, until]]);
  });
});

describe('«Зараз» / «Не відмічено» / «Далі» (D50)', () => {
  const day = '2026-10-08';
  const entries = [meal('m1', '2026-10-08T13:00:00+03:00'), meal('m0', '2026-10-08T08:00:00+03:00')];
  const at = (hm: string, more: Partial<Parameters<typeof dayFocus>[0]> = {}) =>
    dayFocus({ entries, plan, date: day, now: new Date(`${day}T${hm}:00`), ...more });
  const times = (xs: { time: string }[]) => xs.map((x) => x.time);

  it('due from 30 min before to 60 min after; earlier — «Далі», nothing to mark yet', () => {
    expect(at('07:00')).toEqual({ next: expect.objectContaining({ time: '08:00' }), missed: [] });
    expect(at('07:30').now).toMatchObject({ kind: 'meal', time: '08:00' });
    expect(at('09:00').now).toMatchObject({ kind: 'meal', time: '08:00' }); // 60 min late — still now
  });

  it('after its window an item is «не відмічено», not «take it now»; medicines grouped by time', () => {
    const f = at('09:01');
    expect(times(f.missed)).toEqual(['08:00']);
    expect(f.now).toMatchObject({ kind: 'med', time: '08:30', key: 'med:2026-10-08:08:30', meds: [{ key: 'med:p-vitd:08:30', prescriptionId: 'p-vitd' }] });
    const evening = at('20:00');
    expect(evening.now).toBeUndefined();
    expect(evening.next).toBeUndefined();
    expect(times(evening.missed)).toEqual(['08:00', '08:30', '13:00']);
  });

  it('a meal accepted from «Меню» is planned and becomes «не відмічено» after its window', () => {
    const accepted: DayEntry = { ...meal('m9', '2026-10-08T10:00:00+03:00'), menu: {} };
    const f = dayFocus({ entries: [...entries, accepted], plan, date: day, now: new Date(`${day}T20:00:00`) });
    expect(times(f.missed)).toEqual(['08:00', '08:30', '10:00', '13:00']);
    expect(at('08:10').now?.late).toBe(10);
    expect(at('07:40').now?.late).toBe(-20);
  });

  it('a snoozed item waits — «Далі» shows meanwhile', () => {
    const f = at('09:01', { snoozed: { 'med:2026-10-08:08:30': Date.parse('2026-10-08T09:16:00+03:00') } });
    expect(f.now).toBeUndefined();
    expect(f.next).toMatchObject({ time: '13:00' });
  });

  it('«Пропущено» is a mark too: off the list, and the reminder stops repeating', () => {
    const skipped: DayEntry = { id: 'x', at: '2026-10-08T08:30:00+03:00', kind: 'med', status: 'skipped', title: 'Вітамін D', checkKey: 'med:p-vitd:08:30' };
    const f = dayFocus({ entries: [...entries, skipped], plan, date: day, now: new Date(`${day}T20:00:00`) });
    expect(times(f.missed)).toEqual(['08:00', '13:00']);
    expect(reminders({ entries: [skipped], plan, settings: { ...OFF, meds: true }, now: new Date(`${day}T08:40:00`), days: 1 }).done).toContain('med:2026-10-08:08:30');
  });

  it('nothing when all is done', () => {
    const done: DayEntry[] = [meal('m0', '2026-10-08T08:00:00+03:00', 'done'),
      { id: 'x', at: '2026-10-08T08:31:00+03:00', kind: 'med', status: 'done', title: 'Вітамін D', checkKey: 'med:p-vitd:08:30' }];
    expect(dayFocus({ entries: done, plan, date: day, now: new Date(`${day}T09:00:00`) })).toEqual({ missed: [] });
  });
});

describe('water by pace (D70)', () => {
  const day = '2026-10-08';
  const water = (ml: number): DayEntry => ({ id: `w${ml}`, at: `${day}T10:30:00+03:00`, kind: 'water', status: 'done', title: 'Вода', waterMl: ml });
  const today = (entries: DayEntry[]) => keys(reminders({ entries, plan, settings: { ...OFF, waterEveryH: 3 }, now: new Date(`${day}T10:45:00`), days: 0 }))
    .filter((k) => k.startsWith(`water:${day}`));
  it('today only the slots one is behind at by more than a glass (2,5 l from 08:00 to 21:00); other days as they are', () => {
    expect(today([])).toEqual([`water:${day}:12:00`, `water:${day}:15:00`, `water:${day}:18:00`, `water:${day}:21:00`]);
    // 1,25 l by 10:45: at 15:00 the pace is ~1,35 l — not a glass behind; at 18:00 ~1,92 l — behind
    expect(today([water(1250)])).toEqual([`water:${day}:18:00`, `water:${day}:21:00`]);
    expect(today([water(2500)])).toEqual([]);
  });
});


describe('one rule for a due dose: the course, «за потреби», the first day from the moment it was added (D103)', () => {
  const vitd = plan.prescriptions[0]!; // 08:30
  const omep = { id: 'p-om', kind: 'medication' as const, title: 'Омепразол', dose: '20 мг', source: '', since: '2026-10-08', sinceTime: '10:10', until: '2026-10-10',
    schedule: { times: ['08:00', '20:00'], withFood: false } };
  const p2 = { ...plan, prescriptions: [vitd, omep, { ...omep, id: 'p-par', title: 'Парацетамол', asNeeded: true as const, until: undefined, since: undefined, sinceTime: undefined }] };
  it('no reminder after the course, none for «за потреби», none for a dose before the medicine was added', () => {
    const r = reminders({ entries: [], plan: p2, settings: { ...OFF, meds: true }, now, days: 5 });
    const k = keys(r);
    expect(k).not.toContain('med:2026-10-08:08:00'); // added at 10:10 — the morning dose was not the app's to count
    expect(k).toContain('med:2026-10-08:20:00');
    expect(k).toContain('med:2026-10-10:08:00');
    expect(k.filter((x) => x.startsWith('med:2026-10-11'))).toEqual(['med:2026-10-11:08:30']); // the course is over; vitamin D goes on
  });
  it('«Зараз» says «натщесерце» as well as «під час їжі»', () => {
    const f = dayFocus({ entries: [], plan: p2, date: '2026-10-09', now: new Date('2026-10-09T08:05:00') });
    const med = [...(f.now ? [f.now] : []), ...f.missed].find((x) => x.kind === 'med' && x.time === '08:00');
    expect(med?.meds?.map((m) => [m.title, m.withFood])).toEqual([['Омепразол 20 мг', false]]);
  });
});

describe('the evening nudge when the day is short of the plan (D116)', async () => {
  const { shortGoals } = await import('../../src/domain/topup');
  const { FOODS } = await import('../../src/data/foods');
  const { emptyPlan } = await import('../../src/data/seed.example');
  const foods = new Map(FOODS.map((f) => [f.id, f]));
  const day = (kcal: number, protein: number, mealsDone = 2, p = plan) =>
    shortGoals({ plan: p, targets: p.targets, date: '2026-10-08', foods, usual: [], mealsDone, have: { kcal, protein, calciumMg: 1000, carbs: 100 } });
  it('short of calories or protein by more than a quarter — said; reached, nothing recorded, or no target — silent', () => {
    expect(day(900, 60).map((g) => g.goal)).toEqual(['kcal', 'proteinG']); // the example: 2100 kcal, 140 g
    expect(day(1800, 120)).toEqual([]);
    expect(day(900, 60, 0)).toEqual([]); // a day not recorded — the app cannot know
    expect(day(900, 60, 2, emptyPlan())).toEqual([]); // boundary 7: no target, no advice
  });
  it('one push in the evening, generic words only — no food, no number of the person’s', () => {
    const r = reminders({ entries: [], plan, settings: { ...OFF }, now, days: 1, topupAt: '18:00' });
    expect(keys(r)).toEqual(['topup:2026-10-08']);
    expect(r.items[0]!.payload).toMatchObject({ t: 'Підказка на вечір', k: 'topup', u: './#/assistant?ask=topup' });
    expect(JSON.stringify(r.items[0]!.payload)).not.toMatch(/\d{2,}\s*(ккал|г)/);
    expect(keys(reminders({ entries: [], plan, settings: { ...OFF, topup: false }, now, days: 1, topupAt: '18:00' }))).toEqual([]);
  });
});

describe('what the reminders screen may say about the schedule (D150)', () => {
  it('nothing confirmed, then the server-accepted horizon, then its end', () => {
    const now = new Date(2026, 9, 29, 10, 0);
    expect(scheduleStatus(undefined, now)).toEqual({ kind: 'none' });
    const sent = new Date(2026, 9, 20, 9, 30).getTime();
    expect(scheduleStatus(sent, now)).toMatchObject({ kind: 'until', until: new Date(2026, 10, 19, 9, 30) });
    expect(SCHEDULE_DAYS).toBe(30);
    expect(scheduleStatus(sent, new Date(2026, 10, 19, 9, 31))).toMatchObject({ kind: 'ended' });
  });
});
