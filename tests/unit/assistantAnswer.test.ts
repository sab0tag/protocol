// D166: the one answer, as «Помічник» and the field on «Сьогодні» both run it — the corpus's danger and chat rows through the real
// path, the model replaced by the reply the row says it would give.
vi.mock('../../src/sync/api', async (original) => ({ ...await original<typeof import('../../src/sync/api')>(), assistantChat: vi.fn() }));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import corpus from '../fixtures/concierge-cases.yaml?raw';
import { answer, eveningSnack, topupReply, type Day } from '../../src/app/assistantAnswer';
import { FOODS } from '../../src/data/foods';
import { RECIPES } from '../../src/data/recipes';
import { emptyPlan, examplePlan } from '../../src/data/seed.example';
import type { Topic } from '../../src/domain/assistant';
import type { Plan } from '../../src/domain/types';
import { assistantChat } from '../../src/sync/api';

interface Row { id: string; scenario: string; input?: string; say?: string; status: string; plan_targets?: Record<string, number>; plan_constraints?: string[]
  model_reply?: { topic: Topic; text: string; items?: string[] }; expect: { danger_card?: boolean; card?: 'danger-103' | 'crisis-7333' | 'none'; model_called?: boolean } }
const rows = (parse(corpus) as Row[]).filter((r) => r.status === 'fixed');
const foods = new Map(FOODS.map((f) => [f.id, f]));
const date = '2026-11-17';
const day = (plan: Plan): Day => ({ plan, foods, recipes: RECIPES, all: [], date });
const chat = vi.mocked(assistantChat);
const reply = (r: { topic: Topic; text: string; items?: { name: string; grams: number }[] }) => chat.mockResolvedValue({ items: [], ...r } as Awaited<ReturnType<typeof assistantChat>>);

beforeEach(() => { chat.mockReset(); reply({ topic: 'food', text: 'Гречка з яйцем.' }); });

describe('the answer, one for «Помічник» and the field (D166)', () => {
  it.each(rows.filter((r) => r.scenario === 'danger'))('danger row $id: the 103 card, no model', async (row) => {
    const a = await answer(row.input!, day(examplePlan()), { consent: true, log: false, history: [] });
    expect('card' in a && a.card === 'danger').toBe(!!row.expect.danger_card);
    if (row.expect.danger_card) expect(chat).not.toHaveBeenCalled();
  });

  it.each(rows.filter((r) => r.scenario === 'chat_route'))('chat row $id: the card and the model as the corpus says', async (row) => {
    const p = { ...emptyPlan(), ...(row.plan_targets ? { targets: row.plan_targets } : {}),
      constraints: (row.plan_constraints ?? []).map((tag) => ({ id: tag, tag: tag as 'glycemic', title: tag, reason: '', source: '', active: true })) };
    if (row.model_reply) reply({ topic: row.model_reply.topic, text: row.model_reply.text });
    const a = await answer(row.say!, day(p), { consent: true, log: false, history: [] });
    const card = 'card' in a ? (a.card === 'crisis' ? 'crisis-7333' : 'danger-103') : 'none';
    if (row.expect.card !== undefined) expect(card).toBe(row.expect.card);
    if (row.expect.model_called !== undefined) expect(chat.mock.calls.length > 0).toBe(row.expect.model_called);
  });

  it('asks consent before the model, and only then', async () => {
    expect(await answer('у мене вдома лише гречка — що приготувати?', day(examplePlan()), { consent: false, log: false, history: [] })).toEqual({ consent: true });
    expect(chat).not.toHaveBeenCalled();
  });

  it('«що добрати?» is the code’s, with no model and no consent', async () => {
    const a = await answer('що добрати до вечора?', day(examplePlan()), { consent: false, log: false, history: [] });
    expect(a).toEqual(topupReply(day(examplePlan())));
    expect(chat).not.toHaveBeenCalled();
  });

  it('a food failing the plan is neither shown nor kept; the rest goes to the evening as a planned snack', async () => {
    reply({ topic: 'food', text: 'Вечеря: гречка з яйцем і молоко.', items: [{ name: 'Яйце варене', grams: 110 }, { name: 'Молоко 2,5 %', grams: 200 }] });
    const a = await answer('що на вечерю, якщо вдома лише гречка?', day(examplePlan()), { consent: true, log: false, history: [] });
    if (!('text' in a)) throw new Error('words expected');
    expect(a.items?.map((x) => x.name)).toEqual(['Яйце варене']); // lactose in the example plan
    const snack = eveningSnack(a.items![0]!, day(examplePlan()));
    expect(snack).toMatchObject({ kind: 'meal', status: 'planned', items: [{ name: 'Яйце варене' }] });
    expect(snack!.at.startsWith(`${date}T`)).toBe(true);
  });

  it('the talk before a card never goes with the next question (D130)', async () => {
    await answer('а що на вечерю?', day(examplePlan()), { consent: true, log: false, history: [
      { id: '1', role: 'user', text: 'тисне в грудях' }, { id: '2', role: 'assistant', text: '', card: 'danger' }, { id: '3', role: 'user', text: 'гречка?' }] });
    expect(JSON.stringify(chat.mock.calls[0]![1].history)).not.toMatch(/грудях/);
  });
});
