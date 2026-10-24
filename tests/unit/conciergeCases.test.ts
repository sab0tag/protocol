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
import { nearLimit, topups, type DayState } from '../../src/domain/topup';
import { effectiveTargets } from '../../src/domain/nutrition';
import { frequentItems } from '../../src/domain/habits';
import { demoData } from '../../src/data/demo';
import { emptyPlan } from '../../src/data/seed.example';

interface Row { id: string; scenario: string; phrase?: string; input?: string; status: 'fixed' | 'open'; profile?: string; time?: string
  day?: { kcal?: number; protein?: number; calcium?: number; carbs?: number }
  expect: { mentions?: string[]; links_plan?: boolean; no_digits_beyond_plan?: boolean; danger_card?: boolean
    asks?: boolean; goals?: string[]; numbers?: Record<string, number>; items_pass_plan?: boolean; items_exclude_tags?: string[]; items_ready_minutes_max?: number } }
const rows = parse(corpus) as Row[];
const foods = new Map(FOODS.map((f) => [f.id, f]));
const plan = examplePlan(new Date('2026-10-18T12:00:00'));
const BUILT = new Set(['why', 'danger', 'goal_topup', 'near_limit']);
const usual = frequentItems(demoData(foods, new Date('2026-10-18T12:00:00')).entries, '2026-10-18', 60, 50).map((f) => f.item.foodId ?? '').filter(Boolean);

function dayState(row: Row): DayState {
  const p = row.profile === 'demo' ? plan : emptyPlan();
  return { plan: p, targets: effectiveTargets(p, '2026-10-18'), date: '2026-10-18', now: row.time ?? '18:00', mealsDone: 2, foods,
    usual: row.profile === 'demo' ? usual : [], have: { kcal: row.day?.kcal ?? 1e6, protein: row.day?.protein ?? 0, calciumMg: row.day?.calcium ?? 0, carbs: row.day?.carbs ?? 0 } };
}

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
  if (row.scenario === 'goal_topup' || row.scenario === 'near_limit') {
    const s = dayState(row), w = row.expect;
    const tops = row.scenario === 'goal_topup' ? topups(s) : [], near = row.scenario === 'near_limit' ? nearLimit(s) : null;
    const asks = row.scenario === 'goal_topup' ? tops.length > 0 : !!near;
    if (w.asks !== undefined && asks !== w.asks) out.push(`питає: ${asks ? 'так' : 'ні'}`);
    for (const g of w.goals ?? []) if (!tops.some((x) => x.goal === g)) out.push(`немає добору «${g}»`);
    const nums: Record<string, number | undefined> = { kcal_gap: tops.find((x) => x.goal === 'kcal')?.gap, protein_gap: tops.find((x) => x.goal === 'proteinG')?.gap, calcium_gap: tops.find((x) => x.goal === 'calciumMg')?.gap, carbs_left: near?.left };
    for (const [k, v] of Object.entries(w.numbers ?? {})) if (nums[k] !== v) out.push(`${k}: ${nums[k] ?? '—'}, очікується ${v}`);
    const items = tops.flatMap((x) => x.items);
    if (w.items_pass_plan) for (const it of items) if (checkMeal({ plan: s.plan, date: s.date, foods, dayEntries: [], recentEntries: [], meal: [it] }).some((c) => c.hits.length)) out.push(`«${it.name}» не проходить план`);
    if (w.items_exclude_tags?.includes('milk')) for (const it of items) if (foods.get(it.foodId!)?.tags.includes('dairy')) out.push(`«${it.name}» — молочне`);
    if (w.items_ready_minutes_max !== undefined) for (const it of items) if (/\((сир|сух)/iu.test(it.name)) out.push(`«${it.name}» треба готувати`);
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
