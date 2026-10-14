// One structured call to Claude, the same for every feature (photo, label, menu, workout): the server-side refusal
// fallback, the answer shaped by a zod schema, tokens for the spend counter (D36), a refusal said as 'refused'.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { z } from 'zod';

export interface Usage { model: string; input: number; output: number }
export type Effort = 'low' | 'medium' | 'high';

/** Tokens of a response, cache writes and reads counted as input (D36: the spend counter is an estimate). */
export function usageOf(r: { model: string; usage: { input_tokens: number; output_tokens: number;
  cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null } }): Usage {
  const u = r.usage;
  return { model: r.model, input: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), output: u.output_tokens };
}

export async function structured<S extends z.ZodType>(client: Anthropic, opts: {
  model: string; effort: Effort; maxTokens: number; system: string; schema: S; content: string | BetaContentBlockParam[];
}): Promise<{ result: z.infer<S> | 'refused'; usage: Usage }> {
  const response = await client.beta.messages.parse({
    model: opts.model,
    max_tokens: opts.maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: opts.system,
    output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
    messages: [{ role: 'user', content: opts.content }],
  });
  const usage = usageOf(response);
  if (response.stop_reason === 'refusal') return { result: 'refused', usage };
  if (!response.parsed_output) throw new Error(`no parsed output (stop_reason ${response.stop_reason})`);
  return { result: response.parsed_output as z.infer<S>, usage };
}
