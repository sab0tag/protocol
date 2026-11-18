import { describe, expect, it } from 'vitest';
import { FOODS } from '../../src/data/foods';
import { RECIPES } from '../../src/data/recipes';
import { dayFluid, liquidShare, litres, waterState, withWater } from '../../src/domain/fluid';
import { dishItem } from '../../src/domain/recipes';
import { draftLines } from '../../src/domain/conclusion';
import type { DayEntry, Food } from '../../src/domain/types';

// D169 («Очередь агента» 18.11, task 3): water in litres; the doctor's norm and the doctor's limit; drinks count.
const foods = new Map<string, Food>(FOODS.map((f) => [f.id, f]));
const water = (id: string, ml: number, at = '2026-11-18T09:00:00+02:00'): DayEntry => ({ id, at, kind: 'water', status: 'done', title: 'Вода', waterMl: ml });
const meal = (id: string, items: DayEntry['items'], at = '2026-11-18T13:00:00+02:00'): DayEntry => ({ id, at, kind: 'meal', status: 'done', title: 'Обід', items });

describe('fluid of the day', () => {
  it('water, drinks and the liquid of soups — a dish counts what is in it', () => {
    const borscht = dishItem(RECIPES.find((r) => r.id === 'dish-borscht')!);
    const day = [water('w1', 250), water('w2', 350), meal('m1', [{ foodId: 'tea', name: 'Чай без цукру', grams: 250 }, borscht, { foodId: 'bread-rye', name: 'Хліб', grams: 40 }]),
      { ...water('planned', 500), status: 'planned' } as DayEntry];
    const f = dayFluid(day, foods, '2026-11-18');
    expect(f.waterMl).toBe(600);
    expect(f.drinksMl).toBe(250 + 150); // tea and the borscht's broth; bread is not liquid
    expect(f.drinks).toEqual(['чай', 'борщ']);
    expect(f.totalMl).toBe(1000);
  });

  it('milk and kefir are drunk; a soup without a share of its own is four fifths liquid; solid food is not', () => {
    expect(liquidShare(foods.get('kefir'))).toBe(1);
    expect(liquidShare(foods.get('coffee'))).toBe(1);
    expect(liquidShare(foods.get('soup-veg'))).toBe(0.8);
    expect(liquidShare(foods.get('oatmeal-water'))).toBe(0);
    expect(liquidShare({ id: 'own', name: 'Мій смузі', per100g: { kcal: 50, protein: 1, fat: 0, carbs: 10 }, tags: ['drink'], custom: true })).toBe(1); // «Це напій»
  });
});

describe('norm and limit', () => {
  const f = (ml: number) => ({ waterMl: ml, drinksMl: 0, drinks: [], totalMl: ml });
  it('a norm: «1,0 з 2,5 л», then met and over — never a bar past full', () => {
    expect(waterState(f(1000), { waterMl: 2500 })).toEqual({ kind: 'norm', totalMl: 1000, normMl: 2500, met: false, overMl: 0 });
    expect(waterState(f(3000), { waterMl: 2500 })).toMatchObject({ met: true, overMl: 500 });
  });
  it('a limit wins over a norm: left to the limit, and how far over', () => {
    expect(waterState(f(1200), { waterMl: 2000, waterMaxMl: 1500 })).toEqual({ kind: 'limit', totalMl: 1200, maxMl: 1500, leftMl: 300, overMl: 0 });
    expect(waterState(withWater(f(1500), 200), { waterMaxMl: 1500 })).toMatchObject({ leftMl: 0, overMl: 200 });
  });
  it('without either — litres today', () => {
    expect(waterState(f(1250), {})).toEqual({ kind: 'free', totalMl: 1250 });
    expect([litres(1000), litres(1250), litres(2500), litres(0)]).toEqual(['1,0', '1,25', '2,5', '0']);
  });
});

describe('the paper', () => {
  it('«обмеження рідини до 1,5 л» is a limit, «пити 2 л» a norm', () => {
    const where = { page: 1, box: [0, 0, 1, 0.1], sure: 'yes' as const };
    let n = 0;
    const lines = draftLines({ readable: true, date: null, doctor: null, constraints: [], prescriptions: [], tests: [], nextVisit: null, unread: [],
      targets: [{ key: 'waterMaxMl', value: '1,5 л', ...where }, { key: 'waterMl', value: '2000', ...where }] } as unknown as Parameters<typeof draftLines>[0], () => `id${n++}`);
    expect(lines.filter((l) => l.kind === 'target').map((l) => l.kind === 'target' && [l.target, l.value])).toEqual([['waterMaxMl', 1500], ['waterMl', 2000]]);
  });
});
