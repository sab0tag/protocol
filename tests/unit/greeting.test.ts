import { describe, expect, it } from 'vitest';
import { greeting, dailyPhrase } from '../../src/domain/greeting';
describe('personal day greeting', () => {
  it.each([[4, 'Тихої ночі'], [5, 'Доброго ранку'], [11, 'Доброго ранку'], [12, 'Добрий день'], [17, 'Добрий день'], [18, 'Добрий вечір'], [22, 'Добрий вечір'], [23, 'Тихої ночі']])('uses local hour %s', (hour, text) => {
    expect(greeting(new Date(2026, 9, 27, Number(hour)), 'Олена')).toBe(`${text}, Олена!`);
  });
  it('keeps unnamed users anonymous and rotates at local midnight across DST', () => {
    expect(greeting(new Date(2026, 9, 27, 12), '  ')).toBe('Добрий день!');
    for (const day of [24, 25, 26, 27, 31]) {
      expect(dailyPhrase(new Date(2026, 9, day, 0))).toBe(dailyPhrase(new Date(2026, 9, day, 23, 59)));
      expect(dailyPhrase(new Date(2026, 9, day))).not.toBe(dailyPhrase(new Date(2026, 9, day + 1)));
    }
  });
});
