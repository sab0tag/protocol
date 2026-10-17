import { describe, expect, it } from 'vitest';
import { ensureSeeded, ProtocolDB } from '../../src/data/db';
import { FOODS } from '../../src/data/foods';
import { amountText, itemFor, parseQuery, recognize, searchFoods } from '../../src/domain/foodSearch';
import { itemNutrients } from '../../src/domain/nutrition';

const byId = new Map(FOODS.map((f) => [f.id, f]));
const find = (q: string) => { const p = parseQuery(q); const food = searchFoods(FOODS, p.text)[0]; return { p, food, item: food && itemFor(food, p) }; };

describe('food search and household measures (D26)', () => {
  it('«2 варених яйця» → boiled egg, 2 шт ≈ 100 г, nutrients counted', () => {
    const { p, food, item } = find('2 варених яйця');
    expect(p).toEqual({ text: 'варених яйця', qty: 2 });
    expect(food?.id).toBe('egg-boiled');
    expect(item).toEqual({ foodId: 'egg-boiled', name: 'Яйце варене', grams: 100, unit: { name: 'шт', qty: 2, grams: 50 } });
    expect(itemNutrients(item!, food).protein).toBeCloseTo(12.6);
    expect(amountText(item!)).toBe('2 шт');
  });

  it('«відварне яйце» and «яйця» find eggs too', () => {
    expect(find('відварне яйце').food?.id).toBe('egg-boiled');
    expect(searchFoods(FOODS, 'яйця').map((f) => f.id)).toEqual(expect.arrayContaining(['egg', 'egg-boiled']));
  });

  it('grams, glasses, spoons, slices', () => {
    expect(find('150 г гречка варена').item).toMatchObject({ foodId: 'buckwheat-boiled', grams: 150 });
    expect(find('150 гречка варена').item).toMatchObject({ grams: 150 });                       // a big number = grams
    expect(find('склянка кефіру').item).toMatchObject({ grams: 250, unit: { name: 'склянка', qty: 1 } });
    expect(find('2 ст. л. сметани').item).toMatchObject({ foodId: 'sour-cream', grams: 50 });
    expect(find('ложка меду').item).toMatchObject({ foodId: 'honey', grams: 35 });
    expect(find('2 скибки житнього хліба').item).toMatchObject({ foodId: 'bread-rye', grams: 60 });
    expect(find('пів авокадо').item).toMatchObject({ foodId: 'avocado', grams: 70 });
    expect(find('1,5 банана').item).toMatchObject({ grams: 180, unit: { qty: 1.5 } });
  });

  it('nothing said about the amount: one household measure, or 100 g when the food has none', () => {
    expect(itemFor(byId.get('apple')!, {})).toMatchObject({ grams: 180, unit: { name: 'шт', qty: 1 } });
    expect(itemFor({ ...byId.get('apple')!, units: undefined }, {})).toEqual({ foodId: 'apple', name: 'Яблуко', grams: 100 });
  });

  it('the base is refreshed for an existing device that has the old 15 foods', async () => {
    const db = new ProtocolDB('foods-upgrade');
    await db.foods.bulkPut(FOODS.slice(0, 15).map((f) => ({ ...f, units: undefined })));
    await ensureSeeded(db);
    expect(await db.foods.count()).toBe(FOODS.length);
    expect((await db.foods.get('egg'))?.units?.[0]).toEqual({ name: 'шт', grams: 50 });
    db.close();
  });

  it('every food is sane: ids unique, nutrients plausible, measures positive', () => {
    expect(new Set(FOODS.map((f) => f.id)).size).toBe(FOODS.length);
    for (const f of FOODS) {
      const { kcal, protein, fat, carbs } = f.per100g;
      expect(protein + fat + carbs, f.name).toBeLessThanOrEqual(101);
      if (!f.tags.includes('alcohol')) // alcohol has its own calories (7 kcal/g), not in protein/fat/carbs
        expect(Math.abs(kcal - (4 * protein + 9 * fat + 4 * carbs)), f.name).toBeLessThan(Math.max(30, kcal * 0.2));
      for (const u of f.units ?? []) expect(u.grams, `${f.name} ${u.name}`).toBeGreaterThan(0);
    }
  });
});

describe('measure words', () => {
  it('agree with the number', () => {
    const it = (name: string, qty: number) => amountText({ name: 'x', grams: 1, unit: { name, qty, grams: 1 } });
    expect([it('скибка', 1), it('скибка', 2), it('скибка', 5), it('скибка', 1.5), it('шт', 2)]).toEqual(['1 скибка', '2 скибки', '5 скибок', '1,5 скибки', '2 шт']);
  });
});

describe('a dictated phrase (D30)', () => {
  it('«два варених яйця, склянку кефіру і салат» → three lines', async () => {
    const { RECIPES } = await import('../../src/data/recipes');
    const { dishItem } = await import('../../src/domain/recipes');
    const { recognize } = await import('../../src/domain/foodSearch');
    const r = recognize('Два варених яйця, склянку кефіру і салат', FOODS, RECIPES, dishItem, new Set(['kefir']));
    expect(r.map((x) => x.item?.name)).toEqual(['Яйце варене', 'Кефір 2,5 %', 'Салат овочевий з олією']);   // the usual kefir
    expect(recognize('кефір', FOODS, RECIPES, dishItem, new Set(['kefir-1']))[0]?.item?.name).toBe('Кефір 1 %');
    expect(r.map((x) => x.item?.grams)).toEqual([100, 250, expect.any(Number)]);
  });
  it('grams in words, «та», and a part it does not know', async () => {
    const { RECIPES } = await import('../../src/data/recipes');
    const { dishItem } = await import('../../src/domain/recipes');
    const { recognize } = await import('../../src/domain/foodSearch');
    const r = recognize('двісті грам гречки варної та огірок, щось незрозуміле', FOODS, RECIPES, dishItem);
    expect(r[0]?.item).toMatchObject({ foodId: 'buckwheat-boiled', grams: 200 });
    expect(r[1]?.item).toMatchObject({ foodId: 'cucumber' });
    expect(r[2]).toEqual({ text: 'щось незрозуміле' });
  });
});

describe('the bigger base (D45)', () => {
  it('finds everyday food by how people say it, and the rules see the new names', async () => {
    const { searchFoods: sf, parseQuery: pq, itemFor: it } = await import('../../src/domain/foodSearch');
    const { RECIPES } = await import('../../src/data/recipes');
    const { matchesAny } = await import('../../src/domain/rules');
    const K = await import('../../src/domain/rules/keywords.uk');
    const first = (q: string) => sf(FOODS, pq(q).text, 1)[0]?.name;
    expect(first('вареники з сиром')).toBe('Вареники з кисломолочним сиром');
    expect(first('кава')).toBe('Кава чорна');
    expect(first('ряжанка')).toBe('Ряжанка 4 %');
    expect(first('гриби')).toBe('Печериці');
    expect(it(FOODS.find((f) => f.id === 'vareniki-potato')!, pq('10 вареників'))).toMatchObject({ grams: 250, unit: { name: 'шт', qty: 10 } });
    expect(sf(RECIPES, 'борщ', 1)[0]?.name).toBe('Борщ');
    expect(matchesAny('Вівсянка на молоці', K.LACTOSE)).toBe(true);
    expect(matchesAny('Деруни (смажені)', K.GALLBLADDER)).toBe(true);
    expect(matchesAny('Морозиво пломбір', K.GLYCEMIC_REMOVE)).toBe(true);
    expect(matchesAny('Скумбрія холодного копчення', K.SALTY)).toBe(true);
    expect(matchesAny('Ряжанка 4 %', K.LACTOSE)).toBe(false);
  });

  it('every built-in dish is made of known foods and has a sensible weight', async () => {
    const { RECIPES } = await import('../../src/data/recipes');
    expect(RECIPES.length).toBeGreaterThanOrEqual(19);
    for (const r of RECIPES) {
      const g = r.items.reduce((s, x) => s + x.grams, 0);
      expect(g, r.name).toBeGreaterThan(80);
      expect(g, r.name).toBeLessThan(700);
    }
  });
});

describe('what a patient says (D77)', () => {
  const name = (q: string) => searchFoods(FOODS, parseQuery(q).text, 1)[0]?.name;
  it('«з цукром» never becomes «без цукру», and the other way round', () => {
    expect(name('чай з цукром')).toBe('Чай з цукром');
    expect(name('чай без цукру')).toBe('Чай без цукру');
    expect(name('кава з цукром')).toBe('Кава з цукром');
    expect(searchFoods(FOODS, 'кава з молоком і цукром').map((f) => f.name)).not.toContain('Кава з молоком (без цукру)');
  });
  it('«2 куски хліба» — bread by slices; «шматок сала» — a slice; компот', () => {
    const bread = FOODS.find((f) => f.name === name('2 куски хліба'))!;
    expect(bread.name).toBe('Білий хліб (батон)'); // D81: the everyday kind
    expect(itemFor(bread, parseQuery('2 куски хліба'))).toMatchObject({ grams: 60, unit: { name: 'скибка', qty: 2 } });
    const salo = FOODS.find((f) => f.id === 'salo')!;
    expect(itemFor(salo, parseQuery('шматок сала'))).toMatchObject({ grams: 10 });
    expect(name('склянка компоту')).toBe('Компот');
    expect(name('кус-кус')).toBe('Кус-кус варений'); // «кус» is not a measure here
  });
});

describe('a word alone (D81)', () => {
  it('«2 куски хліба» — the everyday wheat bread, the other kinds one tap away; a habit still wins', async () => {
    const { RECIPES } = await import('../../src/data/recipes');
    const { dishItem } = await import('../../src/domain/recipes');
    const [r] = recognize('2 куски хліба', FOODS, RECIPES, dishItem);
    expect(r!.item!.name).toBe('Білий хліб (батон)');
    expect(r!.others!.map((o) => o.name)).toEqual(expect.arrayContaining(['Хліб житній', 'Хліб цільнозерновий']));
    expect(r!.others![0]!.grams).toBe(60);
    expect(recognize('хліб', FOODS, RECIPES, dishItem, new Set(['bread-wholegrain']))[0]!.item!.name).toBe('Хліб цільнозерновий');
    expect(recognize('чай з цукром', FOODS, RECIPES, dishItem)[0]!.others).toBeUndefined(); // several words — meant as said
  });
});

describe('the exact name first (D83)', () => {
  const rec = async (q: string, prefer: Set<string> = new Set()) => {
    const { RECIPES } = await import('../../src/data/recipes');
    const { dishItem } = await import('../../src/domain/recipes');
    return recognize(q, FOODS, RECIPES, dishItem, prefer)[0]!;
  };
  it('a short word against a look-alike beginning', async () => {
    expect((await rec('курага')).item!.name).toBe('Курага');
    expect((await rec('курка')).item!.name).toMatch(/^Куряче філе/);
    expect((await rec('сирок')).item!.name).toBe('Сирок глазурований');
    expect((await rec('сирок глазурований')).item!.name).toBe('Сирок глазурований');
    expect((await rec('сир')).item!.name).toMatch(/^Сир /);
    expect((await rec('гречка')).item!.name).toBe('Гречка варена');
    expect((await rec('гречка з куркою')).item!.name).toBe('Гречка з куркою'); // the dish, when its words are said
    expect((await rec('рис')).item!.name).toBe('Рис білий варений');
    expect((await rec('салат')).item!.recipe).toBeDefined(); // an equal fit — the dish
    expect((await rec('курага', new Set(['chicken-breast']))).item!.name).toBe('Курага'); // a habit never beats the exact word
  });
  it('every food in the base is found first by its own name, and never offered as its own twin', async () => {
    for (const f of FOODS) {
      const first = searchFoods(FOODS, f.name, 1)[0];
      expect(first?.name, f.name).toBe(f.name);
      const r = await rec(f.name);
      expect(r.others?.some((o) => o.name === r.item?.name) ?? false, f.name).toBe(false);
    }
  });
});
