import { describe, expect, it } from 'vitest';
import { FOODS } from '../../src/data/foods';
import { breakdown, recipeItems, type DishResult } from '../../src/domain/dishBreakdown';
import { dishName, exportDishList, readDishList } from '../../src/domain/dishTransfer';
import { mealNutrients } from '../../src/domain/nutrition';
import type { Recipe } from '../../src/domain/types';

const row: DishResult = { readable: true, name: 'Омлет', portions: 2, note: '', items: [
  { said: 'Яєчний білок', base: '', grams: 100, amountSaid: true, kcal: 50, protein: 11, fat: 0, carbs: 1, tags: [], allergens: ['egg'] },
] };
const foods = new Map(FOODS.map((f) => [f.id, f]));
describe('portable dishes', () => {
  it('exports without ids and restores nutrients, calcium and allergen marks even when a custom food is absent', () => {
    const custom = { id: 'private-id', name: 'Безлактозний йогурт', per100g: { kcal: 60, protein: 4, fat: 2, carbs: 5, calciumMg: 120 }, tags: ['calcium'], allergens: ['milk' as const] };
    const map = new Map([...foods, [custom.id, custom]]);
    const recipes: Recipe[] = [{ id: 'old-recipe', name: 'Йогурт з білком', items: [
      { foodId: custom.id, name: custom.name, grams: 150 }, ...recipeItems(breakdown(row, FOODS), 2),
    ] }];
    const json = exportDishList(recipes, map);
    expect(json).not.toContain('private-id'); expect(json).not.toContain('old-recipe');
    const decoded = readDishList(JSON.parse(json))[0]!;
    const items = recipeItems(breakdown(decoded, FOODS), decoded.portions);
    expect(mealNutrients(items, foods)).toEqual(mealNutrients(recipes[0]!.items, map));
    expect(items[0]!.est).toEqual({ tags: ['calcium'], allergens: ['milk'] });
    expect(items[1]!.est?.allergens).toEqual(['egg']);
  });
  it('rejects a whole list with an invalid entry, nonfinite or out of range numbers; strips database flags', () => {
    for (const bad of [null, { ...row, portions: 0 }, { ...row, items: [] }, { ...row, items: [{ ...row.items[0], grams: Infinity }] }, { ...row, items: [{ ...row.items[0], protein: 101 }] }]) {
      expect(() => readDishList([row, bad])).toThrow();
    }
    expect(readDishList([{ ...row, id: 'foreign', builtIn: true }])[0]).not.toHaveProperty('id');
    expect(readDishList([{ ...row, id: 'foreign', builtIn: true }])[0]).not.toHaveProperty('builtIn');
    expect(() => readDishList({ format: 'protocol-dishes', version: 2, dishes: [row] })).toThrow();
  });
  it('supports a large JSON list and detects equivalent names', () => {
    expect(readDishList(Array.from({ length: 30 }, () => row))).toHaveLength(30);
    expect(dishName('  ОМЛЕТ ')).toBe(dishName('омлет'));
  });
});
