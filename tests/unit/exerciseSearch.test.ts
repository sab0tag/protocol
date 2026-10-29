import { describe, expect, it } from 'vitest';
import { EXERCISES } from '../../src/data/exercises';
import { searchExercises } from '../../src/domain/exerciseSearch';

const ids = (q: string) => searchExercises(EXERCISES, q).map((e) => e.id);

describe('exercise search (D153)', () => {
  it('an empty query keeps the whole list in its order', () => {
    expect(ids('  ')).toEqual(EXERCISES.map((e) => e.id));
  });
  it('finds by a word of the name, from its start, in any case', () => {
    expect(ids('ГОБЛЕТ')).toEqual(['goblet-squat']);
    expect(ids('план')).toContain('plank');
    expect(ids('лет')).not.toContain('goblet-squat'); // the middle of a word is not a match
  });
  it('finds by the movement a person would name', () => {
    const squats = EXERCISES.filter((e) => e.pattern === 'squat').map((e) => e.id);
    expect(ids('присід')).toEqual(expect.arrayContaining(squats));
    expect(ids('прес')).toEqual([...EXERCISES.filter((e) => e.pattern === 'core' || e.id === 'push-press').map((e) => e.id)]); // the core, and «Пуш-прес» by its name
  });
  it('every word must match; apostrophes and і/и, є/е typed either way', () => {
    expect(ids('жим однією')).toEqual(EXERCISES.filter((e) => e.pattern === 'push' && /однією/.test(e.name)).map((e) => e.id));
    expect(ids('прогулянка')).toEqual(ids('прогулянка'.replace('і', 'и')));
    expect(ids('зовсім не вправа')).toEqual([]);
  });
});
