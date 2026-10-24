// «Мої страви» — a list at once (SPEC.md D123): up to 15 dishes in one request, the base's names once (a cached block), each
// answer keyed back to its line. The same rules as one dish (D110, D111): only what is named, nothing added. A line that is only
// a name never comes here — it stays a draft «Потрібен склад» on the phone (ТЗ v1.0, R08: no invented numbers).
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { structured, type Effort, type Usage } from './claude.ts';
import { baseList, DishResult, SYSTEM as DISH_SYSTEM } from './dish.ts';

export const PROMPT_DISHES = 'dish-batch-1';
export const MAX_BATCH = 15;
export interface BatchDish { key: string; text: string }
export type BatchResult = DishResult & { key: string };
export type DishesReader = (input: { dishes: BatchDish[]; foods: string[] }) => Promise<{ result: { dishes: BatchResult[] } | 'refused'; usage?: Usage }>;

// flat, no nullables (D102); the keys are an enum — an answer cannot come back under a line that was not asked. The enum is
// always the same 15 slots (the phone's keys are mapped to them here), so the schema — and the cached prefix — never changes
const SLOTS = Array.from({ length: MAX_BATCH }, (_, i) => `k${i + 1}`) as [string, ...string[]];
export const dishesSchema = (keys: [string, ...string[]] = SLOTS) => z.object({
  dishes: z.array(DishResult.extend({
    key: z.enum(keys).describe('Ключ страви з запиту — точно той самий'),
  })).describe('Кожна страва з запиту — один елемент, у тому ж порядку'),
});

const SYSTEM = `${DISH_SYSTEM}
Страв кілька — розклади кожну окремо і поверни кожну з її ключем (key) точно як у запиті.
Рядок, що не є стравою (напр. «купити хліб», «зателефонувати»), — readable = false.`;

export function claudeDishes(opts: { model: string; effort: Effort; client?: Anthropic }): DishesReader {
  // up to 15 breakdowns in one answer — minutes, not seconds; the app retries a failed pack itself, halved
  const client = opts.client ?? new Anthropic({ timeout: 300_000, maxRetries: 0 });
  return async ({ dishes, foods }) => {
    const { result, usage } = await structured(client, { model: opts.model, effort: opts.effort, maxTokens: 32_000, system: SYSTEM,
      schema: dishesSchema(), reference: baseList(foods),
      content: dishes.map((d, i) => `[${SLOTS[i]}]\n${d.text}`).join('\n\n') });
    if (result === 'refused') return { result, usage };
    const byKey = new Map(dishes.map((d, i) => [SLOTS[i], d]));
    return { usage, result: { dishes: result.dishes.flatMap((x) => { const d = byKey.get(x.key); return d ? [{ ...x, key: d.key }] : []; }) } };
  };
}
