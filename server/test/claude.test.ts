import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { batchParamsOf, parseOutput, requestOf, structured } from '../src/claude.ts';

const fake = (reply: Record<string, unknown>) => {
  let sent: Record<string, unknown> | undefined;
  const client = { beta: { messages: { parse: async (req: Record<string, unknown>) => { sent = req; return reply; } } } } as unknown as Anthropic;
  return { client, sent: () => sent };
};
const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: null };
const opts = { model: 'claude-opus-5-5', effort: 'low' as const, maxTokens: 1000, system: 'S', schema: z.object({ a: z.number() }), content: 'hi' };

describe('one structured call (review #9)', () => {
  it('asks with the fallback and the schema; returns the parsed answer and the tokens', async () => {
    const f = fake({ model: 'claude-opus-5-5', usage, stop_reason: 'end_turn', parsed_output: { a: 1 } });
    expect(await structured(f.client, opts)).toEqual({ result: { a: 1 }, usage: { model: 'claude-opus-5-5', input: 100, output: 20, cacheRead: 50 } }); // D123: a cache read apart from input
    expect(f.sent()).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 1000, fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'],
      system: [{ type: 'text', text: 'S', cache_control: { type: 'ephemeral' } }], output_config: { effort: 'low' }, messages: [{ role: 'user', content: 'hi' }] });
  });

  it('a refusal is «refused», with its tokens; no answer is an error', async () => {
    expect((await structured(fake({ model: 'm', usage, stop_reason: 'refusal', parsed_output: null }).client, opts)).result).toBe('refused');
    await expect(structured(fake({ model: 'm', usage, stop_reason: 'max_tokens', parsed_output: null }).client, opts)).rejects.toThrow('max_tokens');
  });

  it('D201: the instructions are cached; with a reference the breakpoint goes after it', () => {
    expect(requestOf({ ...opts, reference: 'R' }).system).toEqual([{ type: 'text', text: 'S' }, { type: 'text', text: 'R', cache_control: { type: 'ephemeral' } }]);
  });

  it('D201: the batch gets the same request — no fallback, the format as plain JSON schema — and parses with the same schema', () => {
    const live = requestOf(opts), batch = batchParamsOf(opts);
    expect(batch).not.toHaveProperty('fallbacks');
    expect({ ...batch, output_config: undefined }).toEqual({ ...live, output_config: undefined });
    expect(batch.output_config).toEqual({ effort: 'low', format: { type: 'json_schema', schema: live.output_config.format.schema } });
    expect(JSON.parse(JSON.stringify(batch.output_config.format))).toEqual(batch.output_config.format); // no function inside
    expect(parseOutput(opts.schema, '{"a":2}')).toEqual({ a: 2 });
    expect(parseOutput(opts.schema, '{"a":"x"}')).toBeUndefined();
    expect(parseOutput(opts.schema, 'not json')).toBeUndefined();
  });
});
