import { describe, expect, it } from 'vitest';
import { examplePlan } from '../../src/data/seed.example';
import { draftFromAi, retarget, workoutRequest } from '../../src/domain/aiWorkout';

describe('«Скласти тренування» (D63)', () => {
  it('sends the chosen levels only, the last workouts in numbers, the active limits', () => {
    const b = workoutRequest({ levels: [1, 2], plan: examplePlan(new Date('2026-10-01T12:00:00')), minutes: 35, wish: ' коротко ',
      workouts: [{ id: 'w', date: '2026-10-12', durationMin: 30, equipment: '', feeling: 'Легко',
        exercises: [{ exerciseId: 'row', name: 'Тяга в нахилі однією рукою', target: '', sets: [{ side: 'R', reps: 10 }, { side: 'L', reps: 9 }] }] }] });
    expect(b.exercises.every((e) => e.level <= 2)).toBe(true);
    expect(b.exercises.some((e) => e.id === 'swing')).toBe(true);
    expect(b.exercises.some((e) => e.id === 'snatch')).toBe(false);
    expect(b.history).toEqual([{ date: '2026-10-12', feeling: 'Легко', items: ['Тяга в нахилі однією рукою: 10/9'] }]);
    expect(b.rules.length).toBeGreaterThan(0);
    expect(b.wish).toBe('коротко');
  });

  it('an answer becomes a checked draft: unknown, off-level and repeated ids dropped, numbers bounded', () => {
    const d = draftFromAi({ advice: '', exercises: [
      { id: 'goblet-squat', sets: 3, reps: 12, seconds: null },
      { id: 'snatch', sets: 3, reps: 6, seconds: null }, // level 3 — not chosen
      { id: 'made-up', sets: 3, reps: 10, seconds: null },
      { id: 'goblet-squat', sets: 2, reps: 8, seconds: null },
      { id: 'row', sets: 9, reps: 99, seconds: null },
      { id: 'plank', sets: 3, reps: null, seconds: 40 },
    ] }, [1, 2]);
    expect(d.dropped).toBe(2); // the snatch and the made-up one; the repeated squat is merged, not «dropped»
    expect(d.exercises.map((x) => [x.exerciseId, x.target, x.sets.length])).toEqual([
      ['goblet-squat', '3 × 12', 3], ['row', '5 × 30 кожною', 10], ['plank', '3 × 40 с', 3]]);
  });

  it('keeps the library\'s words, changes only the numbers', () => {
    expect(retarget('3 × 5 у кожен бік', 2, 6, false)).toBe('2 × 6 у кожен бік');
    expect(retarget('3 × 8 кожною ногою', 3, 10, false)).toBe('3 × 10 кожною ногою');
    expect(retarget('3 × 8 кожною, за слабшою рукою', 4, 6, false)).toBe('4 × 6 кожною, за слабшою рукою');
    expect(retarget('3 × 30–45 с', 3, 40, true)).toBe('3 × 40 с');
    expect(retarget('3 × 30 с кожною', 2, 45, true)).toBe('2 × 45 с кожною');
  });
});
