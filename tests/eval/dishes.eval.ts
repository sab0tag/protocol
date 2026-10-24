// D123: «Мої страви — додати списком», live — the corpus's ways that go to the model (tests/fixtures/dish-lists.yaml) through the
// same path the app takes, and the spend: a pack of 10 dishes against the same 10 one by one, each in a throwaway vault of its
// own, read off the spend counter (D36). Not in `npm test` (network, a model, money): `npm run eval:dishes`.
import { expect, test } from 'vitest';
import { parse } from 'yaml';
import corpus from '../fixtures/dish-lists.yaml?raw';
import { FOODS } from '../../src/data/foods';
import { RECIPES } from '../../src/data/recipes';
import { breakdown } from '../../src/domain/dishBreakdown';
import { packs, parseText, tally, wayOf } from '../../src/domain/dishList';
import { dishItem } from '../../src/domain/recipes';
import { createVault, dishBreakdown, dishesBreakdown, usage } from '../../src/sync/api';
import { deriveKeys, newCode, parseCode } from '../../src/sync/crypto';

const ctx = { foods: FOODS, recipes: RECIPES, harch: [], dishItem };
const names = FOODS.map((f) => f.name);
const vault = async () => { const k = await deriveKeys(parseCode(newCode())!); await createVault(k); return k; };
const TEN = ['Гречка з опеньками — гречка 150 г, опеньки 100 г, цибуля, олія', 'Салат з тунцем — тунець, яйце, огірок', 'Плов — рис 200 г, курка 300 г, морква 100 г, на 3 порції',
  'Вареники з картоплею — тісто, картопля, цибуля, на 2 порції', 'Лаваш-рол — лаваш, курка 120 г, огірок, йогуртовий соус', 'Суп курячий — курка 200 г, картопля 300 г, морква, вермішель 50 г, на 4 порції',
  'Запіканка сирна — сир 5 % 500 г, 2 яйця, манка 3 ст. л., на 4 порції', 'Овочеве рагу — кабачок, баклажан, перець, помідор, олія', 'Курка з броколі — курка 150 г, броколі 200 г, соєвий соус',
  'Омлет з шпинатом — 3 яйця, шпинат 50 г, молоко 50 мл'];

test('the corpus: what goes to the model, in how many requests, and what comes back', async () => {
  const keys = await vault();
  for (const c of (parse(corpus) as { id: string; input?: string; expect: Record<string, unknown> }[]).filter((x) => x.input)) {
    const rows = parseText(c.input!).rows, ways = rows.map((r) => wayOf(r, ctx));
    const toAi = rows.filter((_, i) => ways[i]!.kind === 'ai');
    let requests = 0;
    for (const p of packs(toAi)) {
      requests += 1;
      const r = await dishesBreakdown(keys, p.map((x) => ({ key: x.key, text: x.text })), names);
      for (const x of p) {
        const d = r.dishes.find((y) => y.key === x.key);
        console.log(c.id, x.name, d ? (d.readable ? breakdown(d, FOODS).map((l) => `${l.food?.name ?? `~${l.said}`} ${l.grams}`).join(', ') : 'не страва') : 'НЕМАЄ');
        expect(d?.readable, `${c.id}: ${x.name}`).toBe(true);
      }
    }
    expect(requests).toBe(tally(ways).requests);
  }
});

test('the spend: a pack of 10 against the same 10 one by one; the second single one reads the cache', async () => {
  const one = await vault(), pack = await vault();
  const usd = async (k: Awaited<ReturnType<typeof vault>>) => ((await usage(k)).usdMicro ?? 0) / 1e6;
  const steps: number[] = [];
  for (const text of TEN) { const before = await usd(one); await dishBreakdown(one, text, names); steps.push(Math.round(((await usd(one)) - before) * 1000) / 1000); }
  const t0 = Date.now();
  await dishesBreakdown(pack, TEN.map((text, i) => ({ key: `d${i}`, text })), names);
  const single = await usd(one), batch = await usd(pack);
  console.log(`10 одиночних: $${single} (по кроках: ${steps.join(', ')}); пачка з 10: $${batch} за ${Math.round((Date.now() - t0) / 1000)} с`);
  expect(batch).toBeLessThan(single);
  expect(steps[1]!).toBeLessThan(steps[0]!); // the base's names read from the cache the second time
});
