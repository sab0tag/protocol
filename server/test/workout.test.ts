import { describe, expect, it } from 'vitest';
import { workoutSchema } from '../src/workout.ts';

describe('workout schema (D63)', () => {
  it('only ids from the list', () => {
    const s = workoutSchema(['goblet-squat', 'swing']);
    const one = (id: string) => ({ exercises: [{ id, sets: 3, reps: 10, seconds: null }], advice: '' });
    expect(s.safeParse(one('swing')).success).toBe(true);
    expect(s.safeParse(one('snatch')).success).toBe(false);
  });
});

describe('D201: the workout request for the prompt cache', () => {
  it('the equipment and the exercise list are in the cached block; the records, limits and time are not', async () => {
    const { workoutOpts } = await import('../src/workout.ts');
    const ex = [{ id: 'swing', name: 'Махи', level: 1 as const, pattern: 'нахил', unilateral: false, timed: false }];
    const o = workoutOpts({ model: 'm', effort: 'low' }, { exercises: ex, history: [{ date: '2026-11-19', feeling: 'легко', items: ['Махи: 15 · 15'] }], rules: ['без стрибків'], equipment: 'гиря 12 кг', minutes: 30, wish: '' });
    expect(o.reference).toContain('swing — Махи');
    expect(o.reference).toContain('гиря 12 кг');
    expect(o.content).not.toContain('swing — Махи');
    expect(o.content).toContain('до 30 хв');
    expect(o.content).toContain('без стрибків');
  });
});
