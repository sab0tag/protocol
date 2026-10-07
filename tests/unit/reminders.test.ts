import { describe, expect, it } from 'vitest';
import { examplePlan } from '../../src/data/seed.example';
import { DEFAULT_REMINDERS, reminders } from '../../src/domain/reminders';
import type { DayEntry } from '../../src/domain/types';

const plan = examplePlan(new Date('2026-10-01T12:00:00')); // Вітамін D at 08:30
const now = new Date('2026-10-08T07:00:00');
const meal = (id: string, at: string, status: DayEntry['status'] = 'planned'): DayEntry => ({ id, at, kind: 'meal', status, title: 'Обід', items: [] });

describe('reminders', () => {
  it('planned meals and the medicine times, with generic words only', () => {
    const r = reminders({ entries: [meal('m1', '2026-10-08T13:00:00+03:00')], plan, settings: DEFAULT_REMINDERS, now, days: 2 });
    expect(r.items.filter((i) => i.at < Date.parse('2026-10-09T12:00:00')).map((i) => [i.key, new Date(i.at).toTimeString().slice(0, 5)])).toEqual([
      ['med:2026-10-08:08:30', '08:30'], ['meal:m1:2026-10-08T13:00:00+03:00', '13:00'], ['med:2026-10-09:08:30', '08:30']]);
    const med = r.items[0]!.payload;
    expect(med).toMatchObject({ t: 'Ліки', k: 'med', h: '08:30', u: './#/?date=2026-10-08' });
    expect(JSON.stringify(r.items)).not.toContain('Вітамін');
  });

  it('ticked or skipped ones are «done» — that stops repeats on every device', () => {
    const entries: DayEntry[] = [
      meal('m1', '2026-10-08T06:30:00+03:00', 'done'), meal('m2', '2026-10-08T13:00:00+03:00', 'skipped'),
      { id: 'x', at: '2026-10-08T08:31:00+03:00', kind: 'med', status: 'done', title: 'Вітамін D', checkKey: 'med:p-vitd:08:30' },
    ];
    const r = reminders({ entries, plan, settings: DEFAULT_REMINDERS, now: new Date('2026-10-08T09:00:00'), days: 1 });
    expect(r.done).toEqual(expect.arrayContaining(['meal:m1:2026-10-08T06:30:00+03:00', 'meal:m2:2026-10-08T13:00:00+03:00', 'med:2026-10-08:08:30']));
    expect(r.items.map((i) => i.key)).toEqual(['med:2026-10-09:08:30']);
  });

  it('a meal just past is still sent (it may be repeating); water every 3 h from 9 to 21; switches work', () => {
    const r = reminders({ entries: [meal('m1', '2026-10-08T06:50:00+03:00')], plan,
      settings: { meals: true, meds: false, waterEveryH: 3, repeatMin: 15 }, now, days: 1 });
    expect(r.items.filter((i) => i.key.includes('2026-10-08')).map((i) => i.key)).toEqual(['meal:m1:2026-10-08T06:50:00+03:00', 'water:2026-10-08:09:00',
      'water:2026-10-08:12:00', 'water:2026-10-08:15:00', 'water:2026-10-08:18:00', 'water:2026-10-08:21:00']);
    expect(reminders({ entries: [meal('m1', '2026-10-08T13:00:00+03:00')], plan, now, days: 1,
      settings: { meals: false, meds: false, waterEveryH: 0, repeatMin: 0 } }).items).toEqual([]);
  });
});
