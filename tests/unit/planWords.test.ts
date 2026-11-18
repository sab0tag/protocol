import { describe, expect, it } from 'vitest';
import { constraintWords, medicineWords, whoWords } from '../../src/domain/planWords';
import type { Constraint, Prescription } from '../../src/domain/types';

const T = '2026-11-17';
const med = (over: Partial<Prescription>): Prescription => ({ id: 'm', kind: 'medication', title: 'Метформін', source: 'x', ...over });

describe('«Що сказав лікар» in plain words (D165)', () => {
  it('a medicine: name and dose, the times, with food, how long', () => {
    expect(medicineWords(med({ dose: '500 мг', schedule: { times: ['20:00', '08:00'], withFood: true }, until: '2026-11-30' }), T))
      .toEqual({ name: 'Метформін 500 мг', how: 'о 08:00 і 20:00, під час їжі, ще 13 днів' });
    expect(medicineWords(med({ schedule: { times: ['07:00'], withFood: false } }), T).how).toBe('о 07:00, натщесерце');
    expect(medicineWords(med({ asNeeded: true }), T).how).toBe('за потреби');
    expect(medicineWords(med({}), T).how).toBe('раз на день');
    expect(medicineWords(med({ schedule: { times: ['08:00'] }, until: '2026-11-10' }), T).how).toBe('о 08:00, курс закінчився 10.11');
    expect(medicineWords(med({ schedule: { times: ['08:00'] }, until: '2027-03-01' }), T).how).toBe('о 08:00, до 01.03');
    expect(medicineWords(med({ schedule: { times: ['08:00', '14:00', '20:00'] } }), T).how).toBe('о 08:00, 14:00 і 20:00');
  });
  it('a limit: its title and the doctor\'s reason', () => {
    const c = (reason: string): Constraint => ({ id: 'c', tag: 'gallbladder', title: 'Жовчний міхур', reason, source: 'x', active: true });
    expect(constraintWords(c('Без смаженого, вага знижується повільно.'))).toBe('Жовчний міхур — без смаженого, вага знижується повільно');
    expect(constraintWords(c(''))).toBe('Жовчний міхур');
  });
  it('who: the sources as entered, never an invented name', () => {
    expect(whoWords(['Терапевт, 12.11.2026', 'Терапевт, 12.11.2026', ' '])).toBe('Терапевт, 12.11.2026');
    expect(whoWords(['А', 'Б', 'В', 'Г'])).toBe('А, Б і ще 2');
    expect(whoWords([])).toBeUndefined();
  });
});
