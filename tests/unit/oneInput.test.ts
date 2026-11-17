// D162: the one-field corpus — what «Скажіть або напишіть…» makes of a phrase, through readOneInput (what the field calls).
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import corpus from '../fixtures/one-input.yaml?raw';
import concierge from '../fixtures/concierge-cases.yaml?raw';
import { FOODS } from '../../src/data/foods';
import { RECIPES } from '../../src/data/recipes';
import { amountText } from '../../src/domain/foodSearch';
import { readOneInput, type DueMed, type OneInput, type OneInputContext } from '../../src/domain/oneInput';
import { dishItem } from '../../src/domain/recipes';
import { readUtterance } from '../../src/domain/voice';

interface Row { id: string; say: string; card?: string; assistant?: boolean; status: 'fixed' | 'open'
  expect: { kind: OneInput['kind']; meds?: string[]; options?: string[]; water_ml?: number; items?: string[]; not_found?: string[]; draft_water_ml?: number } }
const rows = parse(corpus) as Row[];

const med = (id: string, title: string, time: string, aliases?: string[]): DueMed => ({ key: `med:${id}:${time}`, title, time, prescriptionId: id, ...(aliases ? { aliases } : {}) });
const base: OneInputContext = {
  foods: FOODS, recipes: RECIPES, dishItem, prescriptions: [], yesterday: [], now: '08:30', assistant: true,
  meds: [med('met', 'Метформін', '08:00', ['Сіофор']), med('ena', 'Еналаприл', '08:00'), med('ator', 'Аторвастатин', '20:00')],
  taken: [med('vitd', 'Вітамін D', '08:00')],
};

const names = (r: OneInput): string[] => r.kind === 'food' || r.kind === 'edit'
  ? r.draft.items.map((x) => (x.item.unit && x.sure ? `${x.item.name} ${amountText(x.item)}` : x.item.name)) : [];

function check(row: Row): string[] {
  const ctx: OneInputContext = { ...base, ...(row.assistant === false ? { assistant: false } : {}),
    ...(row.card ? { card: readUtterance(row.card, { ...base, meds: [] }) } : {}) };
  const got = readOneInput(row.say, ctx);
  const out: string[] = [];
  const e = row.expect;
  if (got.kind !== e.kind) return [`вид: ${got.kind}`];
  if (e.meds && (got.kind !== 'meds' || got.meds.map((m) => m.title).join('|') !== e.meds.join('|'))) out.push(`ліки: ${got.kind === 'meds' ? got.meds.map((m) => m.title).join(', ') : '—'}`);
  if (e.options && (got.kind !== 'which-med' || got.options.map((m) => m.title).join('|') !== e.options.join('|'))) out.push(`питання «яку?»: ${got.kind === 'which-med' ? got.options.map((m) => m.title).join(', ') : '—'}`);
  if (e.water_ml !== undefined && (got.kind !== 'water' || got.ml !== e.water_ml)) out.push(`вода: ${got.kind === 'water' ? got.ml : '—'}`);
  if (e.items) {
    const have = names(got);
    if (have.length !== e.items.length || e.items.some((w, i) => !have[i]?.startsWith(w))) out.push(`чернетка: ${have.join(' | ') || '—'}`);
  }
  if (e.draft_water_ml !== undefined && (got.kind !== 'food' || got.draft.waterMl !== e.draft_water_ml)) out.push(`вода в чернетці: ${got.kind === 'food' ? got.draft.waterMl : '—'}`);
  if (e.not_found && (got.kind !== 'food' || got.draft.notFound.join('|') !== e.not_found.join('|'))) out.push(`не знайдено: ${got.kind === 'food' ? got.draft.notFound.join(', ') : '—'}`);
  return out;
}

describe('one input corpus (D162)', () => {
  it('reads: unique ids', () => expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length));
  for (const row of rows) {
    it(`${row.status} · ${row.id}`, () => {
      const diff = check(row);
      if (row.status === 'fixed') expect(diff, `${row.id}: «${row.say}»\n${diff.join('\n')}`).toEqual([]);
      else expect(diff.length, `${row.id} проходить — переведіть у fixed`).toBeGreaterThan(0);
    });
  }
});

describe('danger and crisis phrases of the concierge corpus give the same cards in the one field (D130, D162)', () => {
  const cases = (parse(concierge) as { id: string; scenario: string; input?: string; say?: string; expect: Record<string, unknown> }[])
    .filter((c) => (c.scenario === 'danger' && typeof c.input === 'string')
      || (c.scenario === 'chat_route' && typeof c.say === 'string' && (c.expect.card === 'danger-103' || c.expect.card === 'crisis-7333') && c.expect.model_called === false));
  it('there are such phrases', () => expect(cases.length).toBeGreaterThan(5));
  for (const c of cases) {
    it(c.id, () => {
      const got = readOneInput((c.input ?? c.say)!, base).kind;
      const want = c.scenario === 'danger' ? (c.expect.danger_card ? 'danger' : 'not a card') : c.expect.card === 'crisis-7333' ? 'crisis' : 'danger';
      if (want === 'not a card') expect(['danger', 'crisis']).not.toContain(got);
      else expect(got).toBe(want);
    });
  }
});

describe('a medicine is never marked by the field itself (D162)', () => {
  it('a medicine phrase is only a card to confirm: the result carries the doses, nothing else', () => {
    const r = readOneInput('випив метформін', base);
    expect(r).toEqual({ kind: 'meds', meds: [base.meds[0]] });
  });
  it('a trade name of the plan finds the dose', () => {
    const r = readOneInput('сіофор випила', base);
    expect(r.kind === 'meds' && r.meds.map((m) => m.title)).toEqual(['Метформін']);
  });
});
