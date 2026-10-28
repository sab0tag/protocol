import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AiGateway, AiRoutingError, chooseRoute } from './gateway.ts';

const routes = {
  medical_document: { provider: 'anthropic', model: 'medical-model', dataClass: 'medical' },
  meal_generation: { provider: 'openrouter', model: 'budget-model', dataClass: 'general' },
} as const;

describe('AI gateway policy', () => {
  it('blocks unapproved providers before dispatch', async () => {
    const call = vi.fn();
    const gateway = new AiGateway(routes, { openrouter: { id: 'openrouter', structured: call } });
    await expect(gateway.structured({ task: 'meal_generation', schema: z.object({ ok: z.boolean() }),
      system: '', content: 'test', maxTokens: 100, permittedProviders: ['anthropic'] }))
      .rejects.toThrow(AiRoutingError);
    expect(call).not.toHaveBeenCalled();
  });

  it('requires a medical-class route for medical tasks', () => {
    expect(() => chooseRoute('medical_document', {
      medical_document: { provider: 'openrouter', model: 'x', dataClass: 'general' },
    }, ['openrouter'])).toThrow(AiRoutingError);
  });

  it('dispatches approved general tasks and returns usage', async () => {
    const call = vi.fn().mockResolvedValue({ result: { ok: true },
      usage: { provider: 'openrouter', model: 'budget-model', input: 10, output: 5 } });
    const gateway = new AiGateway(routes, { openrouter: { id: 'openrouter', structured: call } });
    const response = await gateway.structured({ task: 'meal_generation', schema: z.object({ ok: z.boolean() }),
      system: '', content: 'test', maxTokens: 100, permittedProviders: ['openrouter'] });
    expect(response.result).toEqual({ ok: true });
    expect(response.usage.model).toBe('budget-model');
    expect(call).toHaveBeenCalledOnce();
  });
});
