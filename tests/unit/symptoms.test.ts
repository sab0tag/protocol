import { describe, expect, it } from 'vitest';
import { eatenBefore, isDanger } from '../../src/domain/symptoms';
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
