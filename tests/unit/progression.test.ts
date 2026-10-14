import { describe, expect, it } from 'vitest';
import { exerciseById } from '../../src/data/exercises';
import { adviceFor, harder, lastNumbers, motivation, targetTop } from '../../src/domain/progression';
import type { Workout } from '../../src/domain/types';

const squat = exerciseById.get('goblet-squat')!; // 3 × 10
const w = (date: string, reps: number[], feeling?: string, id = 'goblet-squat'): Workout => ({ id: date, date, durationMin: 30, equipment: 'Гиря 16 кг',
  exercises: [{ exerciseId: id, name: id, target: '', sets: reps.map((r) => ({ reps: r })) }], ...(feeling ? { feeling } : {}) });

describe('progression (D61)', () => {
  it('reads targets', () => {
    expect(targetTop('3 × 10')).toBe(10);
    expect(targetTop('3 × 30–45 с')).toBe(45);
    expect(targetTop('3 × 8 кожною, за слабшою рукою')).toBe(8);
  });

  it('two sessions at the top → two more reps; far beyond → the next level of the same movement', () => {
    expect(adviceFor(squat, [w('2026-10-01', [10, 10, 10]), w('2026-10-03', [11, 10, 10])], '2026-10-05').advice).toEqual({ kind: 'more-reps', to: 12 });
    expect(adviceFor(squat, [w('2026-10-01', [10, 10, 9]), w('2026-10-03', [10, 10, 10])], '2026-10-05').advice).toBeUndefined();
    expect(adviceFor(squat, [w('2026-10-01', [15, 15, 15]), w('2026-10-03', [16, 15, 15])], '2026-10-05').advice)
      .toEqual({ kind: 'harder', exercise: harder(squat) });
    expect(harder(squat)?.id).toBe('reverse-lunge');
  });

  it('«Важко» holds, «Щось боліло» never steps up; the last numbers are shown', () => {
    const r = adviceFor(squat, [w('2026-10-01', [12, 12, 12]), w('2026-10-03', [12, 12, 12], 'Важко')], '2026-10-05');
    expect(r.advice).toEqual({ kind: 'hold' });
    expect(r.last?.sets.map((s) => s.reps)).toEqual([12, 12, 12]);
    expect(adviceFor(squat, [w('2026-10-03', [12, 12, 12], 'Щось боліло')], '2026-10-05').advice).toEqual({ kind: 'pain' });
  });

  it('the top of the line with one bell: a heavier one', () => {
    const getup = exerciseById.get('get-up')!; // 3 × 1, level 3, nothing harder
    expect(adviceFor(getup, [w('2026-10-01', [2, 2, 2], undefined, 'get-up'), w('2026-10-03', [2, 2, 2], undefined, 'get-up')], '2026-10-05').advice)
      .toEqual({ kind: 'heavier', kg: 20 });
  });

  it('the week in numbers and a personal best', () => {
    const m = motivation([w('2026-09-20', [10, 10, 10]), w('2026-10-01', [10, 10, 10]), w('2026-10-03', [12, 12, 11])], '2026-10-03');
    expect(m.week).toBe(2);
    expect(m.tonnesWeek).toBe(1); // (30 + 35) × 16 = 1040 kg
    expect(m.records.map((r) => [r.exercise.id, r.value])).toEqual([['goblet-squat', 11]]);
  });

  it('one-arm numbers in right/left pairs', () => {
    expect(lastNumbers({ name: 'x', target: '', sets: [{ side: 'R', reps: 10 }, { side: 'L', reps: 9 }, { side: 'R', reps: 10 }, { side: 'L', reps: 10 }] }, false)).toBe('10/9 · 10/10');
    expect(lastNumbers({ name: 'x', target: '', sets: [{ reps: 15 }, { reps: 16 }] }, false)).toBe('15 · 16');
  });
});
