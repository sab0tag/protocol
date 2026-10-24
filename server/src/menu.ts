// A day's menu under the doctor's numbers and limits (SPEC.md D33). Claude picks only names from the person's own
// food base and dishes (an enum in the output schema), with grams and times; the app recounts everything from its
// base, runs its own dish check and shows a draft — nothing is written until the person accepts it.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { structured, type Effort, type Usage } from './claude.ts';

export interface MenuInput {
  date: string;
  targets: Record<string, number | string>;
  rules: string[]; // the doctor's limits in words; the active mode's notes too
  foods: string[];
  dishes: string[];
  usual: string[]; // what the person often eats — to keep the menu familiar
  wish: string;
  avoid: string[]; // dishes of the days before in the same request (D36: a menu for 2–3 days)
}

export function menuSchema(names: [string, ...string[]]) {
  return z.object({
    meals: z.array(z.object({
      title: z.enum(['Сніданок', 'Перекус', 'Обід', 'Вечеря']),
      time: z.string().describe('HH:MM'),
      items: z.array(z.object({
        name: z.enum(names),
        grams: z.number().describe('Вага порції як з’їдено, г'),
        count: z.number().nullable().describe('Штук для штучного (2 яйця), інакше null'),
      })),
    })),
    tips: z.array(z.string()).describe('2–5 коротких практичних порад на цей день'),
  });
}

export type MenuResult = z.infer<ReturnType<typeof menuSchema>>;
export type MenuMaker = (input: MenuInput) => Promise<{ result: MenuResult | 'refused'; usage?: Usage }>;

const SYSTEM = `Ти складаєш меню на один день для людини, яка виконує план свого лікаря. Лікар вирішує — ти лише допомагаєш виконати його план.
Усе, що бачитиме людина (поради, примітки), пиши українською і звертайся на «ви».
Дотримуйся цілей (калорії, білок, вуглеводи, жири, кальцій) настільки близько, наскільки можна, і всіх обмежень лікаря. Останній прийом — не пізніше вказаного часу.
Бери лише продукти й страви з наданого списку, точно за назвою. Страву зі списку бери цілою позицією; вага — на скільки порцій її з’їдять.
Зазвичай: сніданок, обід, вечеря і 1–2 перекуси. Віддавай перевагу тому, що людина часто їсть, але не повторюй один і той самий продукт у кожному прийомі.
Поради — практичні: що приготувати заздалегідь, як розподілити воду, чим перекусити в дорозі. Не давай медичних порад, не згадуй ліки й добавки, не змінюй цілей лікаря.`;

export function claudeMenu(opts: { model: string; effort: Effort; client?: Anthropic }): MenuMaker {
  const client = opts.client ?? new Anthropic({ timeout: 180_000, maxRetries: 1 });
  return async (input) => {
    const names = [...new Set([...input.foods, ...input.dishes])].sort((a, b) => a.localeCompare(b, 'uk')) as [string, ...string[]]; // D123: the same schema every time
    const lines = [
      `Дата: ${input.date}`,
      `Цілі на день: ${Object.entries(input.targets).map(([k, v]) => `${k}=${v}`).join(', ') || 'не задано'}`,
      `Обмеження лікаря:\n${input.rules.map((r) => `- ${r}`).join('\n') || '- немає'}`,
      `Людина часто їсть: ${input.usual.join('; ') || '—'}`,
      input.wish ? `Побажання на цей день: ${input.wish}` : '',
      input.avoid.length ? `Попередні дні вже мають: ${input.avoid.join('; ')} — склади інакше, щоб не повторювалось.` : '',
    ].filter(Boolean);
    const sorted = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b, 'uk'));
    // D123: the person's dishes and foods — the long part, the same from day to day — as a cached block after the instructions
    return structured(client, { model: opts.model, effort: opts.effort, maxTokens: 8000, system: SYSTEM, schema: menuSchema(names),
      reference: `Страви людини: ${sorted(input.dishes).join('; ') || '—'}\n\nПродукти: ${sorted(input.foods).join('; ')}`, content: lines.join('\n\n') });
  };
}
