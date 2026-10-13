import { describe, expect, it } from 'vitest';
import { BASE_ALLERGENS } from '../../src/data/allergens';
import { FOODS } from '../../src/data/foods';
import { RECIPES } from '../../src/data/recipes';
import { itemAllergens, mealAllergens } from '../../src/domain/allergens';
import { dishItem } from '../../src/domain/recipes';

const foods = new Map(FOODS.map((f) => [f.id, f]));

describe('allergens (D57)', () => {
  it('every mapped id is a real food', () => {
    expect(Object.keys(BASE_ALLERGENS).filter((id) => !foods.has(id))).toEqual([]);
  });

  it('a food has its own; lactose-free milk still has milk protein; a dish has its ingredients\'', () => {
    expect(foods.get('lactose-free-milk')?.allergens).toEqual(['milk']);
    expect(foods.get('buckwheat')?.allergens).toBeUndefined();
    const bowl = dishItem(RECIPES.find((r) => r.id === 'dish-yogurt-bowl')!, 1);
    expect(itemAllergens(bowl, foods)).toEqual({ allergens: ['gluten', 'milk', 'nuts'], unknown: false });
  });

  it('a free line is unknown, not «none»', () => {
    expect(itemAllergens({ name: 'Торт від сусідки', grams: 100, manual: { kcal: 300, protein: 4, fat: 15, carbs: 40 } }, foods))
      .toEqual({ allergens: [], unknown: true });
    expect(mealAllergens([{ foodId: 'egg', name: 'Яйце', grams: 50 }, { foodId: 'kefir', name: 'Кефір', grams: 250 }], foods)).toEqual(['milk', 'egg']);
  });
});
