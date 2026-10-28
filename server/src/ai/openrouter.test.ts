import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AiGateway } from './gateway.ts';
import { openRouterProvider } from './openrouter.ts';

const schema = z.object({ answer: z.string() });
const ok = (content: unknown, extra = {}) => new Response(JSON.stringify({ model: 'vendor/model', choices: [{ message: { content: JSON.stringify(content) } }],
  usage: { prompt_tokens: 10, completion_tokens: 4, cost: 0.0002 }, ...extra }), { status: 200 });
const routes = { meal_generation: { provider: 'openrouter', model: 'vendor/model', dataClass: 'general' },
  medical_document: { provider: 'openrouter', model: 'vendor/model', dataClass: 'medical' } } as const;
const req = (task: 'meal_generation' | 'medical_document') => ({ task, schema, system: 's', content: 'synthetic', maxTokens: 50, permittedProviders: ['openrouter'] as const });
const gw = (fetchFn: typeof fetch, apiKey: string | undefined, retries = 1) =>
  new AiGateway(routes, { openrouter: openRouterProvider({ apiKey, fetch: fetchFn, retries }) });

describe('OpenRouter adapter', () => {
  it('returns validated result with usage and cost; disables upstream fallback', async () => {
    const f = vi.fn(async () => ok({ answer: 'x' }));
    const r = await gw(f as never, 'k').structured(req('meal_generation'));
    expect(r.result).toEqual({ answer: 'x' });
    expect(r.usage).toMatchObject({ provider: 'openrouter', input: 10, output: 4, costUsd: 0.0002 });
    const sent = JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(sent.provider.allow_fallbacks).toBe(false);
    expect(sent.model).toBe('vendor/model');
  });

  it('refuses medical data and a missing key before any request', async () => {
    const f = vi.fn();
    await expect(gw(f as never, 'k').structured(req('medical_document'))).rejects.toMatchObject({ code: 'medical_blocked' });
    await expect(gw(f as never, undefined).structured(req('meal_generation'))).rejects.toMatchObject({ code: 'no_key' });
    expect(f).not.toHaveBeenCalled();
  });

  it('retries the same model once on 5xx, then fails; 4xx is not retried', async () => {
    const f5 = vi.fn(async () => new Response('', { status: 503 }));
    await expect(gw(f5 as never, 'k').structured(req('meal_generation'))).rejects.toMatchObject({ code: 'http' });
    expect(f5).toHaveBeenCalledTimes(2);
    const f4 = vi.fn(async () => new Response('', { status: 400 }));
    await expect(gw(f4 as never, 'k').structured(req('meal_generation'))).rejects.toMatchObject({ code: 'http' });
    expect(f4).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid JSON and schema violations; reports refusals', async () => {
    await expect(gw((async () => ok({ wrong: 1 })) as never, 'k').structured(req('meal_generation'))).rejects.toMatchObject({ code: 'invalid_output' });
    await expect(gw((async () => new Response(JSON.stringify({ choices: [{ message: { content: 'nope' } }] }))) as never, 'k').structured(req('meal_generation')))
      .rejects.toMatchObject({ code: 'invalid_output' });
    const refused = async () => new Response(JSON.stringify({ choices: [{ message: { refusal: 'no' } }] }));
    expect((await gw(refused as never, 'k').structured(req('meal_generation'))).result).toBe('refused');
  });

  it('maps a network timeout to a controlled error', async () => {
    const f = vi.fn(async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); });
    await expect(gw(f as never, 'k', 0).structured(req('meal_generation'))).rejects.toMatchObject({ code: 'timeout' });
  });
  it('never retries an ambiguous network failure even when retries are configured', async () => {
    const f = vi.fn(async () => { throw new TypeError('connection reset after request'); });
    await expect(gw(f as never, 'k', 3).structured(req('meal_generation'))).rejects.toMatchObject({ code: 'http' });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('does not retry by default after an HTTP 503', async () => {
    const f = vi.fn(async () => new Response('', { status: 503 }));
    await expect(gw(f as never, 'k', 0).structured(req('meal_generation'))).rejects.toMatchObject({ code: 'http' });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('rejects truncated JSON even if it happens to parse', async () => {
    const f = vi.fn(async () => ok({ answer: 'partial' }, { choices: [{ finish_reason: 'length', message: { content: '{"answer":"partial"}' } }] }));
    await expect(gw(f as never, 'k').structured(req('meal_generation'))).rejects.toMatchObject({ code: 'invalid_output' });
  });

  it('treats filtered completion as refusal', async () => {
    const f = vi.fn(async () => ok({ answer: 'hidden' }, { choices: [{ finish_reason: 'content_filter', message: { content: null } }] }));
    const response = await gw(f as never, 'k').structured(req('meal_generation'));
    expect(response.result).toBe('refused');
  });

});
