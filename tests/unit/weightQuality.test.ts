import { describe, expect, it } from 'vitest';
import { weightInputProblem, weightQuality } from '../../src/domain/weightQuality';
import { weeklyWeights, weightSummary } from '../../src/domain/progress';
import { buildReport, reportText } from '../../src/domain/report';
import type { WeightLog } from '../../src/domain/types';
const today = '2026-10-27';
const rows: WeightLog[] = [{ date: '2026-10-01', kg: 100 }, { date: '2026-10-08', kg: 9.1 }, { date: '2026-10-15', kg: 99 }];
describe('measurement quality', () => {
  it('quarantines a unit/decimal typo without using it as the next baseline', () => {
    const result = weightQuality(rows, today);
    expect(result.accepted.map(r => r.kg)).toEqual([100, 99]);
    expect(result.pending).toEqual([{ record: rows[1], reason: 'jump' }]);
    expect(weeklyWeights(rows)).toEqual(weeklyWeights([rows[0]!, rows[2]!]));
    expect(weightSummary(rows)).toEqual({ start: rows[0], now: rows[2], delta: -1 });
    expect(rows[1]?.kg).toBe(9.1); // stored source is not deleted or silently corrected
  });
  it('accepts an explicitly verified change but rechecks edits to its exact value', () => {
    const verified = { ...rows[1]!, reviewedKg: 9.1, reviewedAt: '2026-10-27T12:00:00Z' };
    expect(weightQuality([rows[0]!, verified], today).accepted).toHaveLength(2);
    expect(weightQuality([rows[0]!, { ...verified, kg: 8.1 }], today).pending[0]?.reason).toBe('jump');
  });
  it.each([NaN, Infinity, -1, 0, 0.01, 1001, '90'])('rejects malformed value %s even if marked reviewed', n => {
    expect(weightInputProblem('2026-10-27', n as number, today)).toBe('value');
    expect(weightQuality([{ date: '2026-10-27', kg: n as number, reviewedKg: n as number }], today).accepted).toHaveLength(0);
  });
  it.each(['', 'not-a-date', '2026-02-30', '2026-13-01', '2026-10-28'])('does not aggregate invalid/future date %s', date => {
    expect(weightInputProblem(date, 90, today)).toBe('date');
  });
  it('applies the same global review before restricting the doctor report period', () => {
    const report = buildReport({ plan: undefined, from: '2026-10-08', to: '2026-10-20', entries: [], workouts: [], wellbeing: [], foods: new Map(), weights: rows, now: new Date('2026-10-27T12:00:00Z') });
    expect(report.weightStart).toBe(99); expect(report.weightNow).toBe(99);
    expect(report.weightPace).toBeUndefined(); expect(report.weightPending).toBe(1);
    expect(reportText(report, d => d)).toContain('Виміри ваги на перевірці: 1');
    expect(reportText(report, d => d)).not.toContain('9,1');
  });
});
