// D183: the weight goal helper — the code counts; the Calorize case; the floor; stop conditions give no number at all.
import { describe, expect, it } from 'vitest';
import { emptyPlan } from '../../src/data/seed.example';
import { bmr, eatingDistress, explain, goalPlan, multiplier, plateau, recountDue, stopReasons, type GoalInput } from '../../src/domain/weightGoal';
import type { Plan } from '../../src/domain/types';

const owner: GoalInput = { sex: 'male', age: 41, heightCm: 187, weightKg: 97, goalKg: 87, stepsPerDay: 5000, trainingMinPerWeek: 60 };

describe('the numbers (code only)', () => {
  it('Mifflin–St Jeor by hand: 41, 187 cm, 97 kg, man — 1939', () => {
    expect(Math.round(bmr(owner))).toBe(1939);
    expect(Math.round(bmr({ ...owner, sex: 'female' }))).toBe(1773);
  });
  it('activity from numbers, said with why; not known — sitting ×1.2', () => {
    expect(multiplier().value).toBe(1.2);
    expect(multiplier(undefined, undefined).why).toContain('рахуємо як сидячий');
    expect(multiplier(5000, 60).value).toBe(1.27);
    expect(multiplier(20000, 1000).value).toBe(1.65); // capped
  });
  it('the control case (Calorize): office, kettlebell 2×30 min, 5k steps → 1700–1900 kcal, ≈0.5–0.6 kg a week; 2276 is wrong', () => {
    const g = goalPlan(owner, emptyPlan(), '2026-11-19');
    expect(g.kcal).toBeGreaterThanOrEqual(1700);
    expect(g.kcal).toBeLessThanOrEqual(1900);
    expect(g.kcal).not.toBe(2276);
    expect(g.perWeekKg).toBeGreaterThanOrEqual(0.5);
    expect(g.perWeekKg).toBeLessThanOrEqual(0.6);
    expect(g.proteinG).toEqual([116, 155]); // 1.2–1.6 g/kg, not 194
    expect(g.weeks).toBe(Math.ceil(10 / g.perWeekKg));
  });
  it('never below 1200; never faster than 1 kg a week; a small deficit says its honest price', () => {
    const small: GoalInput = { sex: 'female', age: 60, heightCm: 152, weightKg: 58, goalKg: 54 };
    const g = goalPlan(small, emptyPlan(), '2026-11-19');
    expect(g.kcal).toBe(1200);
    expect(g.floored).toBe(true);
    expect(g.slow).toBe(true);
    expect(explain(g).join(' ')).toMatch(/менше, ніж коливання ваги; перший результат побачите через ~\d+ тижн/);
    expect(goalPlan({ ...owner, deficit: 2000 }, emptyPlan(), '2026-11-19').perWeekKg).toBeLessThanOrEqual(1);
  });
  it('carbohydrates never above the plan’s own limit', () => {
    const p: Plan = { ...emptyPlan(), targets: { carbsG: { max: 130 } } };
    expect(goalPlan(owner, p, '2026-11-19').carbsMaxG).toBe(130);
    expect(explain(goalPlan(owner, p, '2026-11-19')).join(' ')).toContain('не більше 130 г');
  });
});

describe('stop conditions: «спершу з лікарем», no number', () => {
  const med = (title: string, atc?: string) => ({ id: title, kind: 'medication' as const, title, source: 'x', ...(atc ? { med: { name: title, atc } } : {}) });
  const cases: [string, Plan, Partial<GoalInput>, string?][] = [
    ['glucose-lowering', { ...emptyPlan(), prescriptions: [med('Гліклазид MR 60 мг')] }, owner],
    ['glucose-lowering', { ...emptyPlan(), prescriptions: [med('Тресіба', 'A10AE06')] }, owner],
    ['pregnancy', emptyPlan(), { ...owner, sex: 'female', pregnant: true }],
    ['bmi-low', emptyPlan(), { ...owner, weightKg: 60, goalKg: 55 }],
    ['goal-bmi-low', emptyPlan(), { ...owner, goalKg: 62 }],
    ['minor', emptyPlan(), { ...owner, age: 16 }],
    ['kidney-heart', { ...emptyPlan(), targets: { waterMaxMl: 1500 } }, owner],
    ['kidney-heart', { ...emptyPlan(), constraints: [{ id: 'c', tag: 'custom', title: 'ХХН 3 стадії', reason: '', source: '', active: true }] }, owner],
    ['eating', emptyPlan(), owner, 'часто переїдаю, а потім відчуваю провину'],
  ];
  for (const [reason, plan, input, words] of cases) {
    it(reason, () => expect(stopReasons(plan, input, words)).toContain(reason));
  }
  it('metformin alone is not a stop (no hypoglycaemia risk on its own)', () => {
    expect(stopReasons({ ...emptyPlan(), prescriptions: [med('Метформін', 'A10BA02')] }, owner)).toEqual([]);
  });
  it('the words of distress, and ordinary words', () => {
    for (const t of ['викликаю блювоту після їжі', 'голодую по 3 дні', 'булімія']) expect(eatingDistress(t), t).toBe(true);
    for (const t of ['з’їв борщ', 'переїв на святі', 'вчора голодний ліг спати']) expect(eatingDistress(t), t).toBe(false);
  });
});

describe('later', () => {
  const g = { input: owner, kcal: 1820, proteinG: [116, 155] as [number, number], perWeekKg: 0.55, goalDate: '2027-04-01', setAt: '2026-11-01' };
  it('two weeks and a new weighing — «оновити?»; earlier or no new weight — nothing', () => {
    expect(recountDue(g, [{ date: '2026-11-15', kg: 96.1 }], '2026-11-15')?.kg).toBe(96.1);
    expect(recountDue(g, [{ date: '2026-11-10', kg: 96.1 }], '2026-11-10')).toBeNull();
    expect(recountDue(g, [], '2026-11-20')).toBeNull();
  });
  it('a plateau: the weekly average has not gone down for three weeks', () => {
    const flat = ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'].map((date) => ({ date, kg: 97 }));
    expect(plateau(flat)).toBe(true);
    expect(plateau(flat.map((w, i) => ({ ...w, kg: 97 - i * 0.6 })))).toBe(false);
  });
});

describe('the own goal beside the doctor’s', () => {
  const own = { input: owner, kcal: 1850, proteinG: [116, 155] as [number, number], perWeekKg: 0.55, goalDate: '2027-04-01', setAt: '2026-11-19' };
  it('fills only what the plan leaves empty; a doctor’s number wins and is not overwritten', async () => {
    const { effectiveTargets } = await import('../../src/domain/nutrition');
    expect(effectiveTargets({ ...emptyPlan(), ownGoal: own }, '2026-11-20')).toMatchObject({ kcal: 1850, proteinG: 116 });
    expect(effectiveTargets({ ...emptyPlan(), ownGoal: own, targets: { kcal: 1600 } }, '2026-11-20')).toMatchObject({ kcal: 1600, proteinG: 116 });
    expect(effectiveTargets({ ...emptyPlan(), ownGoal: own, targets: { kcal: undefined } }, '2026-11-20').kcal).toBe(1850);
  });
  it('the report has «Що я задав сам», apart from the doctor’s targets', async () => {
    const { buildReport, reportText } = await import('../../src/domain/report');
    const r = buildReport({ from: '2026-11-13', to: '2026-11-19', plan: { ...emptyPlan(), ownGoal: own }, entries: [], workouts: [], wellbeing: [], weights: [], foods: new Map(), now: new Date('2026-11-19T12:00:00') });
    expect(reportText(r, (d) => d)).toContain('Що я задав сам (не призначення лікаря): ціль 87 кг, 1850 ккал, білок 116–155 г, темп 0,55 кг/тиж — від 19.11');
  });
  it('«Помічник»: words of distress about food — a soft word, no numbers, no model', async () => {
    const { routeQuestion } = await import('../../src/domain/assistant');
    expect(routeQuestion('я переїдаю і потім відчуваю провину, скільки калорій мені їсти?', emptyPlan())).toBe('distress');
    expect(routeQuestion('скільки калорій у борщі?', emptyPlan())).not.toBe('distress');
  });
});
