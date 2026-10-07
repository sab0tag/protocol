import { describe, expect, it } from 'vitest';
import { menuSchema } from '../src/menu.ts';

describe('menu schema', () => {
  it('only names from the list', () => {
    const s = menuSchema(['Яйце варене', 'Вінегрет']);
    const meal = (name: string) => ({ meals: [{ title: 'Обід', time: '13:00', items: [{ name, grams: 200, count: null }] }], tips: [] });
    expect(s.safeParse(meal('Вінегрет')).success).toBe(true);
    expect(s.safeParse(meal('Піца')).success).toBe(false);
  });
});
