import { describe, expect, it } from 'vitest';
import { BudgetGuard } from './budgets.ts';

const guard = () => new BudgetGuard([{ scope: 'day', limit: 100 }, { scope: 'user:a', limit: 60 }], { perOperationCap: 50 });

describe('AI budget guard', () => {
  it('blocks before dispatch when any scope would be exceeded', () => {
    const g = guard();
    expect(g.reserve('1', 'meal_generation', 40, ['day', 'user:a']).ok).toBe(true);
    const r = g.reserve('2', 'meal_generation', 30, ['day', 'user:a']);
    expect(r).toEqual({ ok: false, reason: 'over_budget', scope: 'user:a' });
    expect(g.used('day')).toBe(40);
  });

  it('rejects an operation above the per-operation cap', () => {
    expect(guard().reserve('1', 'x', 51, ['day'])).toEqual({ ok: false, reason: 'operation_cap' });
  });

  it('does not double-charge a repeated operation id', () => {
    const g = guard();
    g.reserve('1', 'x', 30, ['day']);
    const again = g.reserve('1', 'x', 30, ['day']);
    expect(again).toMatchObject({ ok: true, replay: true });
    expect(g.used('day')).toBe(30);
  });

  it('parallel requests cannot jointly exceed the limit', async () => {
    const g = guard();
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => Promise.resolve().then(() => g.reserve(`p${i}`, 'x', 30, ['day']))));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(g.used('day')).toBeLessThanOrEqual(100);
  });

  it('commit frees the unused reserve once; release returns everything', () => {
    const g = guard();
    g.reserve('1', 'x', 40, ['day']);
    g.commit('1', 10);
    g.commit('1', 10);
    expect(g.used('day')).toBe(10);
    g.reserve('2', 'x', 40, ['day']);
    g.release('2');
    expect(g.used('day')).toBe(10);
  });

  it('warns once when 80% is crossed and honours a disabled feature', () => {
    const g = guard();
    expect(g.reserve('1', 'x', 40, ['day'])).toMatchObject({ warnings: [] });
    expect(g.reserve('2', 'x', 45, ['day'])).toMatchObject({ warnings: ['day'] });
    g.disableFeature('meal_generation');
    expect(g.reserve('3', 'meal_generation', 1, ['day'])).toEqual({ ok: false, reason: 'feature_disabled' });
  });
});
