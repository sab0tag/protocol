import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import { structured, type Effort } from '../claude.ts';
import type { AiProvider, AiRequest, AiResult, AiRoute } from './gateway.ts';

/** Existing Anthropic structured-output behavior behind the provider-neutral contract. */
export function anthropicProvider(options: { client?: Anthropic; effort?: Effort } = {}): AiProvider {
  const client = options.client ?? new Anthropic({ timeout: 120_000, maxRetries: 1 });
  return {
    id: 'anthropic',
    async structured<S extends z.ZodType>(route: AiRoute, request: AiRequest<S>): Promise<AiResult<z.infer<S>>> {
      if (route.provider !== 'anthropic') throw new Error('Wrong provider route');
      const response = await structured(client, {
        model: route.model,
        effort: options.effort ?? 'medium',
        maxTokens: request.maxTokens,
        system: request.system,
        schema: request.schema,
        content: request.content,
      });
      return { result: response.result, usage: { ...response.usage, provider: 'anthropic' } };
    },
  };
}
