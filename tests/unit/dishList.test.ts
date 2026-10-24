// D123: «Мої страви — додати списком», the ways that cost nothing (tests/fixtures/dish-lists.yaml): what is there already, what
// is made here from the base, the repeats; what would go to the model and in how many requests. The model's ways — eval:dishes.
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import corpus from '../fixtures/dish-lists.yaml?raw';
import exportSample from '../fixtures/dishes-export-sample.csv?raw';
import { FOODS } from '../../src/data/foods';
import { RECIPES } from '../../src/data/recipes';
import { breakdown, recipeItems } from '../../src/domain/dishBreakdown';
import { decode, fileLine, fromFile, packs, parseCsv, parseText, tally, toCsv, toFile, wayOf, type ListContext } from '../../src/domain/dishList';
import { mealNutrients } from '../../src/domain/nutrition';
import { dishItem } from '../../src/domain/recipes';
import type { Recipe } from '../../src/domain/types';

interface Case { id: string; input?: string; input_file?: string; status: string; expect: Record<string, unknown> }
const cases = parse(corpus) as Case[];
const foods = new Map(FOODS.map((f) => [f.id, f]));
const ctx: ListContext = { foods: FOODS, recipes: RECIPES, harch: ['Курятина відварна з гречкою'], dishItem };

/** Windows-1251 by hand: Node's TextEncoder knows UTF-8 only. */
const cp1251 = (s: string) => Uint8Array.from([...s].map((ch) => {
  const c = ch.codePointAt(0)!;
  if (c < 0x80) return c;
  if (c >= 0x410 && c <= 0x44f) return c - 0x410 + 0xc0;
  return ({ 'і': 0xb3, 'І': 0xb2, 'ї': 0xbf, 'Ї': 0xaf, 'є': 0xba, 'Є': 0xaa, 'ґ': 0xb4, 'Ґ': 0xa5, '’': 0x92 } as Record<string, number>)[ch] ?? 0x3f;
}));
const CP1251_TEXT = 'назва;склад;порцій\r\nБорщ;;\r\nВареники з картоплею;тісто, картопля, цибуля;2\r\nКомпот;;\r\nПлов;рис 200 г, курка 300 г, морква 100 г;3\r\nОлів’є;;\r\n';

describe('«Мої страви — додати списком» (D123): the corpus', () => {
  for (const c of cases) {
    it(c.id, () => {
      const text = c.input ?? (c.input_file === 'dishes-export-sample.csv' ? exportSample : c.input_file === 'dishes-cp1251.csv' ? decode(cp1251(CP1251_TEXT)) : null);
      expect(text, 'read').not.toBeNull();
      const parsed = c.input_file ? parseCsv(text!) : parseText(text!);
      const ways = parsed.rows.map((r) => ({ name: r.name, way: wayOf(r, ctx) }));
      const names = (k: string) => ways.filter((w) => w.way.kind === k).map((w) => w.name);
      const e = c.expect;
      if (e.duplicates_merged !== undefined) expect(parsed.merged).toBe(e.duplicates_merged);
      if (e.rows !== undefined) expect(parsed.rows).toHaveLength(e.rows as number);
      if (e.exists) expect(names('exists')).toEqual(e.exists);
      if (e.local) expect(names('local')).toEqual(e.local);
      if (e.to_ai) expect(names('ai')).toEqual(e.to_ai);
      if (e.not_dish) expect(names('notDish')).toEqual(e.not_dish);
      if (e.draft) expect(names('draft')).toEqual(e.draft);
      if (e.ai_requests !== undefined) expect(tally(ways.map((w) => w.way)).requests).toBe(e.ai_requests);
    });
  }
});

describe('«Мої страви — додати списком» (D123)', () => {
  it('the local breakdown: portions and cooking words are not ingredients; the amounts as said', () => {
    const w = wayOf(parseText('Сирники домашні — сир 5 % 400 г, 2 яйця, борошно 3 ст. л., на пательні, на 4 порції').rows[0]!, ctx);
    expect(w.kind === 'local' && { portions: w.portions, lines: w.lines.map((l) => [l.food?.id, l.grams]) })
      .toEqual({ portions: 4, lines: [['cottage-cheese', 400], ['egg-boiled', 100], ['flour-wheat', 60]] });
    // an amount not said — the model's work (as D110), not a portion invented here
    expect(wayOf(parseText('Салат літній — огірок, помідор 100 г').rows[0]!, ctx)).toEqual({ kind: 'ai' });
  });

  it('a name already there with a make-up of its own: «вже є», and its local breakdown kept for «Додати як нову»', () => {
    const w = wayOf(parseText('Борщ — буряк 100 г, капуста 100 г').rows[0]!, ctx);
    expect(w.kind).toBe('exists');
    expect(w.kind === 'exists' && w.where).toBe('builtin');
  });

  it('30 names alone → 30 drafts «Потрібен склад»: no numbers, no request (ТЗ v1.0, R08)', () => {
    const ways = parseText(Array.from({ length: 30 }, (_, i) => `Страва номер ${i}`).join('\n')).rows.map((r) => wayOf(r, ctx));
    expect(tally(ways)).toMatchObject({ all: 30, drafts: 30, ai: 0, requests: 0 });
  });

  it('the summary counts what goes: 31 to the model → 3 requests of 15, 15, 1', () => {
    const list = Array.from({ length: 31 }, (_, i) => `Страва номер ${i} — щось 100 г, ще щось`).join('\n');
    const ways = parseText(list).rows.map((r) => wayOf(r, ctx));
    expect(tally(ways)).toMatchObject({ all: 31, ai: 31, requests: 3 });
    expect(packs(ways).map((p) => p.length)).toEqual([15, 15, 1]);
  });

  it('limits: 100 lines, a line over 400 signs cut and said', () => {
    const p = parseText([...Array.from({ length: 105 }, (_, i) => `Страва ${i}`), `Довга — ${'буряк, '.repeat(80)}`].join('\n'));
    expect(p.rows).toHaveLength(100);
    expect(p.over).toBe(6);
    const long = parseText(`Довга — ${'буряк, '.repeat(80)}`);
    expect(long.cut).toBe(1);
    expect(long.rows[0]!.text.length).toBe(400);
  });

  it('a file: UTF-8, else Windows-1251; garbage is not read', () => {
    expect(decode(new TextEncoder().encode('﻿Голубці'))).toBe('Голубці');
    expect(decode(cp1251('Олів’є;;'))).toBe('Олів’є;;');
    expect(decode(Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x0b]))).toBeNull();
    expect(parseCsv('name,make,portions\n"Плов, домашній","рис 200 г, курка 300 г",3\n').rows[0]).toMatchObject({ name: 'Плов, домашній', make: 'рис 200 г, курка 300 г', portions: 3 });
  });

  it('export → import: the same dishes, the same numbers, nothing asked of the model', () => {
    const own: Recipe[] = [
      { id: 'a', name: 'Сирники домашні', items: recipeItems(breakdown({ readable: true, name: '', portions: 4, note: '', items: [
        { said: 'сир', base: 'Сир кисломолочний 5 %', grams: 400, amountSaid: true, kcal: 0, protein: 0, fat: 0, carbs: 0 },
        { said: 'ваніль', base: '', grams: 2, amountSaid: false, kcal: 288, protein: 0, fat: 0, carbs: 12, tags: ['sweet'], allergens: [] }] }, FOODS), 4) },
      { id: 'b', name: 'Голубці', needsMake: true, items: [] },
      ...RECIPES.slice(0, 1),
    ];
    const mine = { id: 'my-1', name: 'Мій хліб', per100g: { kcal: 250, protein: 8, fat: 2, carbs: 50 }, tags: [], custom: true };
    own[0]!.items.push({ foodId: 'my-1', name: 'Мій хліб', grams: 30 });
    const withMine = new Map([...foods, ['my-1', mine]]);
    const file = toFile(own, withMine);
    expect(file.dishes.map((d) => d.name)).toEqual(['Сирники домашні', 'Голубці']); // built-in ones stay out
    const back = fromFile(JSON.stringify(file), foods)!.dishes; // another phone: no «Мій хліб» there
    expect(back.map((d) => d.name)).toEqual(['Сирники домашні', 'Голубці']);
    for (const [i, d] of back.slice(0, 1).entries()) {
      const was = mealNutrients(own[i]!.items, withMine), now = mealNutrients(d.items, foods);
      for (const k of ['kcal', 'protein', 'fat', 'carbs'] as const) expect(now[k]).toBeCloseTo(was[k], 6);
    }
    expect(back[1]).toEqual({ name: 'Голубці', items: [], needsMake: true }); // a draft travels as a draft — a name, no numbers
    expect(fromFile('{"format":"other"}', foods)).toBeNull();
    expect(toCsv(own)).toContain('Сирники домашні;Сир кисломолочний 5 % 100 г');
  });


  it('D131: a file is checked line by line — negative or text numbers refused and said, extra fields dropped, a known calcium kept', () => {
    const file = { format: 'protocol-dishes', v: 1, dishes: [
      { name: 'Мінус', items: [{ name: 'Щось', grams: 100, manual: { kcal: -100, protein: 1, fat: 1, carbs: 1 } }] },
      { name: 'Текст', items: [{ name: 'Щось', grams: 100, manual: { kcal: 100, protein: 'багато', fat: 1, carbs: 1 } }] },
      { name: 'Сир домашній', items: [{ name: 'Сир', grams: 100, manual: { kcal: 160, protein: 17, fat: 9, carbs: 2, calciumMg: 100 }, recipe: { id: 'x', portions: 9 }, hack: '<script>' }] },
      { name: 'Без кальцію', items: [{ name: 'Щось', grams: 50, manual: { kcal: 50, protein: 1, fat: 1, carbs: 10 } }] },
    ] };
    const r = fromFile(JSON.stringify(file), foods)!;
    expect(r.bad.map((b) => b.name)).toEqual(['Мінус', 'Текст']);
    expect(r.bad[1]!.why).toContain('не числа');
    expect(r.dishes.map((d) => d.name)).toEqual(['Сир домашній', 'Без кальцію']);
    expect(r.dishes[0]!.items[0]).toEqual({ name: 'Сир', grams: 100, manual: { kcal: 160, protein: 17, fat: 9, carbs: 2, calciumMg: 100 } }); // rebuilt, nothing passed through
    const cheese = recipeItems(r.dishes[0]!.items.map((it, i) => fileLine(it, i, foods)), 1);
    expect(mealNutrients(cheese, foods).calciumMg).toBeCloseTo(100, 6); // was 0 — the calcium lost on the way
    expect(fileLine(r.dishes[1]!.items[0]!, 0, foods).per100?.calciumMg).toBeUndefined(); // unknown stays unknown
  });

  it('D131: the same name with another make-up is another recipe — both kept, the later marked; a full repeat merged', () => {
    const p = parseText('Сирники — сир 400 г, 2 яйця\nСирники — сир 400 г, 2 яйця\nсирники — сир 500 г, борошно 2 ст. л.');
    expect(p.merged).toBe(1);
    expect(p.rows.map((r) => [r.make, !!r.sameName])).toEqual([['сир 400 г, 2 яйця', false], ['сир 500 г, борошно 2 ст. л.', true]]);
  });
});

