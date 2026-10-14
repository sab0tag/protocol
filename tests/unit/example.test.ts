import { describe, expect, it } from 'vitest';
import { emptyPlan, examplePlan, hasExample, withoutExample } from '../../src/data/seed.example';

describe('the example plan (D73)', () => {
  it('is recognised and taken out without touching what the person added', () => {
    const ex = examplePlan();
    const mine = { id: 'mine', kind: 'medication' as const, title: 'Мій препарат', source: 'Ендокринолог' };
    const plan = { ...ex, prescriptions: [...ex.prescriptions, mine] };
    expect(hasExample(plan)).toBe(true);
    const out = withoutExample(plan);
    expect(out.prescriptions).toEqual([mine]);
    expect(out.constraints).toEqual([]);
    expect(out.modes).toEqual([]);
    expect(out.targets).toEqual({}); // still exactly the example's
    expect(hasExample({ ...plan, ...out })).toBe(false);
  });

  it('keeps targets the person changed', () => {
    const ex = examplePlan();
    const targets = { ...ex.targets, waterMl: 2000 };
    expect(withoutExample({ ...ex, targets }).targets).toEqual(targets);
  });

  it('an empty plan is not the example', () => expect(hasExample(emptyPlan())).toBe(false));
});
