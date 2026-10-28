import { expect, it } from 'vitest';
import { foodPlanStatus } from '../../src/domain/foodPlanStatus';
import { emptyPlan } from '../../src/data/seed.example';
import type { Food } from '../../src/domain/types';
const food: Food = { id: 'known', name: 'Synthetic milk', per100g: { kcal: 50, protein: 3, fat: 2, carbs: 5 }, tags: [], allergens: ['milk'] };
const foods = new Map([['known', food]]);
const plan = { ...emptyPlan(), constraints: [{ id: 'allergy', tag: 'allergy' as const, title: 'Milk', reason: '', source: 'Synthetic', active: true, allergens: ['milk' as const] }] };
it('reports a known configured allergen with source reasons, but keeps estimated composition uncertain', () => {
  const item = { name: food.name, foodId: 'known', grams: 100 };
  expect(foodPlanStatus([{ item, hits: [] }], foods, plan).state).toBe('allergen');
  expect(foodPlanStatus([{ item: { name: 'Unknown recipe', grams: 100 }, hits: [] }], foods, plan).state).toBe('incomplete');
  expect(foodPlanStatus([{ item: { ...item, est: { tags: [], allergens: ['milk'] } }, hits: [] }], foods, plan).state).toBe('incomplete');
});
it('no known conflicts is limited to the known composition and does not mutate the plan', () => {
  const original = structuredClone(plan);
  const item = { name: 'Known food', foodId: 'known', grams: 100 };
  expect(foodPlanStatus([{ item, hits: [] }], new Map([['known', { ...food, allergens: [] }]]), plan).state).toBe('clear');
  expect(plan).toEqual(original);
});
it('keeps the existing restriction reason and does not replace it with a generic green state', () => {
  const item = { name: 'Known food', foodId: 'known', grams: 100 };
  const hit = { itemName: item.name, verdict: 'adjust' as const, reason: 'sodium' as const, message: 'Synthetic existing restriction reason' };
  const result = foodPlanStatus([{ item, hits: [hit] }], new Map([['known', { ...food, allergens: [] }]]), plan);
  expect(result.state).toBe('attention'); expect(result.reasons).toEqual([hit.message]);
});
it('reports a confirmed allergen inside a recipe even when another ingredient is unknown', () => {
  const recipe = { name: 'Synthetic recipe', grams: 200, components: [{ foodId: 'known', name: food.name, grams: 100 }, { name: 'Unknown ingredient', grams: 100 }] };
  expect(foodPlanStatus([{ item: recipe, hits: [] }], foods, plan).state).toBe('allergen');
});

it('keeps an estimated parent recipe uncertain even when its descendants match known foods', () => {
  const ingredient = { foodId: 'known', name: food.name, grams: 100 };
  const recipe = { name: 'Estimated dish', grams: 100, est: { tags: [], allergens: [] }, components: [ingredient] };
  const result = foodPlanStatus([{ item: recipe, hits: [] }], foods, plan);
  expect(result.state).toBe('incomplete'); expect(result.allergens).toEqual([]);
  const safeFoods = new Map([['known', { ...food, allergens: [] }]]);
  expect(foodPlanStatus([{ item: recipe, hits: [] }], safeFoods, plan).state).toBe('incomplete');
  const nested = { name: 'Outer recipe', grams: 100, components: [recipe] };
  expect(foodPlanStatus([{ item: nested, hits: [] }], safeFoods, plan).state).toBe('incomplete');
});
