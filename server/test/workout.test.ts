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
