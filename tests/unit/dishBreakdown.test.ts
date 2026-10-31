import { describe, expect, it } from 'vitest';
import { FOODS } from '../../src/data/foods';
import { breakdown, parseDishPortions, recipeItems, scaleDishPortions, type DishResult } from '../../src/domain/dishBreakdown';
import { mealNutrients } from '../../src/domain/nutrition';

const foods = new Map(FOODS.map((f) => [f.id, f]));
const R: DishResult = { readable: true, name: 'Лаваш-рол', portions: 2, note: '', items: [
  { said: 'тонкий вірменський лаваш', base: 'Лаваш', grams: 140, amountSaid: false, kcal: 275, protein: 9, fat: 1.2, carbs: 56 },
  { said: 'свиняча шия довгого томлення', base: '', grams: 200, amountSaid: false, kcal: 320, protein: 24, fat: 25, carbs: 0 },
  { said: 'грецький йогурт', base: 'йогурт грецький 2 %', grams: 80, amountSaid: true, kcal: 999, protein: 99, fat: 99, carbs: 99 }, // case aside
  { said: 'щось', base: 'Немає такого в базі', grams: 10, amountSaid: false, kcal: 2000, protein: -5, fat: 10, carbs: 10 }, // not in the base, numbers out of range
  { said: ' ', base: '', grams: 10, amountSaid: false, kcal: 0, protein: 0, fat: 0, carbs: 0 },
  { said: 'сіль', base: 'Сіль', grams: 0, amountSaid: false, kcal: 0, protein: 0, fat: 0, carbs: 0 },
] };

describe('a dish described in words → its ingredients (D110)', () => {
  const lines = breakdown(R, FOODS);
  it('a base food by its exact name — its own numbers, never the model’s; the rest an estimate, kept in range', () => {
    expect(lines.map((l) => [l.food?.name ?? l.said, !!l.per100])).toEqual([['Лаваш', false], ['Свиняча шия довгого томлення', true], ['Йогурт грецький 2 %', false], ['Щось', true]]);
    expect(lines[3]!.per100).toEqual({ kcal: 900, protein: 0, fat: 10, carbs: 10 });
    const yogurt = mealNutrients([{ foodId: lines[2]!.food!.id, name: '', grams: 80 }], foods);
    expect(yogurt.kcal).toBeCloseTo(80 * 0.73, 0); // the base's 73 kcal / 100 g, not the model's 999
  });
  it('saved for one portion: the grams and the estimates halve for two portions', () => {
    const items = recipeItems(lines, 2);
    expect(items.map((i) => i.grams)).toEqual([70, 100, 40, 5]);
    expect(items[1]!.manual!.kcal).toBeCloseTo(320, 0); // 100 g of the estimate at 320 / 100 g
    expect(items[0]).toMatchObject({ foodId: expect.any(String), name: 'Лаваш' });
  });
});

describe('the plan’s check sees what an estimated ingredient is (D111)', async () => {
  const { checkMeal } = await import('../../src/domain/rules');
  const { emptyPlan } = await import('../../src/data/seed.example');
  const plan = (tag: string, allergens?: string[]) => ({ ...emptyPlan(), constraints: [{ id: 'c', tag, title: tag, reason: '', source: '', active: true, ...(allergens ? { allergens } : {}) }] }) as never;
  const line = (tags: string[], allergens: string[] = []) => breakdown({ ...R, items: [{ said: 'сир сулугуні', base: '', grams: 40, amountSaid: false, kcal: 290, protein: 20, fat: 23, carbs: 0.5, tags, allergens }] }, FOODS);
  const say = (p: never, tags: string[], allergens: string[] = []) => checkMeal({ plan: p, date: '2026-10-20', foods, dayEntries: [], recentEntries: [], meal: line(tags, allergens).map((l) => ({ name: l.said, grams: l.grams, ...(l.est ? { est: l.est } : {}) })) })[0]!.hits.map((h) => h.message);
  it('lactose, salt, fat — by the model’s marks, unknown words dropped', () => {
    expect(line(['lactose', 'salty', 'nonsense'])[0]!.est).toEqual({ tags: ['lactose', 'salty'], allergens: [] });
    expect(say(plan('lactose'), ['lactose', 'salty'])).toEqual(['Лактоза']);
    expect(say(plan('lactose'), ['cheese-aged'])).toEqual([]);
    expect(say(plan('gallbladder'), ['fatty'])).toEqual(['Жирне навантажує жовчний']);
    expect(say(plan('glycemic'), ['fast-carb'])).toEqual(['Швидкі вуглеводи']);
  });
  it('an allergen the estimate names removes the line; naming none never clears it', () => {
    expect(say(plan('allergy', ['milk']), ['lactose'], ['milk'])).toEqual(['Алергія: молоко (за оцінкою ІІ)']);
    expect(say(plan('allergy', ['nuts']), ['lactose'], ['milk'])).toEqual(['Склад оцінено ІІ — перевірте на алергени']);
  });
});


describe('dish portion editor regression (iPhone)', () => {
  it('allows a temporary blank draft and accepts a new number after deleting 2', () => {
    expect(parseDishPortions('')).toBeNull();
    expect(parseDishPortions('0')).toBeNull();
    expect(parseDishPortions('12')).toBe(12);
    expect(parseDishPortions('1')).toBe(1);
    expect(parseDishPortions('1.5')).toBeNull();
    expect(parseDishPortions('1000')).toBeNull();
  });
  it('rescales ingredients and nutritional totals 2 → 1 → 2 without drift', () => {
    const original = breakdown({ ...R, items: [
      { said: 'томлена свинина', base: '', grams: 275, amountSaid: true, kcal: 260, protein: 26, fat: 17, carbs: 0 },
      { said: 'рис варений', base: '', grams: 375, amountSaid: true, kcal: 130, protein: 3, fat: 0.3, carbs: 28 },
    ] }, FOODS);
    const one = scaleDishPortions(original, 2, 1);
    expect(one.map((line) => line.grams)).toEqual([137.5, 187.5]);
    expect(recipeItems(one, 1).map((line) => line.grams)).toEqual([137.5, 187.5]);
    expect(scaleDishPortions(one, 1, 2)).toEqual(original);
    const kcal = (lines: typeof original) => lines.reduce((sum, line) => sum + line.per100!.kcal * line.grams / 100, 0);
    expect(kcal(one)).toBeCloseTo(kcal(original) / 2, 5);
  });
});
