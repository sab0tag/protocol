import { describe, expect, it } from 'vitest';
import { examplePlan } from '../../src/data/seed.example';
import { applyLines, draftLines, sourceOf, timesToSet, type ConclusionResult } from '../../src/domain/conclusion';

let n = 0;
const id = () => `id${++n}`;
const R: ConclusionResult = {
  readable: true, date: '2026-10-12', doctor: 'Ендокринолог', note: null, tests: ['Глюкоза натще', 'HbA1c'], nextVisit: null,
  constraints: [
    { tag: 'lactose', title: 'Непереносимість лактози', reason: 'Без молока', allergens: [] },
    { tag: 'allergy', title: 'Алергія на горіхи', reason: '', allergens: ['nuts', 'nonsense'] },
    { tag: 'allergy', title: 'Алергія невідомо на що', reason: '', allergens: [] }, // an allergy with no allergen is dropped
    { tag: 'weird', title: 'Менше смаженого', reason: '', allergens: [] },
  ],
  prescriptions: [
    { kind: 'supplement', title: 'Вітамін D', dose: '2000 МО', times: ['8:00', '08:30', 'вранці'], frequency: '1 раз на день', withFood: true },
    { kind: 'medication', title: 'Метформін', dose: '500 мг', times: [], frequency: '2 рази на день', withFood: null },
  ],
  targets: { kcal: 1800, proteinG: 9000, carbsMaxG: 150, fatG: null, waterMl: 2000, lastMealBy: '19:00', weightGoalKg: null, maxWeightLossKgPerWeek: null },
};

describe('a doctor’s conclusion → the plan (D80)', () => {
  const lines = draftLines(R, id);
  it('checks the model’s lines: no invented times, sane numbers, known tags only', () => {
    expect(sourceOf(R)).toBe('Ендокринолог, 12.10.2026');
    const c = lines.filter((l) => l.kind === 'constraint').map((l) => l.kind === 'constraint' && [l.constraint.tag, l.constraint.allergens]);
    expect(c).toEqual([['lactose', undefined], ['allergy', ['nuts']], ['custom', undefined]]);
    const p = lines.flatMap((l) => (l.kind === 'prescription' ? [l.prescription] : []));
    expect(p[0]).toMatchObject({ title: 'Вітамін D', dose: '2000 МО', schedule: { times: ['08:30'], withFood: true }, notes: '1 раз на день' });
    expect(p[1]!.schedule).toBeUndefined(); // «2 рази на день» is not a time (D52) — the person sets it
    expect(p.slice(2).map((x) => [x.kind, x.title])).toEqual([['test', 'Глюкоза натще'], ['test', 'HbA1c']]); // no visit date
    const t = lines.filter((l) => l.kind === 'target').map((l) => l.kind === 'target' && l.key);
    expect(t).toEqual(['kcal', 'waterMl', 'carbsG', 'lastMealBy']); // protein 9000 g is not a number to keep
  });

  it('puts only the ticked lines in, updating what is already there', () => {
    const plan = examplePlan(new Date('2026-10-17T12:00:00'));
    const picked = lines.filter((l) => l.kind === 'constraint' && l.constraint.tag === 'lactose'
      || l.kind === 'prescription' && l.prescription.title === 'Вітамін D' || l.kind === 'target' && l.key === 'waterMl');
    const out = applyLines(plan, picked);
    expect(out.constraints).toHaveLength(plan.constraints.length); // the lactose limit updated in place
    expect(out.constraints.find((c) => c.tag === 'lactose')).toMatchObject({ id: 'c-lactose', reason: 'Без молока', source: 'Ендокринолог, 12.10.2026' });
    expect(out.prescriptions).toHaveLength(1);
    expect(out.prescriptions[0]).toMatchObject({ id: 'p-vitd', dose: '2000 МО' });
    expect(out.targets).toMatchObject({ waterMl: 2000, kcal: plan.targets.kcal });
  });
});

describe('doses a day still to be timed (D80)', () => {
  const p = (notes: string, times: string[] = []) => ({ id: 'x', kind: 'medication' as const, title: 'М', source: '', notes, ...(times.length ? { schedule: { times } } : {}) });
  it('reads «2 рази на день», «двічі на добу»; nothing once timed or once a day', () => {
    expect(timesToSet(p('2 рази на день, 2 місяці'))).toBe(2);
    expect(timesToSet(p('двічі на добу'))).toBe(2);
    expect(timesToSet(p('3 р. на день'))).toBe(3);
    expect(timesToSet(p('1 раз на день'))).toBeUndefined();
    expect(timesToSet(p('2 рази на день', ['08:00', '20:00']))).toBeUndefined();
  });
});
