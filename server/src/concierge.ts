// The concierge (SPEC.md D91), scenario 1: a meal line the base did not find → up to 3 of the base's own names it is
// most like. The model only picks from the list it is given (an enum); the app counts the grams, checks the plan and adds
// nothing until the person taps. No advice, no doses, no reading of symptoms.
import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { structured, type Effort, type Usage } from './claude.ts';

export const PROMPT_NOT_FOUND = 'concierge-not-found-1';
export function notFoundSchema(names: [string, ...string[]]) {
  return z.object({ candidates: z.array(z.enum(names)).describe('До 3 найближчих назв зі списку, найближча перша; порожньо, якщо це не їжа чи нічого не схоже') });
}
export type NotFoundReader = (text: string, names: string[]) => Promise<{ result: { candidates: string[] } | 'refused'; usage?: Usage }>;

const SYSTEM = `Людина записує, що з’їла, і написала страву чи продукт, якого немає в базі застосунку. Обери зі списку бази до 3 найближчих за складом і способом приготування — найближчий перший.
Лише назви зі списку. Якщо це не їжа або нічого не схоже — порожній список. Нічого не радь і не коментуй.`;

export function claudeNotFound(opts: { model: string; effort: Effort; client?: Anthropic }): NotFoundReader {
  const client = opts.client ?? new Anthropic({ timeout: 30_000, maxRetries: 1 });
  return (text, names) => structured(client, { model: opts.model, effort: opts.effort, maxTokens: 400, system: SYSTEM,
    schema: notFoundSchema([...new Set(names)] as [string, ...string[]]), content: `Що написала людина: «${text}»\n\nБаза:\n${names.join('\n')}` });
}

// ---------------------------------------------------------------- the log (D91)
/** A pseudonymous label for the export: no vault id, no name — the same person reads as the same label. */
export const userLabel = (vault: string) => `p-${createHash('sha256').update(`concierge:${vault}`).digest('hex').slice(0, 4)}`;

/** Names in free text are replaced before the weekly export: a capitalised word that does not start a sentence
 *  («бабусин пиріжок від Олени» → «… від [ім’я]»). Abbreviations in capitals («ЩД», «ОВД») stay. */
export function scrubNames(text: string): string {
  return text.split(/(?<=[.!?])\s+/u).map((sentence) => {
    let first = true;
    return sentence.replace(/\p{L}[\p{L}’'-]*/gu, (w) => {
      const name = !first && /^\p{Lu}\p{Ll}/u.test(w);
      first = false;
      return name ? '[ім’я]' : w;
    });
  }).join(' ');
}
