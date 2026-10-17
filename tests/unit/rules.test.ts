import { describe, expect, it } from 'vitest';
import { FOODS } from '../../src/data/foods';
import { examplePlan } from '../../src/data/seed.example';
import { activeMode, mealNutrients } from '../../src/domain/nutrition';
import { applySwaps, checkMeal, mealVerdict, type RuleContext } from '../../src/domain/rules';
import type { ConstraintTag, DayEntry, MealItem, Plan } from '../../src/domain/types';

const foods = new Map(FOODS.map((f) => [f.id, f]));
const TODAY = '2026-10-04';

function planWith(tags: ConstraintTag[], base = examplePlan(new Date(`${TODAY}T12:00:00`))): Plan {
  const all: ConstraintTag[] = ['oxalate', 'gallbladder', 'lactose', 'glycemic', 'iron', 'sodium'];
  return { ...base, constraints: all.map((tag) => ({ id: tag, tag, title: tag, reason: '', source: 'test', active: tags.includes(tag) })) };
}

function ctx(meal: MealItem[], tags: ConstraintTag[], extra: Partial<RuleContext> = {}): RuleContext {
  const plan = planWith(tags);
  const date = extra.date ?? TODAY;
  return { plan, activeMode: activeMode(plan, date)?.mode, dayEntries: [], date, meal, recentEntries: [], foods, ...extra };
}

const hitsOf = (c: RuleContext) => checkMeal(c).flatMap((x) => x.hits);
const meal = (at: string, items: MealItem[]): DayEntry => ({ id: at, at, kind: 'meal', status: 'done', title: 'Обід', items });

describe('dish check (SPEC §6, §11)', () => {
  it('oxalate: spinach salad gets «Замінити» with an oxalate reason and a swap to broccoli', () => {
    const c = ctx([{ name: 'Салат зі шпинатом', grams: 150 }], ['oxalate']);
    const hit = hitsOf(c).find((h) => h.verdict === 'replace')!;
    expect(hit.reason).toBe('oxalate');
    expect(hit.message).toContain('оксалат');
    expect(hit.suggestion).not.toMatch(/шпинат|буряк|щавел/i);
    expect(applySwaps(checkMeal(c), foods)).toEqual([{ foodId: 'broccoli', name: 'Броколі', grams: 150 }]);
  });

  it('a rule stays silent when its constraint is not active', () => {
    expect(hitsOf(ctx([{ name: 'Салат зі шпинатом', grams: 150 }], ['lactose']))).toEqual([]);
  });

  it('almonds only above 30 g', () => {
    expect(hitsOf(ctx([{ name: 'Мигдаль', grams: 20 }], ['oxalate'])).some((h) => h.verdict === 'replace')).toBe(false);
    expect(hitsOf(ctx([{ name: 'Мигдаль', grams: 40 }], ['oxalate'])).some((h) => h.verdict === 'replace')).toBe(true);
  });

  it('OGTT preparation does not cut carbs: mashed potatoes → slow carbs, same amount', () => {
    const date = '2026-10-08'; // inside the example mode (+3…+5 days)
    const c = ctx([{ name: 'Картопляне пюре', grams: 200, manual: { kcal: 180, protein: 4, fat: 6, carbs: 30 } }], ['glycemic'], { date });
    expect(c.activeMode?.targetsOverride.carbsG?.min).toBe(150);
    const hits = hitsOf(c);
    expect(hits.map((h) => h.verdict)).toEqual(['replace']);
    expect(hits.some((h) => /зменш|менше|прибрат/i.test(h.message + (h.suggestion ?? '')) && !/не зменшуючи/.test(h.message))).toBe(false);
    const swapped = applySwaps(checkMeal(c), foods);
    expect(swapped[0]?.foodId).toBe('buckwheat');
    expect(mealNutrients(swapped, foods).carbs).toBeCloseTo(30, 0);            // the same carbs, slower
  });

  it('outside the mode a sweet bun is «Прибрати»; inside it is replaced instead', () => {
    expect(hitsOf(ctx([{ name: 'Булка з маком', grams: 80 }], ['glycemic'])).map((h) => h.verdict)).toEqual(['remove']);
    expect(hitsOf(ctx([{ name: 'Булка з маком', grams: 80 }], ['glycemic'], { date: '2026-10-08' })).map((h) => h.verdict)).toEqual(['replace']);
    expect(hitsOf(ctx([{ name: 'Рис бурий (сухий)', grams: 60, foodId: 'brown-rice' }], ['glycemic']))).toEqual([]);
  });

  it('fried chicken with the gallbladder constraint → «Замінити», air fryer', () => {
    const c = ctx([{ foodId: 'chicken-breast', name: 'Куряче філе (сире)', grams: 150, cooking: 'fried' }], ['gallbladder']);
    const hit = hitsOf(c)[0]!;
    expect(hit.verdict).toBe('replace');
    expect(hit.suggestion).toMatch(/аерогриль/i);
    expect(applySwaps(checkMeal(c), foods)[0]?.cooking).toBe('airfryer');
  });

  it('calcium for oxalates: tomatoes without a calcium source get «Додайте кальцій у цей прийом»', () => {
    const c = ctx([{ foodId: 'tomato', name: 'Помідор', grams: 150 }, { foodId: 'egg', name: 'Яйце куряче', grams: 100 }], ['oxalate']);
    expect(hitsOf(c)).toEqual([expect.objectContaining({ verdict: 'adjust', message: 'Додайте кальцій у цей прийом' })]);
    const withCheese = ctx([...c.meal, { foodId: 'parmesan', name: 'Пармезан / Grana Padano', grams: 25 }], ['oxalate']);
    expect(hitsOf(withCheese)).toEqual([]);
  });

  it('liver more often than once a week → «adjust», «раз на тиждень»', () => {
    const recent = [meal('2026-10-01T13:00:00+03:00', [{ name: 'Печінка куряча', grams: 120 }])];
    const hits = hitsOf(ctx([{ name: 'Печінка куряча', grams: 100 }], ['iron'], { recentEntries: recent }));
    expect(hits).toEqual([expect.objectContaining({ verdict: 'adjust', reason: 'iron' })]);
    expect(hits[0]?.message).toContain('раз на тиждень');
    expect(hitsOf(ctx([{ name: 'Печінка куряча', grams: 100 }], ['iron']))).toEqual([]);   // first this week, ≤ 120 g
  });

  it('lactose: milk → kefir; kefir itself is fine', () => {
    const c = ctx([{ name: 'Молоко 2,5%', grams: 200 }], ['lactose']);
    expect(applySwaps(checkMeal(c), foods)[0]?.foodId).toBe('kefir');
    expect(hitsOf(ctx([{ foodId: 'kefir', name: 'Кефір 2,5 %', grams: 200 }], ['lactose']))).toEqual([]);
    expect(hitsOf(ctx([{ name: 'Кисломолочний напій', grams: 200 }], ['lactose']))).toEqual([]);
  });

  it('sodium: more than two 50 g portions a day', () => {
    const day = [meal('2026-10-04T09:00:00+03:00', [{ name: 'Ковбаса варена', grams: 80 }])];
    expect(hitsOf(ctx([{ name: 'Квашена капуста', grams: 50 }], ['sodium'], { dayEntries: day }))[0]?.message).toBe('Багато солі за день');
    expect(hitsOf(ctx([{ name: 'Квашена капуста', grams: 20 }], ['sodium'], { dayEntries: day }))).toEqual([]);
  });

  it('the whole meal: «Підходить частково», 2 з 3', () => {
    const c = ctx([
      { foodId: 'buckwheat', name: 'Гречка (суха)', grams: 60 },
      { name: 'Салат зі шпинатом', grams: 100 },
      { foodId: 'parmesan', name: 'Пармезан / Grana Padano', grams: 20 },
    ], ['oxalate']);
    expect(mealVerdict(checkMeal(c))).toEqual({ fits: false, okCount: 2, total: 3 });
  });
});

describe('«Записати заміну» with several hits on one item', () => {
  it('fried spinach becomes broccoli in the air fryer', () => {
    const c = ctx([{ name: 'Шпинат', grams: 150, cooking: 'fried' }], ['oxalate', 'gallbladder']);
    expect(applySwaps(checkMeal(c), foods)).toEqual([{ foodId: 'broccoli', name: 'Броколі', grams: 150, cooking: 'airfryer' }]);
  });
});

describe('glycemia and sugar (D81)', () => {
  const line = (id: string, grams = 250): MealItem => ({ foodId: id, name: foods.get(id)!.name, grams });
  it('«Чай з цукром» → «Доданий цукор», swapped for the same tea without it; «Чай без цукру» passes', () => {
    const c = ctx([line('tea-sugar')], ['glycemic']);
    expect(hitsOf(c)).toMatchObject([{ verdict: 'replace', message: 'Доданий цукор', suggestion: 'Без цукру' }]);
    expect(applySwaps(checkMeal(c), foods)).toMatchObject([{ foodId: 'tea', grams: 250 }]);
    expect(hitsOf(ctx([line('tea')], ['glycemic']))).toEqual([]);
    expect(hitsOf(ctx([line('coffee-milk')], ['glycemic']))).toEqual([]); // «(без цукру)» in its name
  });
  it('sweets by what the food is: a glazed curd, dried apricots, a free «кава з цукром»', () => {
    for (const id of ['glazed-curd', 'dried-apricots', 'compote', 'honey']) expect(hitsOf(ctx([line(id, 50)], ['glycemic']))[0]?.reason).toBe('glycemic');
    expect(hitsOf(ctx([{ name: 'Кава з цукром (кав’ярня)', grams: 200 }], ['glycemic']))[0]).toMatchObject({ verdict: 'remove', message: 'Доданий цукор' });
    expect(hitsOf(ctx([line('tea-sugar')], ['lactose']))).toEqual([]); // silent without the limit
  });
});
