// D89: the medicines corpus (tests/fixtures/med-cases.yaml) through the same functions the plan's form uses — the
// register's search (first suggestion per name), the INN duplicates and, from step 4, the medicine + food notes.
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import corpus from '../fixtures/med-cases.yaml?raw';
import raw from '../../public/meds-index.json';
import { duplicateInn, readIndex, searchMeds } from '../../src/domain/meds';
import { medFoodNotes } from '../../src/domain/medFood';
import { readMeal } from '../../src/domain/foodSearch';
import { FOODS } from '../../src/data/foods';
import { RECIPES } from '../../src/data/recipes';
import { dishItem } from '../../src/domain/recipes';
import { t } from '../../src/i18n/uk';
import type { Prescription } from '../../src/domain/types';

interface Row { id: string; query?: string; meds?: string[]; phrase?: string; status: 'fixed' | 'open'
  expect: { first?: string; inn?: string; none?: boolean; duplicate_inn?: string | null; says_not?: string[]; med_food_note?: boolean; source_quoted?: boolean } }
const rows = parse(corpus) as Row[];
const index = readIndex(raw as never);

function check(row: Row): string[] {
  const out: string[] = [], w = row.expect;
  if (row.query) {
    const first = searchMeds(index, row.query)[0];
    if (w.none && first) out.push(`очікувалось нічого, є «${first.name}»`);
    if (w.first && !first?.name.startsWith(w.first)) out.push(`перша підказка «${first?.name ?? '—'}», очікується «${w.first}…»`);
    if (w.inn && first?.inn !== w.inn) out.push(`МНН «${first?.inn ?? '—'}», очікується «${w.inn}»`);
  }
  if (row.meds) {
    const plan: Prescription[] = row.meds.map((q, i) => {
      const e = searchMeds(index, q)[0];
      return { id: `m${i}`, kind: 'medication', title: e?.name ?? q, source: '', ...(e ? { med: { name: e.name, inn: e.inn, atc: e.atc } } : {}) };
    });
    if ('duplicate_inn' in w) {
      const d = duplicateInn(plan)[0];
      if ((d?.inn ?? null) !== w.duplicate_inn) out.push(`дубль «${d?.inn ?? 'немає'}», очікується «${w.duplicate_inn ?? 'немає'}»`);
      const text = d ? t.plan.duplicate(d.titles, d.inn) : '';
      for (const s of w.says_not ?? []) if (text.toLowerCase().includes(s)) out.push(`текст містить «${s}»: ${text}`);
    }
    if (row.phrase && 'med_food_note' in w) {
      const items = readMeal(row.phrase, { foods: FOODS, recipes: RECIPES, dishItem }).rows.flatMap((r) => (r.item ? [r.item] : []));
      const notes = medFoodNotes(plan, items, new Map(FOODS.map((f) => [f.id, f])), {});
      if (!!notes.length !== w.med_food_note) out.push(`відмітка «препарат + їжа»: ${notes.length ? 'є' : 'немає'}`);
      if (w.source_quoted && notes.length && !notes.every((n) => n.quote)) out.push('немає цитати з інструкції');
    }
  }
  return out;
}

describe('medicines corpus (D89)', () => {
  it('reads: unique ids', () => expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length));
  for (const row of rows) {
    it(`${row.status} · ${row.id}`, () => {
      const diff = check(row);
      if (row.status === 'fixed') expect(diff, `${row.id}\n${diff.join('\n')}`).toEqual([]);
      else expect(diff.length, `${row.id} проходить — переведіть у fixed`).toBeGreaterThan(0);
    });
  }
});

describe('medicine + food, with a checked table (D89 step 4 mechanism)', () => {
  const checked = [
    { inn: 'Atorvastatin', food: 'grapefruit' as const, kind: 'avoid' as const, quote: 'Уникайте вживання великої кількості грейпфрутового соку.', checkedBy: 'test', checkedAt: '2026-10-18' },
    { inn: 'Levothyroxine sodium', food: 'calcium' as const, kind: 'separate' as const, hours: 4, quote: 'Препарати кальцію — з інтервалом не менше 4 годин.', checkedBy: 'test' },
    { inn: 'Warfarin', food: 'vitk' as const, kind: 'steady' as const, quote: '' , checkedBy: 'test' }, // no quote — never shown
  ];
  const foodsMap = new Map(FOODS.map((f) => [f.id, f]));
  const rx = (id: string, title: string, inn: string): Prescription => ({ id, kind: 'medication', title, source: '', med: { name: title, inn } });
  const line = (q: string) => readMeal(q, { foods: FOODS, recipes: RECIPES, dishItem }).rows.flatMap((r) => (r.item ? [r.item] : []));
  it('«avoid» speaks with the instruction\'s words; a row without a quote or a check never does', () => {
    expect(medFoodNotes([rx('a', 'Аторвастатин', 'Atorvastatin')], line('пів грейпфрута'), foodsMap, {}, checked)[0]).toMatchObject({ medicine: 'Аторвастатин', food: 'Грейпфрут' });
    expect(medFoodNotes([rx('w', 'Варфарин', 'Warfarin')], line('шпинат'), foodsMap, {}, checked)).toEqual([]);
    expect(medFoodNotes([rx('a', 'Аторвастатин', 'Atorvastatin')], line('грейпфрут'), foodsMap)).toEqual([]); // the shipped table is unchecked
  });
  it('«separate» only when the meal and the dose came closer than the interval; no times — silent', () => {
    const doses = new Map([['l', ['2026-10-18T07:00:00+03:00']]]);
    const notes = (at?: string) => medFoodNotes([rx('l', 'Еутирокс', 'Levothyroxine sodium')], line('сир'), foodsMap, { ...(at ? { mealAt: at } : {}), doses }, checked);
    expect(notes('2026-10-18T08:00:00+03:00')).toHaveLength(1);
    expect(notes('2026-10-18T12:00:00+03:00')).toEqual([]);
    expect(notes()).toEqual([]);
  });
});
