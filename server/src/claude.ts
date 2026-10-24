// One structured call to Claude, the same for every feature (photo, label, menu, workout): the server-side refusal
// fallback, the answer shaped by a zod schema, tokens for the spend counter (D36), a refusal said as 'refused'.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { z } from 'zod';

/** D123: cache writes and reads apart from plain input — they cost differently (a 5-minute write 1.25×, a read 0.05–0.1×). */
export interface Usage { model: string; input: number; output: number; cacheWrite?: number; cacheRead?: number }
export type Effort = 'low' | 'medium' | 'high';

/** Tokens of a response (D36: the spend counter is an estimate; D123: cache writes and reads counted apart). */
export function usageOf(r: { model: string; usage: { input_tokens: number; output_tokens: number;
  cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null } }): Usage {
  const u = r.usage;
  return { model: r.model, input: u.input_tokens, output: u.output_tokens,
    ...(u.cache_creation_input_tokens ? { cacheWrite: u.cache_creation_input_tokens } : {}), ...(u.cache_read_input_tokens ? { cacheRead: u.cache_read_input_tokens } : {}) };
}

export async function structured<S extends z.ZodType>(client: Anthropic, opts: {
  model: string; effort: Effort; maxTokens: number; system: string; schema: S; content: string | BetaContentBlockParam[];
  /** D123: a long part the same from call to call (the base's names, sorted) — after the instructions, as one cached block;
   *  under the model's minimum (512 tokens on Opus 5.5) it just is not cached */
  reference?: string;
}): Promise<{ result: z.infer<S> | 'refused'; usage: Usage }> {
  const response = await client.beta.messages.parse({
    model: opts.model,
    max_tokens: opts.maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: opts.reference
      ? [{ type: 'text', text: opts.system }, { type: 'text', text: opts.reference, cache_control: { type: 'ephemeral' } }]
      : opts.system,
    output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
    messages: [{ role: 'user', content: opts.content }],
  });
  const usage = usageOf(response);
  if (response.stop_reason === 'refusal') return { result: 'refused', usage };
  if (!response.parsed_output) throw new Error(`no parsed output (stop_reason ${response.stop_reason})`);
  return { result: response.parsed_output as z.infer<S>, usage };
}
