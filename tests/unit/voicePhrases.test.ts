// D95: the voice corpus — what was said, in turns, through hear() — the function the voice window calls.
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import corpus from '../fixtures/voice-phrases.yaml?raw';
import { demoData } from '../../src/data/demo';
import { FOODS } from '../../src/data/foods';
import { RECIPES } from '../../src/data/recipes';
import { examplePlan } from '../../src/data/seed.example';
import { buildChecklist } from '../../src/domain/checklist';
import { dateOf } from '../../src/domain/dates';
import { dishItem } from '../../src/domain/recipes';
import { emptyDraft, hear, ready, type VoiceContext } from '../../src/domain/voice';

interface Want { name: string; qty?: number; unit?: string; grams?: [number, number]; sure?: boolean }
interface Row { id: string; say: string[]; profile: 'clean' | 'demo'; status: 'fixed' | 'open'
  expect: { title?: string; items?: Want[]; items_min?: number; meds?: string[]; water?: number; not_found?: string[]; ready?: boolean } }
const rows = parse(corpus) as Row[];
const now = new Date('2026-10-18T12:00:00');
const foods = new Map(FOODS.map((f) => [f.id, f]));

function ctx(profile: Row['profile']): VoiceContext {
  const plan = profile === 'demo' ? examplePlan(now) : undefined;
  const c = buildChecklist({ plan, date: '2026-10-18', entries: [], workouts: [], foods, now });
  const yesterday = profile === 'demo' ? demoData(foods, now).entries.filter((e) => dateOf(e.at) === '2026-10-17') : [];
  return { foods: FOODS, recipes: RECIPES, dishItem, prescriptions: plan?.prescriptions ?? [], yesterday,
    meds: c.items.filter((i) => i.kind === 'med').map((i) => ({ key: i.key, title: i.title, ...(i.prescriptionId ? { prescriptionId: i.prescriptionId } : {}) })) };
}

function check(row: Row): string[] {
  const c = ctx(row.profile);
  const d = row.say.reduce((acc, s) => hear(s, acc, c), emptyDraft());
  const out: string[] = [], w = row.expect;
  if (w.title && d.title !== w.title) out.push(`назва «${d.title ?? '—'}»`);
  if (w.items) {
    if (d.items.length !== w.items.length) out.push(`позицій ${d.items.length}: ${d.items.map((x) => x.item.name).join(', ')}`);
    w.items.forEach((x, i) => {
      const it = d.items[i];
      if (it?.item.name !== x.name) out.push(`#${i + 1} «${it?.item.name ?? '—'}», очікується «${x.name}»`);
      if (x.qty !== undefined && it?.item.unit?.qty !== x.qty) out.push(`#${i + 1} кількість ${it?.item.unit?.qty ?? '—'}`);
      if (x.unit !== undefined && it?.item.unit?.name !== x.unit) out.push(`#${i + 1} одиниця ${it?.item.unit?.name ?? '—'}`);
      if (x.grams && (!it || it.item.grams < x.grams[0] || it.item.grams > x.grams[1])) out.push(`#${i + 1} ${it?.item.grams} г`);
      if (x.sure !== undefined && it?.sure !== x.sure) out.push(`#${i + 1} sure ${it?.sure}`);
    });
  }
  if (w.items_min !== undefined && d.items.length < w.items_min) out.push(`позицій ${d.items.length}`);
  if (w.meds && d.meds.map((m) => m.title).join('|') !== w.meds.join('|')) out.push(`ліки ${d.meds.map((m) => m.title).join(', ') || '—'}`);
  if (w.water !== undefined && d.waterMl !== w.water) out.push(`вода ${d.waterMl}`);
  if (w.not_found && d.notFound.join('|') !== w.not_found.join('|')) out.push(`не знайдено: ${d.notFound.join(', ') || '—'}`);
  if (w.ready !== undefined && ready(d) !== w.ready) out.push(`ready ${ready(d)}`);
  return out;
}

describe('voice corpus (D95)', () => {
  it('reads: unique ids', () => expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length));
  for (const row of rows) {
    it(`${row.status} · ${row.id}`, () => {
      const diff = check(row);
      if (row.status === 'fixed') expect(diff, `${row.id}\n${diff.join('\n')}`).toEqual([]);
      else expect(diff.length, `${row.id} проходить — переведіть у fixed`).toBeGreaterThan(0);
    });
  }
});

describe('the stop phrase (D105)', () => {
  it('only at the end, any case and punctuation; taken out of the text', async () => {
    const { endsWithStop, withoutStop } = await import('../../src/domain/foodSearch');
    for (const s of ['2 яйця, кава з молоком. Це все!', 'гречка це всё', 'чай це усе', 'борщ, это все.', 'кава все', 'салат готово', 'хліб стоп', 'суп Done'])
      expect(endsWithStop(s), s).toBe(true);
    expect(withoutStop('2 яйця, кава з молоком. Це все!')).toBe('2 яйця, кава з молоком.');
    expect(withoutStop('суп Done')).toBe('суп');
    expect(withoutStop('салат помідор огірок, це все')).toBe('салат помідор огірок');
    for (const s of ['це все з\'їв?', 'усе', 'вівсянка на воді', 'стопка млинців']) expect(endsWithStop(s), s).toBe(false);
  });
});

describe('the base’s order does not choose the food (D105)', () => {
  it('«250 г вівсянки» is the porridge on water, the foods in any order', async () => {
    const { readMeal } = await import('../../src/domain/foodSearch');
    for (const list of [FOODS, [...FOODS].sort((a, b) => a.id.localeCompare(b.id)), [...FOODS].reverse()])
      expect(readMeal('250 г вівсянки', { foods: list, recipes: RECIPES, dishItem }).rows[0]?.item?.name).toBe('Вівсянка на воді');
  });
});
