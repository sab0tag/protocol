import { describe, expect, it } from 'vitest';
import { readTimes } from '../../src/domain/conclusion';

describe('manually entered prescription times', () => {
  const read = (input: string) => readTimes(input, { allowShortHour: true });

  it.each(['25:99', '24:00', '23:60', '-1:30', '08:3', '08:30, 25:99', '08:30, ввечері', '08:30,', ',08:30',
    '08:30,,20:00', '08:30;20:00', '08:30, 08:30', '8:30, 08:30', '', '   '])('rejects the entire schedule: %j', input => {
    expect(read(input)).toBeUndefined();
  });

  it('keeps valid boundaries and normalizes short hours without inventing a slot', () => {
    expect(read(' 23:59, 0:00, 8:30, 20:00 ')).toEqual(['00:00', '08:30', '20:00', '23:59']);
    expect(read('08:30, 20:00')).toEqual(['08:30', '20:00']);
  });

  it('keeps the OCR review strict unless short-hour normalization is explicitly requested', () => {
    expect(readTimes('8:30')).toBeUndefined();
    expect(readTimes('08:30, 25:99')).toBeUndefined();
    expect(readTimes('20:00, 08:30')).toEqual(['08:30', '20:00']);
  });
});
