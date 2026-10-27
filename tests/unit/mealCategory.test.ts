import { describe, expect, it } from 'vitest';
import { mealCategoryFor } from '../../src/domain/mealCategory';

describe('recent meal categories', () => {
  it.each([
    ['Сніданок', '2026-10-27T13:00:00+02:00', 0],
    ['Обід', '2026-10-27T08:00:00+02:00', 1],
    ['Вечеря', '2026-10-27T08:00:00+02:00', 2],
    ['Перекус', '2026-10-27T08:00:00+02:00', 3],
  ] as const)('prefers the meal label for %s', (title, at, category) => {
    expect(mealCategoryFor(title, at)).toBe(category);
  });

  it.each([
    ['2026-10-27T08:00:00+02:00', 0],
    ['2026-10-27T13:00:00+02:00', 1],
    ['2026-10-27T18:00:00+02:00', 2],
    ['2026-10-27T22:00:00+02:00', 3],
  ] as const)('uses the local meal time when a saved title has no category', (at, category) => {
    expect(mealCategoryFor('Улюблена страва', at)).toBe(category);
  });
});
