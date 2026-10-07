// A photo of a plate → what is on it and how much (SPEC.md D32). One Claude call with structured output; the app
// matches the names to its food base and shows the result as a «Розпізнано» draft that the person confirms.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

export const PhotoItem = z.object({
  name: z.string().describe('Коротка назва українською, як людина записала б у щоденник: «гречка варена», «яйце варене»'),
  match: z.string().nullable().describe('Точна назва зі списку продуктів або страв, якщо це вона; інакше null'),
  grams: z.number().describe('Оцінка ваги цієї позиції на фото, г'),
  count: z.number().nullable().describe('Кількість штук для штучного (2 яйця, 3 скибки), інакше null'),
  cooking: z.enum(['raw', 'boiled', 'baked', 'airfryer', 'steamed', 'stewed', 'fried', 'unknown']),
  kcal: z.number().describe('Оцінка на всю порцію'),
  protein: z.number(),
  fat: z.number(),
  carbs: z.number(),
  confidence: z.enum(['high', 'medium', 'low']),
});

export const PhotoResult = z.object({
  items: z.array(PhotoItem),
  note: z.string().nullable().describe('Коротко українською, якщо щось не видно або на фото не їжа; інакше null'),
});

export type PhotoResult = z.infer<typeof PhotoResult>;
export interface PhotoInput { image: string; foods: string[]; dishes: string[] }
export interface Usage { model: string; input: number; output: number }
export type Recognizer = (input: PhotoInput) => Promise<{ result: PhotoResult | 'refused'; usage?: Usage }>;

/** Tokens of a response, cache writes and reads counted as input (D36: the spend counter is an estimate). */
export function usageOf(r: { model: string; usage: { input_tokens: number; output_tokens: number;
  cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null } }): Usage {
  const u = r.usage;
  return { model: r.model, input: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), output: u.output_tokens };
}

const SYSTEM = `Ти допомагаєш людині вести щоденник харчування за планом лікаря. На фото — її їжа.
Визнач кожну окрему позицію на тарілці (продукт, страву, напій, соус чи заправку) і оціни вагу порції в грамах за розміром тарілки, приборів, руки.
Якщо позиція є у списку продуктів чи страв людини — запиши в поле match точно ту назву зі списку. Страву зі списку (наприклад, салат) записуй однією позицією, не розбирай на інгредієнти.
КБЖУ — твоя оцінка на всю порцію. Якщо не впевнений у вазі чи складі — постав confidence low.
Не давай порад і не оцінюй, чи можна це їсти: це робить застосунок за планом лікаря.
Якщо на фото не їжа — поверни порожній список і поясни в note.`;

export function claudeRecognizer(opts: { model: string; effort: 'low' | 'medium' | 'high'; client?: Anthropic }): Recognizer {
  const client = opts.client ?? new Anthropic({ timeout: 90_000, maxRetries: 1 });
  return async ({ image, foods, dishes }) => {
    const response = await client.beta.messages.parse({
      model: opts.model,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      output_config: { effort: opts.effort, format: betaZodOutputFormat(PhotoResult) },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
          { type: 'text', text: `Продукти людини: ${foods.join('; ') || '—'}\nСтрави людини: ${dishes.join('; ') || '—'}` },
        ],
      }],
    });
    const usage = usageOf(response);
    if (response.stop_reason === 'refusal') return { result: 'refused', usage };
    if (!response.parsed_output) throw new Error(`no parsed output (stop_reason ${response.stop_reason})`);
    return { result: response.parsed_output, usage };
  };
}
