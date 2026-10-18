// D91: the concierge corpus — the parts the code answers (scenario 2 «Чому позначено?», danger signs) run here; scenario 1
// runs live against the model (scripts/eval-concierge.ts, five times a row); scenarios 3–4 and chat are not built yet.
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import corpus from '../fixtures/concierge-cases.yaml?raw';
import { FOODS } from '../../src/data/foods';
import { RECIPES } from '../../src/data/recipes';
import { examplePlan } from '../../src/data/seed.example';
import { whyFlagged } from '../../src/domain/concierge';
import { readMeal } from '../../src/domain/foodSearch';
import { dishItem } from '../../src/domain/recipes';
import { checkMeal } from '../../src/domain/rules';
import { dangerInText } from '../../src/domain/symptoms';

interface Row { id: string; scenario: string; phrase?: string; input?: string; status: 'fixed' | 'open'
  expect: { mentions?: string[]; links_plan?: boolean; no_digits_beyond_plan?: boolean; danger_card?: boolean } }
const rows = parse(corpus) as Row[];
const foods = new Map(FOODS.map((f) => [f.id, f]));
const plan = examplePlan(new Date('2026-10-18T12:00:00'));
const BUILT = new Set(['why', 'danger']);

function check(row: Row): string[] {
  const out: string[] = [];
  if (row.scenario === 'why') {
    const items = readMeal(row.phrase!, { foods: FOODS, recipes: RECIPES, dishItem }).rows.flatMap((r) => (r.item ? [r.item] : []));
    const hits = checkMeal({ plan, date: '2026-10-18', foods, dayEntries: [], recentEntries: [], meal: items }).flatMap((c) => c.hits);
    if (!hits.length) return ['немає відміток — нічого пояснювати'];
    const whys = hits.map((h) => whyFlagged(h, plan));
    const text = whys.map((w) => w.text).join(' ');
    for (const m of row.expect.mentions ?? []) if (!text.toLowerCase().includes(m.toLowerCase())) out.push(`немає «${m}» у «${text}»`);
    if (row.expect.links_plan && !whys.some((w) => w.constraint)) out.push('не знайдено пункт плану');
    if (row.expect.no_digits_beyond_plan) {
      const allowed = JSON.stringify(plan);
      for (const d of text.match(/\d+([.,]\d+)?/g) ?? []) if (!allowed.includes(d)) out.push(`число «${d}» не з плану`);
    }
  }
  if (row.scenario === 'danger' && dangerInText(row.input!) !== row.expect.danger_card) out.push(`картка 103: ${dangerInText(row.input!) ? 'є' : 'немає'}`);
  return out;
}

describe('concierge corpus (D91)', () => {
  it('reads: unique ids, known scenarios', () => {
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    for (const r of rows) expect(['why', 'danger', 'not_found', 'goal_topup', 'near_limit', 'chat'], r.id).toContain(r.scenario);
  });
  for (const row of rows.filter((r) => BUILT.has(r.scenario))) {
    it(`${row.status} · ${row.id}`, () => {
      const diff = check(row);
      if (row.status === 'fixed') expect(diff, `${row.id}\n${diff.join('\n')}`).toEqual([]);
      else expect(diff.length, `${row.id} проходить — переведіть у fixed`).toBeGreaterThan(0);
    });
  }
  it('scenarios not built yet stay open', () => {
    for (const r of rows.filter((x) => !BUILT.has(x.scenario) && x.scenario !== 'not_found')) expect(r.status, r.id).toBe('open');
  });
});
