// D195: a time zone change — the question, «за місцевим часом» / «як удома», and back home.
import { describe, expect, it } from 'vitest';
import { answerZone, shiftTimes, zoneOffset, zoneQuestion } from '../../src/domain/timeZone';
import type { Prescription } from '../../src/domain/types';

const nov = new Date('2026-11-20T10:00:00Z');
const med = { id: 'm', kind: 'medication', title: 'Метформін', schedule: { times: ['08:00', '23:30'], withFood: true }, source: 'лікар' } as Prescription;
const test = { id: 't', kind: 'test', title: 'Глюкоза', source: 'лікар' } as Prescription;

describe('time zone', () => {
  it('offsets with their season: Kyiv +2, Warsaw +1 in November', () => {
    expect(zoneOffset('Europe/Kyiv', nov)).toBe(120);
    expect(zoneOffset('Europe/Warsaw', nov)).toBe(60);
    expect(zoneOffset('Europe/Kyiv', new Date('2026-07-01T10:00:00Z'))).toBe(180);
  });
  it('asks once per zone away; nothing at home without a shift; back home with a shift — asks to move back', () => {
    expect(zoneQuestion({ home: 'Europe/Kyiv' }, 'Europe/Warsaw', nov)).toEqual({ kind: 'away', minutes: -60 });
    expect(zoneQuestion({ home: 'Europe/Kyiv', asked: ['Europe/Warsaw'] }, 'Europe/Warsaw', nov)).toBeNull();
    expect(zoneQuestion({ home: 'Europe/Kyiv' }, 'Europe/Kyiv', nov)).toBeNull();
    expect(zoneQuestion({ home: 'Europe/Kyiv', shift: { zone: 'Europe/Warsaw', minutes: -60 } }, 'Europe/Kyiv', nov)).toEqual({ kind: 'home', minutes: -60 });
    expect(zoneQuestion(undefined, 'Europe/Warsaw', nov)).toBeNull();
    // one zone under its old name is home, not «away by 0»
    expect(zoneQuestion({ home: 'Europe/Kyiv', shift: { zone: 'Europe/Warsaw', minutes: -60 } }, 'Europe/Kiev', nov)).toEqual({ kind: 'home', minutes: -60 });
  });
  it('«як удома» moves only the medicines\' times, across midnight; «повернути» moves them back; «за місцевим» changes nothing', () => {
    expect(shiftTimes([med, test], -60)[0]!.schedule!.times).toEqual(['07:00', '22:30']);
    expect(shiftTimes([med], 60)[0]!.schedule!.times).toEqual(['00:30', '09:00']);
    const away = answerZone({ prescriptions: [med], zone: { home: 'Europe/Kyiv' } }, 'Europe/Warsaw', 'home', -60);
    expect(away.prescriptions[0]!.schedule!.times).toEqual(['07:00', '22:30']);
    expect(away.zone).toEqual({ home: 'Europe/Kyiv', asked: ['Europe/Warsaw'], shift: { zone: 'Europe/Warsaw', minutes: -60 } });
    const back = answerZone(away, 'Europe/Kyiv', 'back', -60);
    expect(back.prescriptions[0]!.schedule!.times).toEqual(['08:00', '23:30']);
    expect(back.zone).toEqual({ home: 'Europe/Kyiv', asked: ['Europe/Warsaw'] });
    const local = answerZone({ prescriptions: [med], zone: { home: 'Europe/Kyiv' } }, 'Europe/Warsaw', 'local', -60);
    expect(local.prescriptions).toEqual([med]);
  });
});
