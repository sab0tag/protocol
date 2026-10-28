import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AiGateway } from './gateway.ts';
import { anthropicProvider } from './anthropic.ts';

vi.mock('../claude.ts', () => ({
  structured: vi.fn(async (_client, opts) => ({
    result: { answer: 'ok' },
    usage: { model: opts.model, input: 12, output: 3 },
  })),
}));

describe('Anthropic gateway adapter', () => {
  it('preserves structured result and usage model', async () => {
    const gateway = new AiGateway({
      general_assistant: { provider: 'anthropic', model: 'test-claude', dataClass: 'general' },
    }, { anthropic: anthropicProvider({ client: {} as never }) });
    const result = await gateway.structured({
      task: 'general_assistant', schema: z.object({ answer: z.string() }),
      system: 'Test', content: 'Hello', maxTokens: 100,
      permittedProviders: ['anthropic'],
    });
    expect(result.result).toEqual({ answer: 'ok' });
    expect(result.usage).toMatchObject({ provider: 'anthropic', model: 'test-claude', input: 12, output: 3 });
  });
});
