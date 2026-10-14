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
