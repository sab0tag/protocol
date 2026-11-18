import { describe, expect, it } from 'vitest';
import { dosesNow, medsState, MOOD_WORDS, openDoses } from '../../src/domain/quickMarks';
import type { CheckItem } from '../../src/domain/checklist';

const dose = (key: string, time: string, extra: Partial<CheckItem> = {}): CheckItem =>
  ({ key, kind: 'med', title: key, time, done: false, tappable: true, ...extra });
const at = (hm: string) => new Date(`2026-11-17T${hm}:00`);

describe('quick marks on «Сьогодні» (D164)', () => {
  it('one tap on «Ліки» means the open doses due now — 30 min before to an hour after; never a ticked, skipped or uncertain one', () => {
    const items = [dose('a', '08:00'), dose('b', '08:00'), dose('c', '08:00', { done: true }), dose('d', '08:00', { skipped: true }),
      dose('e', '08:00', { uncertain: true }), dose('f', '20:00'), { key: 'w', kind: 'water', title: 'Вода', done: false, tappable: false } as CheckItem];
    expect(dosesNow(items, at('08:20')).map((d) => d.key)).toEqual(['a', 'b']); // two at once — a list, not one at random
    expect(dosesNow(items, at('07:30')).map((d) => d.key)).toEqual(['a', 'b']);
    expect(dosesNow(items, at('07:29'))).toEqual([]);
    expect(dosesNow(items, at('09:01'))).toEqual([]); // past its hour — the day's list asks, as D52
    expect(dosesNow(items, at('19:45')).map((d) => d.key)).toEqual(['f']);
    expect(openDoses(items).map((d) => d.key)).toEqual(['a', 'b', 'f']);
  });

  it('states are words or numbers: «2 з 5» doses (water is in litres, D169 — fluid.test)', () => {
    expect(medsState([dose('a', '08:00', { done: true }), dose('b', '08:00', { done: true }), dose('c', '13:00'), dose('d', '20:00'), dose('e', '22:00')]))
      .toEqual({ done: 2, total: 5 });
    expect(MOOD_WORDS).toEqual(['Дуже погано', 'Погано', 'Так собі', 'Добре', 'Чудово']);
  });
});
