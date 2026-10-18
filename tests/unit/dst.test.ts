// D75: the autumn hour. On 25 October 2026 Kyiv goes from 04:00 (+03:00) back to 03:00 (+02:00): 03:00–04:00 happens
// twice. Everything that counts hours or orders records goes by the instant, not by the text of `at`.
import { describe, expect, it } from 'vitest';
import { atLocal, byAt, dateOf, isPast } from '../../src/domain/dates';
import { eatenBefore } from '../../src/domain/symptoms';
import type { DayEntry } from '../../src/domain/types';

const meal = (id: string, at: string): DayEntry => ({ id, at, kind: 'meal', status: 'done', title: id, items: [] });

describe('the autumn hour, 25 October (D75)', () => {
  it('the device offset changes with the day', () => {
    expect(atLocal('2026-10-24', '12:00')).toBe('2026-10-24T12:00:00+03:00');
    expect(atLocal('2026-10-25', '12:00')).toBe('2026-10-25T12:00:00+02:00');
    expect(dateOf('2026-10-25T00:30:00+03:00')).toBe('2026-10-25');
  });

  it('«6 hours before» is 6 real hours, though the wall clock shows 5½ across the change', () => {
    const symptom = '2026-10-25T04:30:00+02:00'; // 02:30 UTC
    const entries = [meal('late', '2026-10-24T23:00:00+03:00') /* 20:00 UTC: 6½ h */, meal('night', '2026-10-25T00:00:00+03:00') /* 5½ h */];
    expect(eatenBefore(entries, symptom).map((e) => e.id)).toEqual(['night']);
  });

  it('in the repeated hour the second 03:10 is after the first 03:30', () => {
    const first = meal('first', '2026-10-25T03:30:00+03:00'), second = meal('second', '2026-10-25T03:10:00+02:00');
    expect([second, first].sort(byAt).map((e) => e.id)).toEqual(['first', 'second']);
    expect(eatenBefore([first, second], '2026-10-25T03:20:00+02:00').map((e) => e.id)).toEqual(['second', 'first']);
  });

  it('«already past» compares instants, whatever the offsets', () => {
    const now = Date.parse('2026-10-14T12:30:00Z');
    expect(isPast('2026-10-14T15:00:00+03:00', now)).toBe(true); // 12:00 UTC — the text «15:00» is not «later»
    expect(isPast('2026-10-14T15:45:00+03:00', now)).toBe(false);
  });
});

describe('the week arrows (D99)', () => {
  it('from Sunday the next week opens on Monday, not a week later; back — on Sunday; today when it is there', async () => {
    const { weekStep } = await import('../../src/domain/dates');
    expect(weekStep('2026-10-18', 1, '2026-10-01')).toBe('2026-10-19');
    expect(weekStep('2026-10-12', -1, '2026-10-01')).toBe('2026-10-11');
    expect(weekStep('2026-10-14', 1, '2026-10-21')).toBe('2026-10-21'); // today is in that week
    expect(weekStep('2026-10-25', 1, '2026-10-01')).toBe('2026-10-26'); // across the autumn hour
  });
});
