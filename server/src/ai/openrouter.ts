import { z } from 'zod';
import type { AiProvider, AiRequest, AiResult, AiRoute } from './gateway.ts';

export class OpenRouterError extends Error {
  readonly code: 'no_key' | 'medical_blocked' | 'http' | 'timeout' | 'invalid_output';
  constructor(code: OpenRouterError['code'], message: string) { super(message); this.code = code; }
}

export interface OpenRouterOptions {
  apiKey: string | undefined;
  /** Upstream providers OpenRouter may use; fallback to others is always disabled. */
  allowedUpstream?: readonly string[];
  timeoutMs?: number;
  /** Retries of the same model on 429/5xx only. Never switches model (no costlier fallback). */
  retries?: number;
  baseUrl?: string;
  fetch?: typeof fetch;
}

/** General-data tasks only: real medical content must not be routed here until separately approved (OR-10). */
export function openRouterProvider(options: OpenRouterOptions): AiProvider {
  const doFetch = options.fetch ?? fetch;
  const url = `${options.baseUrl ?? 'https://openrouter.ai/api/v1'}/chat/completions`;
  return {
    id: 'openrouter',
    async structured<S extends z.ZodType>(route: AiRoute, request: AiRequest<S>): Promise<AiResult<z.infer<S>>> {
      if (route.provider !== 'openrouter') throw new Error('Wrong provider route');
      if (route.dataClass !== 'general') throw new OpenRouterError('medical_blocked', 'Medical data is not allowed on OpenRouter');
      if (!options.apiKey) throw new OpenRouterError('no_key', 'OpenRouter key is not configured');
      const body = JSON.stringify({
        model: route.model,
        max_tokens: request.maxTokens,
        messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.content }],
        response_format: { type: 'json_schema', json_schema: { name: 'result', strict: true, schema: z.toJSONSchema(request.schema) } },
        provider: { allow_fallbacks: false, ...(options.allowedUpstream ? { only: options.allowedUpstream } : {}) },
        usage: { include: true },
      });
      const attempts = 1 + Math.max(0, options.retries ?? 1);
      let last: OpenRouterError = new OpenRouterError('http', 'OpenRouter request failed');
      for (let i = 0; i < attempts; i++) {
        let res: Response;
        try {
          res = await doFetch(url, {
            method: 'POST',
            headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' },
            body,
            signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
          });
        } catch (e) {
          last = new OpenRouterError(e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'http', 'OpenRouter unreachable');
          continue;
        }
        if (res.status === 429 || res.status >= 500) { last = new OpenRouterError('http', `OpenRouter status ${res.status}`); continue; }
        if (!res.ok) throw new OpenRouterError('http', `OpenRouter status ${res.status}`);
        const data = await res.json() as { model?: string; choices?: { message?: { content?: string; refusal?: string | null } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number } };
        const usage = { provider: 'openrouter' as const, model: data.model ?? route.model, input: data.usage?.prompt_tokens ?? 0,
          output: data.usage?.completion_tokens ?? 0, ...(data.usage?.cost !== undefined ? { costUsd: data.usage.cost } : {}) };
        const message = data.choices?.[0]?.message;
        if (message?.refusal) return { result: 'refused', usage };
        let parsed: unknown;
        try { parsed = JSON.parse(message?.content ?? ''); } catch { throw new OpenRouterError('invalid_output', 'Model returned invalid JSON'); }
        const checked = request.schema.safeParse(parsed);
        if (!checked.success) throw new OpenRouterError('invalid_output', 'Model output failed schema validation');
        return { result: checked.data, usage };
      }
      throw last;
    },
  };
}
