import { describe, expect, it } from 'vitest';
import { examplePlan } from '../../src/data/seed.example';
import { nowItem, reminders, type ReminderSettings } from '../../src/domain/reminders';
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
    const r = reminders({ entries: [meal('m1', '2026-10-08T06:50:00+03:00')], plan, settings: { ...OFF, meals: true, waterEveryH: 3 }, now, days: 1 });
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

describe('«Зараз»', () => {
  const day = '2026-10-08';
  it('the earliest overdue first, else the next; medicines grouped by time; snoozed ones wait', () => {
    const entries = [meal('m1', '2026-10-08T13:00:00+03:00'), meal('m0', '2026-10-08T08:00:00+03:00')];
    expect(nowItem({ entries, plan, date: day, now: new Date('2026-10-08T07:00:00') })).toMatchObject({ kind: 'meal', time: '08:00', overdue: false });
    const n = nowItem({ entries, plan, date: day, now: new Date('2026-10-08T09:00:00') })!;
    expect(n).toMatchObject({ kind: 'meal', time: '08:00', overdue: true });
    const later = nowItem({ entries, plan, date: day, now: new Date('2026-10-08T09:00:00'), snoozed: { [n.key]: Date.parse('2026-10-08T09:15:00+03:00') } })!;
    expect(later).toMatchObject({ kind: 'med', time: '08:30', meds: [{ key: 'med:p-vitd:08:30', prescriptionId: 'p-vitd' }] });
    expect(later.key).toBe('med:2026-10-08:08:30');
  });

  it('nothing when all is done', () => {
    const entries: DayEntry[] = [meal('m0', '2026-10-08T08:00:00+03:00', 'done'),
      { id: 'x', at: '2026-10-08T08:31:00+03:00', kind: 'med', status: 'done', title: 'Вітамін D', checkKey: 'med:p-vitd:08:30' }];
    expect(nowItem({ entries, plan, date: day, now: new Date('2026-10-08T09:00:00') })).toBeUndefined();
  });
});
