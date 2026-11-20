// One structured call to Claude, the same for every feature (photo, label, menu, workout): the server-side refusal
// fallback, the answer shaped by a zod schema, tokens for the spend counter (D36), a refusal said as 'refused'.
// D201: the request itself is built by `requestOf` — the live call and the eval's Batch API run get the same bytes (the batch
// only leaves out the fallback, which batches do not take), and the instructions are always marked for the prompt cache.
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

export interface StructuredOpts<S extends z.ZodType> {
  model: string; effort: Effort; maxTokens: number; system: string; schema: S; content: string | BetaContentBlockParam[];
  /** D123: a long part the same from call to call (the base's names, sorted) — after the instructions, as one cached block */
  reference?: string;
}

/** D201: the request as the API gets it. The instructions (and the reference after them) are one cached prefix: the breakpoint
 *  goes on the last of them. Under the model's minimum (512 tokens on Opus 5.5 and Sonnet 5.5) it is just not cached. */
export function requestOf<S extends z.ZodType>(o: StructuredOpts<S>) {
  const system = o.reference
    ? [{ type: 'text' as const, text: o.system }, { type: 'text' as const, text: o.reference, cache_control: { type: 'ephemeral' as const } }]
    : [{ type: 'text' as const, text: o.system, cache_control: { type: 'ephemeral' as const } }];
  return {
    model: o.model,
    max_tokens: o.maxTokens,
    system,
    output_config: { effort: o.effort, format: betaZodOutputFormat(o.schema) },
    messages: [{ role: 'user' as const, content: o.content }],
  };
}

/** D201: the same request for the Message Batches API — no fallback (batches do not take it), the format as plain JSON schema. */
export function batchParamsOf<S extends z.ZodType>(o: StructuredOpts<S>) {
  const r = requestOf(o);
  return { ...r, output_config: { effort: r.output_config.effort, format: { type: 'json_schema' as const, schema: r.output_config.format.schema } } };
}

/** D201: a batch result's text read with the same schema the live call parses with. */
export function parseOutput<S extends z.ZodType>(schema: S, text: string): z.infer<S> | undefined {
  try { const r = schema.safeParse(JSON.parse(text)); return r.success ? r.data : undefined; } catch { return undefined; }
}

export async function structured<S extends z.ZodType>(client: Anthropic, opts: StructuredOpts<S>): Promise<{ result: z.infer<S> | 'refused'; usage: Usage }> {
  const response = await client.beta.messages.parse({
    ...requestOf(opts),
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  });
  const usage = usageOf(response);
  if (response.stop_reason === 'refusal') return { result: 'refused', usage };
  if (!response.parsed_output) throw new Error(`no parsed output (stop_reason ${response.stop_reason})`);
  return { result: response.parsed_output as z.infer<S>, usage };
}
