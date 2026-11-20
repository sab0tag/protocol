// @vitest-environment jsdom
// The concierge corpus's talk rows, live (owner 20.11: «протокол живого прогона … concierge-cases»): every danger, chat_route and
// chat row through the same `answer()` the field and «Помічник» run, against the real server and model, three times each. The unit
// test (assistantAnswer.test.ts) runs the same rows with the model replaced; here the model is real, so a row whose card depends
// on a scripted model reply is printed, not checked. Not in `npm test` (network, a model, money): `npm run eval:concierge-chat`.
// A throwaway vault; logs nothing (log: false). Writes test-results/concierge-chat-eval.txt for the analyst's read.
vi.mock('../../src/sync/runner', () => ({ currentKeys: () => keys }));
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { parse } from 'yaml';
import corpus from '../fixtures/concierge-cases.yaml?raw';
import { answer, type Answer, type Msg } from '../../src/app/assistantAnswer';
import { FOODS } from '../../src/data/foods';
import { RECIPES } from '../../src/data/recipes';
import { emptyPlan, examplePlan } from '../../src/data/seed.example';
import { passes } from '../../src/domain/evaluate';
import type { Plan } from '../../src/domain/types';
import { createVault, type Keys } from '../../src/sync/api';
import { deriveKeys, newCode, parseCode } from '../../src/sync/crypto';

interface Row { id: string; scenario: string; input?: string; say?: string; status: string; profile?: string
  history?: string[]; stored_history?: string[]; plan_targets?: Record<string, number>; model_reply?: unknown
  expect: { danger_card?: boolean; card?: 'danger-103' | 'crisis-7333' | 'none'; model_called?: boolean } }
let keys: Keys | null = null;
const RUNS = 3;
const rows = (parse(corpus) as Row[]).filter((r) => ['danger', 'chat_route', 'chat'].includes(r.scenario));
const foods = new Map(FOODS.map((f) => [f.id, f]));
const date = new Date().toISOString().slice(0, 10);
const planOf = (r: Row): Plan => r.scenario === 'chat_route' ? { ...emptyPlan(), ...(r.plan_targets ? { targets: r.plan_targets } : {}) } : examplePlan();
const cardOf = (a: Answer) => ('card' in a ? (a.card === 'crisis' ? 'crisis-7333' : 'danger-103') : 'none');
const shown = (a: Answer) => ('card' in a ? `[картка ${cardOf(a)}]` : 'consent' in a ? '[згода]' : `${a.text}${a.items?.length ? ` → ${a.items.map((x) => x.name).join(', ')}` : ''}`);

test('the corpus talk rows, live, three runs each', async () => {
  keys = await deriveKeys(parseCode(newCode())!);
  await createVault(keys);
  const out: string[] = [], bad: string[] = [];
  for (const r of rows) {
    const words = (r.say ?? r.input)!;
    const plan = planOf(r);
    const history: Msg[] = (r.stored_history ?? r.history ?? []).map((text, i) => ({ id: `h${i}`, role: i % 2 ? 'assistant' : 'user', text }));
    const want = r.expect.card ?? (r.expect.danger_card === undefined ? undefined : r.expect.danger_card ? 'danger-103' : 'none');
    // a card the corpus expects from a scripted model reply cannot be checked against a real model
    const checkCard = want !== undefined && !(r.model_reply && want !== 'none');
    out.push(`## ${r.id} (${r.scenario}, ${r.status}) — «${words}»${want ? ` · очікується картка: ${want}${checkCard ? '' : ' (від заданої відповіді моделі — лише друк)'}` : ''}`);
    for (let i = 0; i < RUNS; i++) {
      const a = await answer(words, { plan, foods, recipes: RECIPES, all: [], date }, { consent: true, log: false, history });
      out.push(`  #${i + 1}: ${shown(a)}`);
      if (r.status !== 'fixed') continue; // open rows are findings, printed for the analyst
      if (checkCard && cardOf(a) !== want) bad.push(`${r.id} #${i + 1}: картка ${cardOf(a)}, очікувалась ${want}`);
      if ('items' in a) for (const it of a.items ?? []) if (!passes({ plan, date, foods, entries: [] }, it)) bad.push(`${r.id} #${i + 1}: «${it.name}» не проходить план`);
      if ('error' in a && a.error) bad.push(`${r.id} #${i + 1}: помилка — ${'text' in a ? a.text : ''}`);
    }
  }
  mkdirSync('eval-results', { recursive: true }); // not test-results: Playwright empties that
  writeFileSync('eval-results/concierge-chat-eval.txt', [...out, '', bad.length ? 'НЕ ПРОЙШЛО:' : 'Усі fixed-рядки пройшли.', ...bad].join('\n'));
  console.log(out.join('\n'));
  expect(bad).toEqual([]);
}, 900_000);
