// D178 (task 7, step 4): the doctor's limits as a structure; the code filters before any model.
import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../../src/data/exercises';
import { emptyPlan } from '../../src/data/seed.example';
import { draftFromAi, workoutRequest } from '../../src/domain/aiWorkout';
import { allowedExercises, breaks, EXERCISE_BODY, restrictionText, trainingMode } from '../../src/domain/trainingRules';
import type { Plan, Restriction } from '../../src/domain/types';

const r = (x: Partial<Restriction>): Restriction => ({ id: 'r', kind: 'no-weight-bearing', part: 'left-leg', source: 'Травматолог', active: true, ...x });
const plan = (...rs: Restriction[]): Plan => ({ ...emptyPlan(), restrictions: rs });

describe('the library is tagged', () => {
  it('every exercise has its body tags (an untagged one would be hidden under any limit)', () => {
    expect(EXERCISES.filter((e) => !EXERCISE_BODY[e.id]).map((e) => e.id)).toEqual([]);
  });
});

describe('the mode comes from the plan', () => {
  it('nothing — general; an active limit on that day — restricted; a lifted or ended one — general again', () => {
    expect(trainingMode(emptyPlan(), '2026-11-19')).toBe('general');
    expect(trainingMode(plan(r({})), '2026-11-19')).toBe('restricted');
    expect(trainingMode(plan(r({ active: false })), '2026-11-19')).toBe('general');
    expect(trainingMode(plan(r({ until: '2026-12-09' })), '2026-12-09')).toBe('restricted');
    expect(trainingMode(plan(r({ until: '2026-12-09' })), '2026-12-10')).toBe('general');
  });
});

describe('the filter', () => {
  it('«без опори на ліву ногу»: nothing standing, nothing loading the legs — floor press stays', () => {
    const { list, hidden } = allowedExercises(EXERCISES, plan(r({})), '2026-11-19');
    expect(list.map((e) => e.id)).toEqual(['floor-press']);
    expect(hidden).toBe(EXERCISES.length - 1);
    for (const e of list) expect(EXERCISE_BODY[e.id]!.standing || EXERCISE_BODY[e.id]!.loads.includes('left-leg')).toBe(false);
  });
  it('«без навантаження на праву руку»: no arm work; «на спину»: no back work', () => {
    expect(allowedExercises(EXERCISES, plan(r({ kind: 'no-load', part: 'right-arm' })), '2026-11-19').list.map((e) => e.id)).toEqual(['glute-bridge']);
    expect(allowedExercises(EXERCISES, plan(r({ kind: 'no-load', part: 'back' })), '2026-11-19').list.map((e) => e.id)).toEqual(['floor-press']);
  });
  it('«пульс до 110»: no ballistic work; the rest stays', () => {
    const ids = allowedExercises(EXERCISES, plan(r({ kind: 'max-pulse', part: undefined, value: 110 })), '2026-11-19').list.map((e) => e.id);
    for (const b of ['swing', 'swing-1', 'snatch', 'clean', 'high-pull', 'push-press', 'clean-press']) expect(ids).not.toContain(b);
    expect(ids).toContain('goblet-squat');
  });
  it('«до 8 кг» limits the bell, not the exercise — nothing hidden, it is said', () => {
    expect(allowedExercises(EXERCISES, plan(r({ kind: 'max-kg', part: undefined, value: 8 })), '2026-11-19').hidden).toBe(0);
    expect(restrictionText(r({ kind: 'max-kg', part: 'right-arm', value: 8 }))).toBe('вага до 8 кг на правій руці');
  });
  it('the words of a limit', () => {
    expect(restrictionText(r({ until: '2026-12-09' }))).toBe('без опори на ліву ногу до 09.12');
    expect(restrictionText(r({ kind: 'max-pulse', part: undefined, value: 110 }))).toBe('пульс до 110');
  });
  it('an old text constraint is not a rule: nothing is filtered by it', () => {
    const p: Plan = { ...emptyPlan(), constraints: [{ id: 'c', tag: 'other' as never, title: 'Без опори на ліву ногу', reason: '', source: '', active: true }] };
    expect(allowedExercises(EXERCISES, p, '2026-11-19').hidden).toBe(0);
  });
});

describe('the model never sees what is forbidden', () => {
  const limited = plan(r({ until: '2026-12-09' }));
  it('the request body: only allowed exercises; the limit as a rule line', () => {
    const body = workoutRequest({ levels: [1, 2, 3], plan: limited, workouts: [], minutes: 30, wish: '', date: '2026-11-19' });
    expect(body.exercises.map((e) => e.id)).toEqual(['floor-press']);
    for (const e of body.exercises) expect(EXERCISE_BODY[e.id]!.standing).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/goblet-squat|swing|lunge/);
    expect(body.rules).toContain('Обмеження лікаря: без опори на ліву ногу до 09.12');
    // after the last day the library is whole again
    expect(workoutRequest({ levels: [1], plan: limited, workouts: [], minutes: 30, wish: '', date: '2026-12-10' }).exercises.length).toBeGreaterThan(1);
  });
  it('a forbidden id in the answer is dropped, whatever the model said', () => {
    const ok = new Set(allowedExercises(EXERCISES, limited, '2026-11-19').list.map((e) => e.id));
    const d = draftFromAi({ exercises: [{ id: 'goblet-squat', sets: 3, reps: 10, seconds: null }, { id: 'floor-press', sets: 3, reps: 8, seconds: null }], advice: '' }, [1, 2, 3], (id) => ok.has(id));
    expect(d.exercises.map((x) => x.exerciseId)).toEqual(['floor-press']);
    expect(d.dropped).toBe(1);
  });
  it('a limit breaks by its own rule; an untagged exercise is never guessed safe', () => {
    expect(breaks({ id: 'unknown' }, [r({})])?.kind).toBe('no-weight-bearing');
    expect(breaks({ id: 'unknown' }, [])).toBeNull();
  });
});
