// A photo of a medicine package → its name and strength as printed (SPEC.md D89). The app finds it in the register and
// shows it to confirm; the strength on the box is information only — the dose is always the doctor's.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { structured, type Effort, type Usage } from './claude.ts';

export const MedboxResult = z.object({
  readable: z.boolean().describe('Чи це упаковка лікарського засобу і чи видно назву'),
  name: z.string().nullable().describe('Торгова назва, як на упаковці, без дозування: «Нурофєн Форте»'),
  inn: z.string().nullable().describe('Діюча речовина (МНН), якщо надрукована: «ібупрофен»'),
  strength: z.string().nullable().describe('Дозування однієї одиниці, як надруковано: «400 мг»'),
  form: z.string().nullable().describe('Форма: «таблетки», «капсули», «сироп»'),
  note: z.string().nullable().describe('Коротко українською, що не видно; інакше null'),
});
export type MedboxResult = z.infer<typeof MedboxResult>;
export type MedboxReader = (image: string) => Promise<{ result: MedboxResult | 'refused'; usage?: Usage }>;

const SYSTEM = `На фото — упаковка ліків. Перепиши торгову назву, діючу речовину, дозування однієї одиниці й форму, як надруковано.
Нічого не вигадуй і не радь: не пиши, як приймати. Якщо це не упаковка ліків або назву не видно — readable = false.`;

export function claudeMedbox(opts: { model: string; effort: Effort; client?: Anthropic }): MedboxReader {
  const client = opts.client ?? new Anthropic({ timeout: 60_000, maxRetries: 1 });
  return (image) => structured(client, { model: opts.model, effort: opts.effort, maxTokens: 800, system: SYSTEM, schema: MedboxResult,
    content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } }] });
}
