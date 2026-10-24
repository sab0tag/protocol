import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { structured } from '../src/claude.ts';

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
      system: 'S', output_config: { effort: 'low' }, messages: [{ role: 'user', content: 'hi' }] });
  });

  it('a refusal is «refused», with its tokens; no answer is an error', async () => {
    expect((await structured(fake({ model: 'm', usage, stop_reason: 'refusal', parsed_output: null }).client, opts)).result).toBe('refused');
    await expect(structured(fake({ model: 'm', usage, stop_reason: 'max_tokens', parsed_output: null }).client, opts)).rejects.toThrow('max_tokens');
  });
});
