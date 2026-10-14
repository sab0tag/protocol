// A photo of a package's nutrition table → a food per 100 g (SPEC.md D45). The person checks the numbers and
// saves it to «Мої продукти»; nothing is saved by the model.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { structured, type Effort, type Usage } from './claude.ts';

export const LabelResult = z.object({
  readable: z.boolean().describe('Чи вдалося прочитати таблицю харчової цінності'),
  name: z.string().describe('Назва продукту українською, коротко, як на упаковці: «Йогурт грецький 2 %»'),
  per100g: z.object({
    kcal: z.number(), protein: z.number(), fat: z.number(), carbs: z.number(),
    calciumMg: z.number().nullable().describe('Кальцій, мг на 100 г, якщо вказано; інакше null'),
  }).describe('На 100 г (або 100 мл). Якщо на упаковці лише на порцію — перерахуй на 100 г'),
  servingG: z.number().nullable().describe('Маса однієї порції чи упаковки, г, якщо вказано; інакше null'),
  note: z.string().nullable().describe('Коротко українською, якщо щось не видно або перераховано; інакше null'),
});
export type LabelResult = z.infer<typeof LabelResult>;
export type LabelReader = (image: string) => Promise<{ result: LabelResult | 'refused'; usage?: Usage }>;

const SYSTEM = `На фото — упаковка продукту з таблицею харчової цінності. Прочитай назву продукту та харчову цінність на 100 г: енергію в ккал (не кДж), білки, жири, вуглеводи, кальцій, якщо вказано.
Якщо вказано лише на порцію — перерахуй на 100 г за масою порції. Не вигадуй: якщо таблиці не видно, readable = false і поясни в note.`;

export function claudeLabel(opts: { model: string; effort: Effort; client?: Anthropic }): LabelReader {
  const client = opts.client ?? new Anthropic({ timeout: 90_000, maxRetries: 1 });
  return (image) => structured(client, { model: opts.model, effort: opts.effort, maxTokens: 2000, system: SYSTEM, schema: LabelResult,
    content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } }] });
}
