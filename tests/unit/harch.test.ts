// D90: the Харчоблок snapshot — diets of Наказ №931, cards, substitutions — read as the app reads it.
import { describe, expect, it } from 'vitest';
import products from '../../src/data/harch/products.json';
import source from '../../src/data/harch/source.json';
import { HARCH_PRODUCT } from '../../src/data/harch/productMap';
import { harchDishes, HARCH_SUBSTITUTIONS } from '../../src/data/harchDishes';
import { FOODS } from '../../src/data/foods';
import { DIETS, dietConflicts, dietCoverage, dietOf, fillEmptyTargets, findDiets, ownTargets, type DietRule } from '../../src/domain/diets';
import { checkMeal } from '../../src/domain/rules';

const foods = new Map(FOODS.map((f) => [f.id, f]));

describe('Харчоблок shared reference (D90)', () => {
  it('the snapshot is of a known commit and all unverified: 8 diets, 130 cards, 26 substitutions', () => {
    expect(source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(DIETS.map((d) => d.code)).toEqual(['ОВД', 'ЩД', 'ВБД', 'НБД', 'НКД', '№9', '№1а', '№4']);
    expect(DIETS.every((d) => !d.verified)).toBe(true);
    expect(harchDishes(foods)).toHaveLength(130);
    expect(HARCH_SUBSTITUTIONS).toHaveLength(26);
  });
  it('every product is mapped by hand (to a food of this base or to none), and every mapping exists', () => {
    for (const p of products as { name: string }[]) expect(p.name in HARCH_PRODUCT, p.name).toBe(true);
    for (const id of Object.values(HARCH_PRODUCT)) if (id) expect(foods.has(id), id).toBe(true);
  });
  it('old table numbers suggest the diet; nothing chosen by itself', () => {
    expect(findDiets('стіл 5').map((x) => [x.diet.code, x.byTable])).toEqual([['ЩД', '5']]);
    expect(findDiets('стол №15')[0]?.diet.code).toBe('ОВД');
    expect(findDiets('9')[0]?.diet.code).toBe('№9');
    expect(findDiets('щд')[0]?.diet.code).toBe('ЩД');
  });
  it('norms fill only empty targets; a doctor\'s target outside the norm is a question', () => {
    const shd = DIETS.find((d) => d.code === 'ЩД')!;
    expect(fillEmptyTargets({ kcal: 1800 }, shd)).toMatchObject({ kcal: 1800, proteinG: 88 });
    const plan = { constraints: [{ id: 'd', tag: 'diet' as const, diet: 'ЩД', title: 'ЩД', reason: '', source: '', active: true }], targets: { kcal: 1800 } };
    expect(dietConflicts(plan)).toEqual([{ code: 'ЩД', field: 'kcal', target: 1800, range: [2170, 2480] }]);
  });
  it('an unchecked diet never flags food', () => {
    const plan = { constraints: [{ id: 'd', tag: 'diet' as const, diet: 'ЩД', title: 'ЩД', reason: '', source: '', active: true }], prescriptions: [], targets: {}, modes: [] };
    const hits = checkMeal({ plan, date: '2026-10-18', foods, dayEntries: [], recentEntries: [], meal: [{ name: 'Картопля смажена', grams: 200, cooking: 'fried' }] });
    expect(hits.flatMap((h) => h.hits).filter((h) => h.reason === 'diet')).toEqual([]);
  });
});

// R02: the rules' machinery, with made-up rules (the clinical content is a dietitian's work, not this test's)
describe('a diet as a set of checked rules (R02)', () => {
  const diet = (code: string, off: string[] = []) => ({ id: code, tag: 'diet' as const, diet: code, title: code, reason: '', source: '', active: true, off });
  const rule = (o: Partial<DietRule>): DietRule => ({ id: 'r', version: 1, kind: 'exclude', title: 'без смаженого', match: { cooking: ['fried'] }, checkedBy: 'Тест', checkedAt: '2026-10-24', ...o });
  const withRules = <T,>(rules: Record<string, DietRule[]>, fn: () => T): T => {
    const was = Object.fromEntries(Object.keys(rules).map((k) => [k, dietOf(k)!.rules]));
    for (const [k, rs] of Object.entries(rules)) dietOf(k)!.rules = rs;
    try { return fn(); } finally { for (const [k, rs] of Object.entries(was)) dietOf(k)!.rules = rs; }
  };
  const hits = (constraints: ReturnType<typeof diet>[], meal: { name: string; grams: number; cooking?: 'fried'; foodId?: string }[], dayEntries = []) =>
    checkMeal({ plan: { constraints, prescriptions: [], targets: {}, modes: [] }, date: '2026-10-24', foods, dayEntries, recentEntries: [], meal })
      .flatMap((c) => c.hits).filter((h) => h.reason === 'diet');

  it('an empty set of rules is seen as such: «not set up», nothing counted', () => {
    expect(dietCoverage({ constraints: [diet('ЩД')] })).toEqual([expect.objectContaining({ code: 'ЩД', active: 0, configured: false })]);
  });

  it('every match of every active diet, not the first; the same rule of two diets — one reason naming both', () => {
    withRules({ ЩД: [rule({ id: 'fried' }), rule({ id: 'smoked', title: 'без копченого', match: { words: ['копчен'] } })], ВБД: [rule({ id: 'fried' })] }, () => {
      const h = hits([diet('ЩД'), diet('ВБД')], [{ name: 'Ковбаса копчена', grams: 50, cooking: 'fried' }]);
      expect(h.map((x) => x.message)).toEqual(['ЩД, ВБД: без смаженого', 'ЩД: без копченого']);
      expect(h[0]!.ruleId).toBe('fried@1');
    });
  });

  it('a rule switched off, or not checked by a specialist, is not run; a limit in words only is not run as a quantity', () => {
    withRules({ ЩД: [rule({ id: 'fried' }), rule({ id: 'nochk', title: 'без солі', match: { words: ['ковбас'] }, checkedBy: undefined }),
      rule({ id: 'words', kind: 'limit', title: 'менше ковбаси', match: { words: ['ковбас'] } })] }, () => {
      expect(hits([diet('ЩД', ['fried'])], [{ name: 'Ковбаса копчена', grams: 50, cooking: 'fried' }])).toEqual([]);
      expect(dietCoverage({ constraints: [diet('ЩД', ['fried'])] })[0]).toMatchObject({ active: 0, off: 1, unchecked: 1, configured: false });
    });
  });

  it('a limit with its numbers counts the grams of its foods over the day', () => {
    withRules({ ЩД: [rule({ id: 'sausage', kind: 'limit', title: 'ковбаса не більше 50 г на день', match: { words: ['ковбас'] }, limit: { value: 50, unit: 'g', per: 'day' } })] }, () => {
      expect(hits([diet('ЩД')], [{ name: 'Ковбаса варена', grams: 40 }])).toEqual([]);
      const day = [{ id: 'm', at: '2026-10-24T08:00:00', kind: 'meal' as const, status: 'done' as const, title: 'Сніданок', items: [{ name: 'Ковбаса варена', grams: 30 }] }];
      expect(hits([diet('ЩД')], [{ name: 'Ковбаса варена', grams: 40 }], day as never).map((x) => x.message)).toEqual(['ЩД: ковбаса не більше 50 г на день — за день 70 з 50 г']);
    });
  });

  it('the reference norms become targets only on command, marked as the diet’s; a field edited is the person’s again', () => {
    const shd = DIETS.find((d) => d.code === 'ЩД')!;
    const filled = fillEmptyTargets({ kcal: 1800 }, shd);
    expect(filled.fromDiet).toEqual({ proteinG: 'ЩД', fatG: 'ЩД', carbsG: 'ЩД' });
    expect(ownTargets(filled, { ...filled, proteinG: 100 }).fromDiet).toEqual({ fatG: 'ЩД', carbsG: 'ЩД' });
  });
});
