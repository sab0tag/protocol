import { describe, expect, it } from 'vitest';
import { exportAll, importAll, parseExport } from '../../src/data/backup';
import { ensureSeeded, ProtocolDB } from '../../src/data/db';
import { FOODS } from '../../src/data/foods';
import { RECIPES } from '../../src/data/recipes';
import { examplePlan } from '../../src/data/seed.example';
import { lineNutrients, mealNutrients } from '../../src/domain/nutrition';
import { dishItem, recipeFrom, setPortions, withComponents } from '../../src/domain/recipes';
import { applySwaps, checkMeal, mealVerdict } from '../../src/domain/rules';
import type { ConstraintTag, MealItem } from '../../src/domain/types';

const foods = new Map(FOODS.map((f) => [f.id, f]));
const recipe = (id: string) => RECIPES.find((r) => r.id === id)!;
const plan = (tags: ConstraintTag[]) => ({ ...examplePlan(new Date('2026-10-04T12:00:00')),
  constraints: tags.map((tag) => ({ id: tag, tag, title: tag, reason: '', source: 't', active: true })) });
const check = (meal: MealItem[], tags: ConstraintTag[]) =>
  checkMeal({ plan: plan(tags), dayEntries: [], date: '2026-10-04', meal, recentEntries: [], foods });

describe('dishes (D27)', () => {
  it('a salad is one line: its weight and nutrients are its ingredients, dressing included', () => {
    const salad = dishItem(recipe('dish-salad-veg'));
    expect(salad.name).toBe('Салат овочевий з олією');
    expect(salad.components?.map((c) => c.name)).toEqual(expect.arrayContaining(['Олія оливкова', 'Бальзамічний оцет', 'Сіль']));
    expect(salad.grams).toBe(salad.components!.reduce((g, c) => g + c.grams, 0));
    const n = lineNutrients(salad, foods);
    expect(n.fat).toBeCloseTo(10 * 1 + 0.1 * 1.2 + 0.2 * 1.2 + 0.3 * 0.6 + 0.1 * 0.2 + 0.7 * 0.04, 1); // the oil is the fat
    expect(mealNutrients([salad], foods).kcal).toBeCloseTo(n.kcal);
  });

  it('portions scale every ingredient, household measures too', () => {
    const two = setPortions(dishItem(recipe('dish-omelet')), 2);
    expect(two.components?.find((c) => c.foodId === 'egg')).toMatchObject({ grams: 200, unit: { qty: 4 } });
    expect(two.recipe).toEqual({ id: 'dish-omelet', portions: 2 });
  });

  it('the plan checks what is inside: beet in a vinegret → «Замінити», swapped inside the dish', () => {
    const vinegret = dishItem(recipe('dish-vinegret'));
    const checks = check([vinegret], ['oxalate']);
    expect(checks[0]?.hits.map((h) => [h.itemName, h.verdict])).toEqual(expect.arrayContaining([['Буряк', 'replace']]));
    expect(mealVerdict(checks).fits).toBe(false);
    const swapped = applySwaps(checks, foods)[0]!;
    expect(swapped.name).toBe('Вінегрет');
    expect(swapped.components?.some((c) => c.foodId === 'beet')).toBe(false);
    expect(swapped.components?.some((c) => c.foodId === 'broccoli')).toBe(true);
  });

  it('lemon juice in a dressing is not «Швидкі вуглеводи»; salad with balsamic passes glycemic', () => {
    expect(check([dishItem(recipe('dish-salad-cabbage'))], ['glycemic'])[0]?.hits).toEqual([]);
    expect(check([dishItem(recipe('dish-salad-veg'))], ['glycemic', 'lactose', 'gallbladder'])[0]?.hits).toEqual([]);
  });

  it('editing the ingredients of a dish in a meal keeps its weight in step', () => {
    const salad = dishItem(recipe('dish-salad-veg'));
    const lighter = withComponents(salad, salad.components!.filter((c) => c.foodId !== 'olive-oil'));
    expect(lighter.grams).toBe(salad.grams - 10);
  });

  it('«Зберегти як мою страву» makes one portion from the meal (dishes opened up)', () => {
    const meal = [setPortions(dishItem(recipe('dish-buckwheat-chicken')), 2), { foodId: 'tomato', name: 'Помідор', grams: 120 }];
    const r = recipeFrom(' Мій обід ', meal, 'my-1');
    expect(r.name).toBe('Мій обід');
    expect(r.items.map((i) => [i.foodId, i.grams])).toEqual([['buckwheat-boiled', 200], ['chicken-breast-cooked', 120], ['tomato', 120]]);
  });

  it('built-in dishes are seeded; the user’s own survive a backup round trip', async () => {
    const a = new ProtocolDB('dishes-a');
    await ensureSeeded(a);
    expect(await a.recipes.count()).toBe(RECIPES.length);
    await a.recipes.put(recipeFrom('Мій салат', [{ foodId: 'cucumber', name: 'Огірок', grams: 200 }], 'my-salad'));
    const b = new ProtocolDB('dishes-b');
    await importAll(parseExport(JSON.stringify(await exportAll(a))), b);
    expect(await b.recipes.get('my-salad')).toMatchObject({ name: 'Мій салат' });
    a.close(); b.close();
  });
});
