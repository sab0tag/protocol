import { describe, expect, it } from 'vitest';
import { FOODS } from '../../src/data/foods';
import { RECIPES } from '../../src/data/recipes';
import { examplePlan } from '../../src/data/seed.example';
import { asksTopup, brings, dayContext, fixedAnswer, lineOf, passing } from '../../src/domain/assistant';
import { dishItem } from '../../src/domain/recipes';

const plan = examplePlan(new Date('2026-10-24T12:00:00')); // lactose, glycemia, oxalate; Вітамін D
const foods = new Map(FOODS.map((f) => [f.id, f]));

describe('the assistant around the model (D117)', () => {
  it('«що добрати?» is the code’s question; «у мене вдома лише…» goes to the model', () => {
    for (const q of ['Що добрати до вечора?', 'чим добрати білок', 'що ще з’їсти', 'недобираю калорії']) expect(asksTopup(q), q).toBe(true);
    for (const q of ['у мене вдома лише яйця і гречка, що добрати?', 'чи можна мені банан?', 'що приготувати з курки']) expect(asksTopup(q), q).toBe(false);
  });
  it('medicines, symptoms, changing the plan — the app’s own words; medicines quote the plan', () => {
    expect(fixedAnswer('medicine', plan)).toMatch(/запитайте лікаря або фармацевта.*Вітамін D 2000 МО/);
    expect(fixedAnswer('symptoms', plan)).toMatch(/скаже лікар.*103/);
    expect(fixedAnswer('plan', plan)).toMatch(/змінює лікар/);
    expect(fixedAnswer('food', plan)).toBeUndefined();
  });
  it('a name becomes a line of the base; what fails the plan is not shown; the numbers are the code’s', () => {
    const lines = [lineOf('Яйце варене', 110, FOODS, RECIPES, dishItem)!, lineOf('Молоко 2,5 %', 200, FOODS, RECIPES, dishItem)!, lineOf('Гречка з куркою', 300, FOODS, RECIPES, dishItem)!];
    expect(lineOf('Протеїновий батончик', 60, FOODS, RECIPES, dishItem)).toBeUndefined();
    expect(lines[0]).toMatchObject({ name: 'Яйце варене', grams: 110, unit: { name: 'шт', qty: 2 } });
    const { shown, dropped } = passing(lines, plan, '2026-10-24', foods);
    expect(dropped).toEqual(['Молоко 2,5 %']); // lactose — never offered
    expect(shown.map((x) => x.name)).toEqual(['Яйце варене', 'Гречка з куркою']);
    expect(brings(shown[0]!, foods).protein).toBe(Math.round(12.6 * 1.1));
  });
  it('the model is told the day’s numbers and the plan’s rules — never a medicine', () => {
    const c = dayContext(plan, plan.targets, { kcal: 900.4, protein: 60, fat: 30, carbs: 100, calciumMg: 400, waterMl: 500 }, '18:40', ['Яйце варене']);
    expect(c.day).toMatchObject({ kcal: 900, proteinG: 60 });
    expect(c.targets).toMatchObject({ kcal: 2100, proteinG: 140 });
    expect(JSON.stringify(c)).not.toContain('Вітамін D');
    expect(c.rules.join(' ')).toContain('лактози');
  });
});
