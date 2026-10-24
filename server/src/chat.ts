// The assistant's chat (SPEC.md D117) — the concierge's scenario «розмова». The person asks in words («що добрати до вечора?»,
// «у мене вдома лише яйця і гречка», «можна мені банан?»); the model answers in a few plain sentences and may name up to
// three foods of the person's own base. It sits between two checks of the code: it gets the day's numbers and the plan's
// rules ready-made, and what it says is checked on the way out — a sentence with a number is dropped (the app shows the
// numbers, counted by itself), a name not in the base is dropped, and the app runs every food through the plan's check
// before the person sees it. A question on medicines, symptoms or changing the plan is answered by the app's own words.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { structured, type Effort, type Usage } from './claude.ts';

export const PROMPT_CHAT = 'concierge-chat-1';
export const TOPICS = ['food', 'medicine', 'symptoms', 'plan', 'other'] as const;

// flat, no nullables (D102); the base's names are an enum — a name outside it cannot be said
export function chatSchema(names: [string, ...string[]]) {
  return z.object({
    topic: z.enum(TOPICS).describe('food — їжа, добір, що можна з’їсти; medicine — ліки, доза, пропуск, сумісність; symptoms — самопочуття, симптоми, аналізи; plan — змінити ціль, обмеження чи дієту; other — інше'),
    text: z.string().describe('2–4 короткі речення українською, звертання на «ви». БЕЗ ЖОДНИХ ЦИФР і чисел — кількості й КБЖУ покаже застосунок'),
    items: z.array(z.object({
      name: z.enum(names),
      grams: z.number().describe('Звичайна порція цього продукту в грамах'),
    })).describe('До 3 продуктів чи страв зі списку, лише якщо людина питає, що з’їсти; інакше порожньо'),
  });
}
export interface ChatResult { topic: (typeof TOPICS)[number]; text: string; items: { name: string; grams: number }[] }
export interface ChatInput { text: string; history: { role: 'user' | 'assistant'; text: string }[]; names: string[]; context: unknown }
export type ChatReader = (input: ChatInput) => Promise<{ result: ChatResult | 'refused'; usage?: Usage }>;

const SYSTEM = `Ти — помічник у застосунку, що допомагає людині виконувати план свого лікаря в харчуванні. Лікар вирішує — ти лише допомагаєш виконати його план.
Відповідай українською, на «ви», коротко й по-людськи, 2–4 речення. Ніколи не пиши цифр і чисел: кількості, грами, калорії й відсотки застосунок покаже сам, порахувавши.
Можна: підказати, що з’їсти, щоб добрати ціль плану (лише ту, що є в плані); що приготувати з того, що є вдома; чи підходить продукт під обмеження плану — словами, спираючись на правила плану, які тобі дано.
Пропонуй лише продукти й страви зі списку бази (items), не більше трьох, ті, що швидко приготувати й що проходять обмеження плану. Якщо в плані немає цілі — не радь її добирати.
Не можна: міняти чи пропонувати міняти план, цілі, обмеження, дієту чи дози; радити щось про ліки (дозу, пропуск, сумісність, чи можна з їжею) — тоді topic = medicine; тлумачити симптоми, самопочуття чи аналізи — тоді topic = symptoms; пропонувати добавки чи спортпит, яких немає в плані; осуджувати. Що з’їдено, записує людина сама — ти нічого не записуєш.`;

export function claudeChat(opts: { model: string; effort: Effort; client?: Anthropic }): ChatReader {
  const client = opts.client ?? new Anthropic({ timeout: 45_000, maxRetries: 1 });
  return ({ text, history, names, context }) => structured(client, { model: opts.model, effort: opts.effort, maxTokens: 1200, system: SYSTEM,
    schema: chatSchema([...new Set(names)] as [string, ...string[]]),
    content: `Стан дня й план (пораховано застосунком):\n${JSON.stringify(context)}\n\nРозмова досі:\n${history.map((m) => `${m.role === 'user' ? 'Людина' : 'Помічник'}: ${m.text}`).join('\n') || '—'}\n\nЛюдина: ${text}\n\nБаза (точні назви):\n${names.join('\n')}` });
}

/** The code's check on the way out: no sentence with a number (boundary 6), only the base's names, sane grams. */
// R04: a number said in words is a number — «двісті грамів», «півтори порції», «дві тисячі калорій» go like «200 г»; so do the
// words of an amount («грам», «ккал», «відсот») with no number. Whole words only (Cyrillic — no \b in JavaScript).
const NUMBER_WORDS = /(?<!\p{L})(нуль|один|одна|одне|одного|одну|два|дві|двох|три|трьох|чотири|чотирьох|п[’']ять|шість|сім|вісім|дев[’']ять|десять|\p{L}+надцять|двадцять|тридцять|сорок|п[’']ятдесят|шістдесят|сімдесят|вісімдесят|дев[’']яносто|сто|двісті|триста|чотириста|п[’']ятсот|\p{L}+сот|тисяч\p{L}*|пів|півтор\p{L}*|половин\p{L}*|чверт\p{L}*|грам\p{L}*|кілограм\p{L}*|калорі\p{L}*|ккал|кілокалорі\p{L}*|відсот\p{L}*|мілілітр\p{L}*|літр\p{L}*)(?![\p{L}’'])/iu;

export function checked(r: ChatResult, names: string[]): { result: ChatResult; numbersDropped: number } {
  const known = new Set(names);
  const sentences = r.text.split(/(?<=[.!?…])\s+/u).filter(Boolean);
  const kept = sentences.filter((x) => !/\d/u.test(x) && !NUMBER_WORDS.test(x));
  const items = r.items.filter((x) => known.has(x.name)).slice(0, 3)
    .map((x) => ({ name: x.name, grams: Math.round(Math.min(600, Math.max(5, Number.isFinite(x.grams) ? x.grams : 100))) }));
  return { result: { topic: r.topic, text: kept.join(' '), items: r.topic === 'food' ? items : [] }, numbersDropped: sentences.length - kept.length };
}
