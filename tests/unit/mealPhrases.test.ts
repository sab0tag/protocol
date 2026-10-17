// D85: the phrase corpus (tests/fixtures/meal-phrases.yaml) through the whole path of «Записати їжу» — readMeal(), the
// function the screen calls while typing; never the search alone (the «кефір 1 %» and portion bugs lived in between).
// fixed: must pass (a failure is a regression). open: expected to fail and reported; one that passes fails the run —
// move it to fixed.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { demoData } from '../../src/data/demo';
import { FOODS } from '../../src/data/foods';
import { RECIPES } from '../../src/data/recipes';
import { emptyPlan, examplePlan } from '../../src/data/seed.example';
import { readMeal, type MealContext } from '../../src/domain/foodSearch';
import { frequentItems } from '../../src/domain/habits';
import { dishItem } from '../../src/domain/recipes';
import { checkMeal } from '../../src/domain/rules';
import type { MealItem, Plan } from '../../src/domain/types';

interface Want { name: string; qty?: number; unit?: string; grams?: [number, number]; flags?: string[]; alt_excludes?: string[] }
interface Row { id: string; phrase: string; profile: 'clean' | 'demo'; expect: Want[]; not_found?: string[]; status: 'fixed' | 'open'; found: string; note?: string }

const rows = parse(readFileSync(resolve(process.cwd(), 'tests/fixtures/meal-phrases.yaml'), 'utf8')) as Row[]; // jsdom: no file: URL
const NOW = new Date('2026-10-17T12:00:00');
const TODAY = '2026-10-17';
const foods = new Map(FOODS.map((f) => [f.id, f]));

/** clean — an empty store; demo — what «Подивитись на прикладі» puts in (the plan and its two weeks, so habits count). */
function profile(p: Row['profile']): { ctx: MealContext; plan: Plan } {
  if (p === 'clean') return { ctx: { foods: FOODS, recipes: RECIPES, dishItem, prefer: new Set() }, plan: emptyPlan() };
  const { entries } = demoData(foods, NOW);
  const prefer = new Set(frequentItems(entries, TODAY, 60, 50).map((f) => f.item.recipe?.id ?? f.item.foodId ?? ''));
  return { ctx: { foods: FOODS, recipes: RECIPES, dishItem, prefer }, plan: examplePlan(NOW) };
}

const show = (it?: MealItem) => (it ? `${it.name}${it.unit ? ` · ${it.unit.qty} ${it.unit.name}` : ''} · ${it.grams} г` : '—');

/** What differs from the row's expectations, one line per position; empty when the row holds. */
function check(row: Row): string[] {
  const { ctx, plan } = profile(row.profile);
  const read = readMeal(row.phrase, ctx).rows;
  const got = read.filter((r) => r.item);
  const out: string[] = [];
  if (got.length !== row.expect.length) out.push(`позицій ${got.length}, очікується ${row.expect.length}: ${got.map((r) => show(r.item)).join('; ') || '—'}`);
  const checks = row.profile === 'demo' && got.length
    ? checkMeal({ plan, date: TODAY, foods, dayEntries: [], meal: got.map((r) => r.item!), recentEntries: [] }) : [];
  row.expect.forEach((w, i) => {
    const r = got[i], it = r?.item;
    const bad: string[] = [];
    if (it?.name !== w.name) bad.push(`назва «${it?.name ?? '—'}»`);
    if (w.qty !== undefined && it?.unit?.qty !== w.qty) bad.push(`кількість ${it?.unit?.qty ?? '—'}`);
    if (w.unit !== undefined && it?.unit?.name !== w.unit) bad.push(`одиниця «${it?.unit?.name ?? '—'}»`);
    if (w.grams && (!it || it.grams < w.grams[0] || it.grams > w.grams[1])) bad.push(`${it?.grams ?? '—'} г поза [${w.grams.join(', ')}]`);
    const hits = checks[i]?.hits ?? [];
    for (const f of w.flags ?? []) if (!hits.some((h) => h.message === f || h.reason === f)) bad.push(`немає відмітки «${f}» (є: ${hits.map((h) => h.message).join(', ') || '—'})`);
    for (const x of w.alt_excludes ?? []) if (r?.others?.some((o) => o.name === x)) bad.push(`«${x}» в «або:»`);
    if (bad.length) out.push(`#${i + 1} очікується ${w.name}${w.qty !== undefined ? ` · ${w.qty}` : ''}${w.unit ? ` ${w.unit}` : ''}, є ${show(it)}: ${bad.join('; ')}`);
  });
  const missing = read.filter((r) => !r.item).map((r) => r.text);
  for (const n of row.not_found ?? []) if (!missing.includes(n)) out.push(`«${n}» мало дати «не знайдено»`);
  return out;
}

describe('meal phrase corpus (D85)', () => {
  it('reads: unique ids, the required fields', () => {
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    for (const r of rows) expect([r.id, r.phrase, r.profile, r.status, r.found].every(Boolean), r.id).toBe(true);
  });
  for (const row of rows) {
    it(`${row.status} · ${row.id} · «${row.phrase}»`, () => {
      const diff = check(row);
      if (row.status === 'fixed') expect(diff, `${row.id} «${row.phrase}»\n${diff.join('\n')}`).toEqual([]);
      else {
        expect(diff.length, `${row.id} «${row.phrase}» проходить — переведіть у fixed`).toBeGreaterThan(0);
        console.info(`open ${row.id} «${row.phrase}»: ${diff.join(' | ')}`); // the expected failure, in the report
      }
    });
  }
});
