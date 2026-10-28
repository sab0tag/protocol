import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AiGateway, AiRoutingError, chooseRoute } from './gateway.ts';

const routes = {
  medical_document: { provider: 'anthropic', model: 'medical-model', dataClass: 'medical' },
  general_assistant: { provider: 'openrouter', model: 'budget-model', dataClass: 'general' },
} as const;

describe('AI gateway policy', () => {
  it('blocks unapproved providers before dispatch', async () => {
    const call = vi.fn();
    const gateway = new AiGateway(routes, { openrouter: { id: 'openrouter', structured: call } });
    await expect(gateway.structured({ task: 'general_assistant', schema: z.object({ ok: z.boolean() }),
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
    const response = await gateway.structured({ task: 'general_assistant', schema: z.object({ ok: z.boolean() }),
      system: '', content: 'test', maxTokens: 100, permittedProviders: ['openrouter'] });
    expect(response.result).toEqual({ ok: true });
    expect(response.usage.model).toBe('budget-model');
    expect(call).toHaveBeenCalledOnce();
  });
  it('blocks OpenRouter for health-related tasks even when caller permits it', () => {
    for (const task of ['medical_document', 'medical_labs', 'food_photo', 'food_label',
      'nutrition_assistant', 'meal_generation', 'workout_generation'] as const) {
      expect(() => chooseRoute(task, {
        [task]: { provider: 'openrouter', model: 'cheap', dataClass: 'general' },
      }, ['openrouter'])).toThrow(AiRoutingError);
    }
  });

  it('blocks OpenRouter routes mislabeled as medical', () => {
    expect(() => chooseRoute('general_assistant', {
      general_assistant: { provider: 'openrouter', model: 'cheap', dataClass: 'medical' },
    }, ['openrouter'])).toThrow(AiRoutingError);
  });

});
