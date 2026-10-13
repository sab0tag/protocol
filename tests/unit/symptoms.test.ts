import { describe, expect, it } from 'vitest';
import { FOODS } from '../../src/data/foods';
import { coincidences, coincidenceText, eatenBefore, isDanger } from '../../src/domain/symptoms';
import type { DayEntry } from '../../src/domain/types';

const meal = (id: string, at: string, more: Partial<DayEntry> = {}): DayEntry => ({ id, at, kind: 'meal', status: 'done', title: id, items: [], ...more });

describe('«Мені погано» (D56)', () => {
  it('what was eaten in the 6 hours before — across midnight, latest first; planned, unknown-time and later meals are not', () => {
    const entries = [
      meal('supper', '2026-10-12T22:30:00+03:00'),
      meal('lunch', '2026-10-12T13:00:00+03:00'),
      meal('breakfast', '2026-10-13T01:40:00+03:00'),
      meal('plan', '2026-10-13T01:00:00+03:00', { status: 'planned' }),
      meal('vague', '2026-10-13T00:30:00+03:00', { timeUnknown: true }),
      meal('after', '2026-10-13T03:00:00+03:00'),
    ];
    expect(eatenBefore(entries, '2026-10-13T02:00:00+03:00').map((e) => e.id)).toEqual(['breakfast', 'supper']);
  });

  it('danger signs are known', () => {
    expect(isDanger('Важко дихати')).toBe(true);
    expect(isDanger('Здуття')).toBe(false);
  });
});

describe('coincidences (D59)', () => {
  // kefir holds milk; buckwheat holds nothing
  const foods = new Map(FOODS.map((f) => [f.id, f]));
  const day = (d: number) => `2026-10-${String(d).padStart(2, '0')}`;
  const ate = (d: number, hm: string, foodId: string): DayEntry => ({ id: `${d}${hm}${foodId}`, at: `${day(d)}T${hm}:00+03:00`, kind: 'meal', status: 'done',
    title: 'x', items: [{ foodId, name: foodId, grams: 200 }] });
  const felt = (d: number, hm: string, s = 'Здуття'): DayEntry => ({ id: `s${d}${hm}`, at: `${day(d)}T${hm}:00+03:00`, kind: 'symptom', status: 'done', title: s, symptoms: [s] });

  it('a symptom 3+ times, mostly after one group, clearly more than on an ordinary day — and nothing else', () => {
    const entries: DayEntry[] = [];
    for (let d = 1; d <= 10; d++) entries.push(ate(d, '08:00', 'buckwheat-boiled'));
    for (const d of [2, 4, 6, 8]) { entries.push(ate(d, '13:00', 'kefir')); entries.push(felt(d, '15:00')); }
    entries.push(felt(9, '15:00'));
    const c = coincidences(entries, foods);
    expect(c).toEqual([{ symptom: 'Здуття', group: 'milk', hits: 4, events: 5, baselinePct: 40 }]);
    expect(coincidenceText(c[0]!)).toBe('«Здуття» — 4 з 5 разів протягом 6 год після продуктів, що містять: молоко; на звичайний день із записами — 40 %');
  });

  it('too few records, or as common as any day — not said', () => {
    expect(coincidences([ate(1, '13:00', 'kefir'), felt(1, '15:00'), ate(2, '13:00', 'kefir'), felt(2, '15:00')], foods)).toEqual([]);
    const daily: DayEntry[] = [];
    for (let d = 1; d <= 6; d++) { daily.push(ate(d, '13:00', 'kefir')); if (d % 2) daily.push(felt(d, '15:00')); }
    expect(coincidences(daily, foods)).toEqual([]); // kefir every day: 100 % before, 100 % on any day
  });
});
