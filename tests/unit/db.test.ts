import { describe, expect, it } from 'vitest';
import { ensureSeeded, ProtocolDB } from '../../src/data/db';
import { FOODS } from '../../src/data/foods';

describe('storage', () => {
  it('seeds once and keeps entries after a restart', async () => {
    const first = new ProtocolDB('test-restart');
    await ensureSeeded(first);
    await ensureSeeded(first);                             // idempotent
    expect(await first.foods.count()).toBe(FOODS.length);
    await first.entries.add({ id: 'a', at: '2026-10-04T08:00:00+03:00', kind: 'water', status: 'done', title: 'Вода', waterMl: 250 });
    first.close();

    const again = new ProtocolDB('test-restart');          // the app is closed and opened again
    expect(await again.entries.get('a')).toMatchObject({ waterMl: 250 });
    expect((await again.plan.get('main'))?.constraints.length).toBe(0); // D73: an empty plan, the example only on request
    expect(await again.entries.where('at').startsWith('2026-10-04').count()).toBe(1);
    again.close();
  });
});

describe('the base on start (D83)', () => {
  it('a base row taken out of foods.ts leaves the device; a person’s own food stays', async () => {
    const d = new ProtocolDB('test-removed');
    await d.foods.bulkPut([{ id: 'kompot', name: 'Компот', per100g: { kcal: 60, protein: 0, fat: 0, carbs: 15, calciumMg: 0 }, tags: [] },
      { id: 'u-1', name: 'Мій компот', per100g: { kcal: 40, protein: 0, fat: 0, carbs: 10, calciumMg: 0 }, tags: [], custom: true }]);
    await ensureSeeded(d);
    expect(await d.foods.get('kompot')).toBeUndefined();
    expect(await d.foods.get('u-1')).toBeDefined();
    expect((await d.foods.where('name').equals('Компот').count())).toBe(1);
    d.close();
  });
});
