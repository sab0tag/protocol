// A photo of a lab results form → the values on it (SPEC.md D68). The person checks every number against the paper
// and ticks what to keep; nothing is saved by the model, nothing is interpreted: no «норма», no advice.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { structured, type Effort, type Usage } from './claude.ts';

export const LabsResult = z.object({
  readable: z.boolean().describe('Чи вдалося прочитати результати аналізів'),
  date: z.string().nullable().describe('Дата забору чи результату як на бланку, YYYY-MM-DD; null, якщо не видно'),
  items: z.array(z.object({
    name: z.string().describe('Назва показника українською, як прийнято: «Феритин», «Глюкоза натще», «HbA1c»; якщо збігається з назвою зі списку людини — точно та назва'),
    value: z.number().describe('Значення числом, як на бланку (кома → крапка)'),
    unit: z.string().describe('Одиниці, як на бланку: «нг/мл», «ммоль/л», «%»'),
    reference: z.string().nullable().describe('Референсний інтервал, як на бланку; null, якщо не вказано'),
  })),
  note: z.string().nullable().describe('Коротко українською, якщо щось не видно чи сумнівно; інакше null'),
});
export type LabsResult = z.infer<typeof LabsResult>;
export type LabsReader = (image: string, names: string[]) => Promise<{ result: LabsResult | 'refused'; usage?: Usage }>;

const SYSTEM = `На фото — бланк результатів лабораторних аналізів. Перепиши кожен показник: назву, значення, одиниці й референсний інтервал, а також дату.
Нічого не вигадуй і не тлумач: не оцінюй, чи в нормі, не давай порад. Якщо значення не видно чи воно сумнівне — не додавай його й скажи про це в note. Якщо це не бланк аналізів — readable = false.`;

export function claudeLabs(opts: { model: string; effort: Effort; client?: Anthropic }): LabsReader {
  const client = opts.client ?? new Anthropic({ timeout: 90_000, maxRetries: 1 });
  return (image, names) => structured(client, { model: opts.model, effort: opts.effort, maxTokens: 4000, system: SYSTEM, schema: LabsResult,
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
      { type: 'text', text: `Назви показників, які людина вже записувала: ${names.join('; ') || '—'}` },
    ] });
}
