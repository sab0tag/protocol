// D107: the commands corpus — a draft said first, then commands, through step() — what the voice window calls.
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import corpus from '../fixtures/voice-commands.yaml?raw';
import { FOODS } from '../../src/data/foods';
import { RECIPES } from '../../src/data/recipes';
import { amountText } from '../../src/domain/foodSearch';
import { dishItem } from '../../src/domain/recipes';
import { newSession, step, type VoiceContext } from '../../src/domain/voice';

interface Row { id: string; start: string[]; say: string[]; expect: string[]; expect_note?: string; expect_ask?: string[]; expect_meal?: string
  no_not_found?: boolean; expect_clear_asked?: boolean; status: 'fixed' | 'open' }
const rows = parse(corpus) as Row[];
const ctx: VoiceContext = { foods: FOODS, recipes: RECIPES, dishItem, prescriptions: [], yesterday: [], meds: [] };

function check(row: Row): string[] {
  let s = row.start.reduce((acc, x) => step(acc, x, ctx), newSession());
  s = { ...s, history: s.history }; // the commands go on the same history
  s = row.say.reduce((acc, x) => step(acc, x, ctx), s);
  const out: string[] = [];
  const got = s.draft.items.map((x) => (x.item.unit ? `${x.item.name} ${amountText(x.item)}` : x.item.name));
  const want = row.expect.map((e) => e);
  if (got.length !== want.length || want.some((w, i) => got[i] !== w && !(got[i]?.startsWith(w) && !/\d/.test(w)))) out.push(`чернетка: ${got.join(' | ') || '—'}`);
  if (row.expect_note && !s.note?.includes(row.expect_note)) out.push(`рядок: ${s.note ?? '—'}`);
  if (row.expect_ask) {
    const opts = s.ask ? [`Прибрати всю «${s.ask.whole}»`, ...(s.ask.instead ? [`Замінити на «${s.ask.instead.name}»`] : [])] : [];
    if (opts.join('|') !== row.expect_ask.join('|')) out.push(`питання: ${opts.join(' | ') || '—'}`);
  }
  if (row.expect_meal && s.draft.title !== row.expect_meal) out.push(`прийом: ${s.draft.title ?? '—'}`);
  if (row.no_not_found && s.draft.notFound.length) out.push(`не знайдено: ${s.draft.notFound.join(', ')}`);
  if (row.expect_clear_asked && !s.confirmClear) out.push('очищення не питає');
  return out;
}

describe('voice commands corpus (D107)', () => {
  it('reads: unique ids', () => expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length));
  for (const row of rows) {
    it(`${row.status} · ${row.id}`, () => {
      const diff = check(row);
      if (row.status === 'fixed') expect(diff, `${row.id}\n${diff.join('\n')}`).toEqual([]);
      else expect(diff.length, `${row.id} проходить — переведіть у fixed`).toBeGreaterThan(0);
    });
  }
});
