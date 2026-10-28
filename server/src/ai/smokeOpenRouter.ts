/** Explicit operator-only smoke test. Never sends patient information. */
import { z } from 'zod';
import { AiGateway } from './gateway.ts';
import { openRouterProvider } from './openrouter.ts';

const model = process.env.OPENROUTER_SMOKE_MODEL;
const key = process.env.OPENROUTER_API_KEY;
if (!model || !key) {
  console.error('Set OPENROUTER_API_KEY and OPENROUTER_SMOKE_MODEL in the server environment');
  process.exitCode = 2;
} else {
  const gateway = new AiGateway({
    general_assistant: { provider: 'openrouter', model, dataClass: 'general' },
  }, { openrouter: openRouterProvider({ apiKey: key, retries: 0, timeoutMs: 20_000 }) });
  try {
    const output = await gateway.structured({
      task: 'general_assistant',
      schema: z.object({ category: z.enum(['fruit', 'vegetable']) }),
      system: 'Classify the item. Reply in the required JSON schema only.',
      content: 'Synthetic test item: apple',
      maxTokens: 60,
      permittedProviders: ['openrouter'],
    });
    if (output.result === 'refused') throw new Error('Model refused synthetic test');
    if (output.result.category !== 'fruit') throw new Error('Unexpected model output');
    console.log(JSON.stringify({ ok: true, provider: output.usage.provider, model: output.usage.model,
      inputTokens: output.usage.input, outputTokens: output.usage.output, costUsd: output.usage.costUsd ?? null }));
  } catch (error) {
    console.error('Synthetic OpenRouter smoke failed:', error instanceof Error ? error.message : 'unknown error');
    process.exitCode = 1;
  }
}
