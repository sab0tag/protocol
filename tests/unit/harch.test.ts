// D90: the Харчоблок snapshot — diets of Наказ №931, cards, substitutions — read as the app reads it.
import { describe, expect, it } from 'vitest';
import products from '../../src/data/harch/products.json';
import source from '../../src/data/harch/source.json';
import { HARCH_PRODUCT } from '../../src/data/harch/productMap';
import { harchDishes, HARCH_SUBSTITUTIONS } from '../../src/data/harchDishes';
import { FOODS } from '../../src/data/foods';
import { DIETS, dietConflicts, fillEmptyTargets, findDiets } from '../../src/domain/diets';
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
