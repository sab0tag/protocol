import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { createApp, DEFAULT_LIMITS, usdMicro } from '../src/app.ts';
import { claudeDishes, type BatchResult, type DishesReader } from '../src/dishes.ts';
import { claudeDish } from '../src/dish.ts';
import { Store } from '../src/store.ts';

const VAULT = 'a'.repeat(32), AUTH = 'k'.repeat(43);
const dish = (key: string, o: Partial<BatchResult> = {}): BatchResult => ({ key, readable: true, name: key, portions: 1, note: '',
  items: [{ said: 'гречка', base: 'Гречка варена', grams: 150, amountSaid: true, kcal: 110, protein: 4, fat: 1, carbs: 21, tags: [], allergens: [] }], ...o });

function setup(reader: DishesReader, limits = DEFAULT_LIMITS) {
  const store = Store.migrated(':memory:');
  const app = createApp({ store, origins: [], dishes: reader, limits });
  const call = (body: unknown) => app.request(`/v1/vaults/${VAULT}/dishes`, { method: 'POST',
    headers: { Authorization: `Bearer ${AUTH}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { store, app, call, ready: app.request(`/v1/vaults/${VAULT}`, { method: 'PUT', headers: { Authorization: `Bearer ${AUTH}` } }) };
}
const list = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ key: `r${from + i}`, text: `Страва ${from + i} — гречка 150 г` }));

describe('a list of dishes at once (D123)', () => {
  it('one request for the pack, each answer under its key', async () => {
    const seen: unknown[] = [];
    const { call, ready } = setup(async (input) => { seen.push(input); return {
      result: { dishes: input.dishes.map((d) => dish(d.key)) }, usage: { model: 'claude-opus-5-5', input: 100, output: 100 } }; });
    await ready;
    const r = await call({ dishes: [{ key: 'a', text: 'Голубці — капуста, фарш' }, { key: 'b', text: 'Гречка з грибами: гречка, печериці' }], foods: ['Гречка варена'] });
    expect(r.status).toBe(200);
    const j = await r.json() as { dishes: BatchResult[] };
    expect(j.dishes.map((d) => d.key)).toEqual(['a', 'b']);
    expect(seen).toHaveLength(1);
  });

  it('at most 15 a request, keys once each, text cut to 400', async () => {
    let text = '';
    const { call, ready } = setup(async (input) => { text = input.dishes[0]!.text; return { result: { dishes: [] } }; });
    await ready;
    expect((await call({ dishes: list(16) })).status).toBe(400);
    expect((await call({ dishes: [{ key: 'a', text: 'x y' }, { key: 'a', text: 'z w' }] })).status).toBe(400);
    expect((await call({ dishes: [{ key: 'a', text: 'Борщ — ' + 'буряк, '.repeat(100) }] })).status).toBe(200);
    expect(text.length).toBe(400);
  });

  it('50 dishes a day — only those that reached the model, only after an answer; fewer left → 429 with how many', async () => {
    let fail = false;
    const { call, ready } = setup(async (input) => { if (fail) throw new Error('timeout'); return { result: { dishes: input.dishes.map((d) => dish(d.key)) } }; });
    await ready;
    for (let i = 0; i < 3; i += 1) expect((await call({ dishes: list(15, i * 15) })).status).toBe(200); // 45
    fail = true;
    expect((await call({ dishes: list(5, 100) })).status).toBe(502); // not counted
    fail = false;
    const r = await call({ dishes: list(10, 200) });
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: 'too_many', left: 5 });
    expect((await call({ dishes: list(5, 300) })).status).toBe(200);
    expect((await call({ dishes: list(1, 400) })).status).toBe(429);
  });
});

describe('the base list as one cached block (D123)', () => {
  const fake = (out: unknown) => {
    const calls: Record<string, unknown>[] = [];
    const client = { beta: { messages: { parse: async (p: Record<string, unknown>) => { calls.push(p);
      return { model: 'claude-opus-5-5', stop_reason: 'end_turn', parsed_output: out,
        usage: { input_tokens: 40, output_tokens: 300, cache_creation_input_tokens: calls.length === 1 ? 3000 : 0, cache_read_input_tokens: calls.length > 1 ? 3000 : 0 } }; } } } };
    return { calls, client: client as unknown as Anthropic };
  };
  it('the same bytes whatever the order the names came in, and the same schema whatever the pack size; keys mapped back', async () => {
    const { calls, client } = fake({ dishes: [dish('k2', { readable: false }), dish('k1')] });
    const read = claudeDishes({ model: 'claude-opus-5-5', effort: 'low', client });
    const r = await read({ dishes: [{ key: 'x7', text: 'Голубці — капуста, фарш' }, { key: 'y9', text: 'купити хліб — батон' }], foods: ['Яйце варене', 'Гречка варена', 'Яйце варене'] });
    await read({ dishes: [{ key: 'z', text: 'Борщ — буряк' }], foods: ['Гречка варена', 'Яйце варене'] });
    const sys = calls.map((c) => c.system as { text: string; cache_control?: unknown }[]);
    expect(sys[0]![1]).toMatchObject({ cache_control: { type: 'ephemeral' } });
    expect(sys[0]![1]!.text).toBe('Список бази (точні назви):\nГречка варена\nЯйце варене');
    expect(JSON.stringify(sys[0])).toBe(JSON.stringify(sys[1]));
    expect(JSON.stringify((calls[0]!.output_config as { format: unknown }).format)).toBe(JSON.stringify((calls[1]!.output_config as { format: unknown }).format));
    expect(r.result !== 'refused' && r.result.dishes.map((d) => d.key)).toEqual(['y9', 'x7']);
    expect(r.usage).toEqual({ model: 'claude-opus-5-5', input: 40, output: 300, cacheWrite: 3000 });
  });
  it('one dish too: the base after the instructions, cached', async () => {
    const { calls, client } = fake(dish('x'));
    await claudeDish({ model: 'claude-opus-5-5', effort: 'low', client })({ text: 'Голубці — капуста, фарш', foods: ['Б', 'А'] });
    expect((calls[0]!.system as { text: string }[])[1]!.text).toBe('Список бази (точні назви):\nА\nБ');
    expect(calls[0]!.messages).toEqual([{ role: 'user', content: 'Страва:\nГолубці — капуста, фарш' }]);
  });
  it('the spend: a cache write 1.25× input, a read at its own price ($0.20 on Opus 5.5)', () => {
    expect(usdMicro({ model: 'claude-opus-5-5', input: 0, output: 0, cacheWrite: 1_000_000 })).toBe(5_000_000);
    expect(usdMicro({ model: 'claude-opus-5-5', input: 0, output: 0, cacheRead: 1_000_000 })).toBe(200_000);
    expect(usdMicro({ model: 'claude-opus-4-8', input: 0, output: 0, cacheRead: 1_000_000 })).toBe(500_000);
  });
});
