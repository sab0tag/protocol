import { describe, expect, it } from 'vitest';
import { FOODS } from '../../src/data/foods';
import { examplePlan } from '../../src/data/seed.example';
import { wellbeingCoincidences } from '../../src/domain/progress';
import type { DayEntry, Wellbeing } from '../../src/domain/types';

const foods = new Map(FOODS.map((f) => [f.id, f]));
const plan = examplePlan(new Date('2026-09-01T12:00:00')); // dinner by 20:00
const d = (n: number) => `2026-09-${String(n).padStart(2, '0')}`;
const supper = (n: number, hm: string): DayEntry => ({ id: `s${n}`, at: `${d(n)}T${hm}:00+03:00`, kind: 'meal', status: 'done', title: 'Вечеря',
  items: [{ foodId: 'buckwheat-boiled', name: 'Гречка варена', grams: 150 }] });

describe('wellbeing and the day (D71)', () => {
  it('sleep after late dinners vs after others — said only with 5+ nights each and a clear difference', () => {
    const entries: DayEntry[] = [], wb: Wellbeing[] = [];
    for (let n = 1; n <= 12; n++) {
      const late = n % 2 === 0;
      entries.push(supper(n, late ? '21:30' : '19:00'));
      wb.push({ date: d(n + 1), sleep: late ? 2 : 4, symptoms: [] }); // the night after
    }
    const p = wellbeingCoincidences(entries, wb, foods, plan);
    expect(p.map((x) => x.text)).toEqual(['Сон після днів, коли вечеря пізніше 20:00, — 2,0, після інших — 4,0 (з 5; 6 і 6 ночей)']);
  });

  it('too few days or no real difference — nothing', () => {
    const entries = [supper(1, '21:30'), supper(2, '19:00')];
    expect(wellbeingCoincidences(entries, [{ date: d(2), sleep: 2, symptoms: [] }, { date: d(3), sleep: 4, symptoms: [] }], foods, plan)).toEqual([]);
  });
});
