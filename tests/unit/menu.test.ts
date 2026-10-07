import { describe, expect, it } from 'vitest';
import { FOODS } from '../../src/data/foods';
import { RECIPES } from '../../src/data/recipes';
import { examplePlan } from '../../src/data/seed.example';
import { acceptPlan, draftFrom, draftTotals, menuRequest, scaleLine, type MenuResult } from '../../src/domain/menu';
import { dishItem } from '../../src/domain/recipes';
import type { DayEntry } from '../../src/domain/types';

const foods = new Map(FOODS.map((f) => [f.id, f]));
const plan = examplePlan(new Date('2026-10-01T12:00:00'));
const ctx = { plan, date: '2026-10-08', foods, recipes: RECIPES, recentEntries: [] as DayEntry[], dishItem };
const meal = (title: string, time: string, items: MenuResult['meals'][number]['items']) => ({ title, time, items });

describe('menu request', () => {
  it('sends the day\'s numbers and the active limits in words; the mode overrides', () => {
    const r = menuRequest(plan, '2026-10-08');
    expect(r.targets).toMatchObject({ kcal: 2100, proteinG: 140, carbsMaxG: 190, lastMealBy: '20:00' });
    expect(r.rules).toContain('Оксалатні камені: Без шпинату й буряка. Кальцій — у той самий прийом.');
    const ogtt = menuRequest(plan, '2026-10-04'); // the example's mode: days 3–5 from 1 Oct
    expect(ogtt.targets).toMatchObject({ carbsMinG: 150 });
    expect(ogtt.targets.carbsMaxG).toBeUndefined();
    expect(ogtt.rules.some((x) => x.includes('Не менше 150 г вуглеводів'))).toBe(true);
  });
});

describe('draft', () => {
  it('counts from the base: pieces, grams, a dish by portions; unknown names are dropped', () => {
    const d = draftFrom({ tips: [' Зваріть яйця звечора ', ''], meals: [
      meal('Сніданок', '08:00', [{ name: 'Яйце варене', grams: 100, count: 2 }, { name: 'Кефір 2,5 %', grams: 250, count: null }, { name: 'Піца', grams: 300, count: null }]),
      meal('Обід', '13:30', [{ name: 'Гречка з куркою', grams: 700, count: null }]),
    ] }, { ...ctx, plan: { ...plan, targets: {} } });
    expect(d.meals[0]!.items.map((i) => i.name)).toEqual(['Яйце варене', 'Кефір 2,5 %']);
    expect(d.meals[0]!.items[0]!.unit).toMatchObject({ name: 'шт', qty: 2 });
    expect(d.meals[1]!.items[0]!.recipe?.id).toBe('dish-buckwheat-chicken');
    expect(d.tips).toEqual(['Зваріть яйця звечора']);
  });

  it('runs the dish check: beet in a vinegret is swapped inside the dish and said so', () => {
    const d = draftFrom({ tips: [], meals: [meal('Обід', '13:00', [{ name: 'Вінегрет', grams: 250, count: null }])] }, ctx);
    const parts = d.meals[0]!.items[0]!.components!.map((c) => c.name);
    expect(parts.some((n) => /буряк/i.test(n))).toBe(false);
    expect(d.meals[0]!.notes.join(' ')).toMatch(/замінено/);
  });

  it('no meal after «останній прийом до»; meals in time order', () => {
    const d = draftFrom({ tips: [], meals: [
      meal('Вечеря', '21:30', [{ name: 'Кефір 2,5 %', grams: 250, count: null }]),
      meal('Сніданок', '08:00', [{ name: 'Яйце варене', grams: 100, count: 2 }]),
    ] }, ctx);
    expect(d.meals.map((m) => m.time)).toEqual(['08:00', '20:00']);
  });

  it('portions follow the calorie target, at most a quarter either way', () => {
    const small = { tips: [], meals: [meal('Обід', '13:00', [{ name: 'Гречка варена', grams: 400, count: null }])] };
    const d = draftFrom(small, ctx); // 440 kcal vs 2100 → ×1.25
    expect(d.meals[0]!.items[0]!.grams).toBe(500);
    expect(draftTotals(d.meals, foods).kcal).toBeCloseTo(550);
    expect(scaleLine({ name: 'x', grams: 100, unit: { name: 'шт', qty: 2, grams: 50 } }, 1.2)).toMatchObject({ grams: 100, unit: { qty: 2 } });
  });
});

describe('accept', () => {
  it('planned meals with the tips on the first; an earlier untouched menu is replaced, ticked ones stay', () => {
    const d = draftFrom({ tips: ['Вода — пляшка з собою'], meals: [meal('Сніданок', '08:00', [{ name: 'Яйце варене', grams: 100, count: 2 }])] }, ctx);
    const existing: DayEntry[] = [
      { id: 'old', at: '2026-10-08T13:00:00', kind: 'meal', status: 'planned', title: 'Обід', items: [], menu: {} },
      { id: 'done', at: '2026-10-08T08:00:00', kind: 'meal', status: 'done', title: 'Сніданок', items: [], menu: {} },
      { id: 'mine', at: '2026-10-08T16:00:00', kind: 'meal', status: 'planned', title: 'Перекус', items: [] },
    ];
    let n = 0;
    const r = acceptPlan(d, existing, () => `n${++n}`, (date, t) => `${date}T${t}:00+03:00`);
    expect(r.remove).toEqual(['old']);
    expect(r.add[0]).toMatchObject({ id: 'n1', at: '2026-10-08T08:00:00+03:00', status: 'planned', menu: { tips: ['Вода — пляшка з собою'] } });
  });
});
