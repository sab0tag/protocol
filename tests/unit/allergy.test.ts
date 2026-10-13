import { describe, expect, it } from 'vitest';
import { FOODS } from '../../src/data/foods';
import { examplePlan } from '../../src/data/seed.example';
import { draftFrom } from '../../src/domain/menu';
import { dishItem } from '../../src/domain/recipes';
import { checkMeal } from '../../src/domain/rules';
import type { Food, MealItem, Plan } from '../../src/domain/types';

const DATE = '2026-10-13';
const base = examplePlan(new Date(`${DATE}T12:00:00`));
const plan: Plan = { ...base, constraints: [...base.constraints,
  { id: 'a', tag: 'allergy', title: 'Алергія: горіхи', reason: '', source: 'Алерголог, 2026', active: true, allergens: ['nuts'] }] };
const own = (id: string, allergens?: Food['allergens']): Food => ({ id, name: id, custom: true, tags: [], per100g: { kcal: 100, protein: 1, fat: 1, carbs: 1 },
  ...(allergens ? { allergens } : {}) });
const foods = new Map([...FOODS, own('u-checked', []), own('u-never')].map((f) => [f.id, f]));
const check = (meal: MealItem[], p: Plan = plan) => checkMeal({ plan: p, date: DATE, dayEntries: [], meal, recentEntries: [], foods })
  .map((c) => c.hits.filter((h) => h.reason === 'allergy').map((h) => [h.verdict, h.message]));

describe('a confirmed allergy (D58)', () => {
  it('a line that holds it goes; a dish is checked by its ingredients', () => {
    const bowl = dishItem({ id: 'b', name: 'Вівсянка з горіхами', items: [{ foodId: 'oatmeal-water', name: 'Вівсянка на воді', grams: 250 },
      { foodId: 'walnut', name: 'Волоські горіхи', grams: 20 }] }, 1);
    expect(check([{ foodId: 'walnut', name: 'Волоські горіхи', grams: 20 }, { foodId: 'kefir', name: 'Кефір 2,5 %', grams: 250 }, bowl]))
      .toEqual([[['remove', 'Алергія: горіхи']], [], [['remove', 'Алергія: горіхи']]]);
  });

  it('unknown make-up is flagged, never passed as safe; an own food checked as «none» passes', () => {
    expect(check([{ name: 'Торт', grams: 100, manual: { kcal: 300, protein: 4, fat: 15, carbs: 40 } },
      { foodId: 'u-never', name: 'u-never', grams: 50 }, { foodId: 'u-checked', name: 'u-checked', grams: 50 }]))
      .toEqual([[['adjust', 'Склад невідомий — перевірте на алергени']], [['adjust', 'Склад невідомий — перевірте на алергени']], []]);
  });

  it('nothing is said without an active allergy', () => {
    expect(check([{ foodId: 'walnut', name: 'Волоські горіхи', grams: 20 }], base)).toEqual([[]]);
  });

  it('a menu proposal holding it loses the line, and says «прибрано»', () => {
    const d = draftFrom({ tips: [], meals: [{ title: 'Сніданок', time: '08:00', items: [
      { name: 'Вівсянка на воді', grams: 250, count: null }, { name: 'Волоські горіхи', grams: 20, count: null }] }] },
    { plan, date: DATE, foods, recipes: [], recentEntries: [], dishItem, scale: false });
    expect(d.meals[0]!.items.map((i) => i.name)).toEqual(['Вівсянка на воді']);
    expect(d.meals[0]!.notes).toContain('Волоські горіхи: Алергія: горіхи — прибрано');
  });
});
