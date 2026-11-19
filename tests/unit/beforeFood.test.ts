// D192: «Натщесерце → їжа» — the minutes from the plan or the leaflet, never filled in; breakfast written — nothing.
import { describe, expect, it } from 'vitest';
import { beforeFood } from '../../src/domain/beforeFood';
import type { DayEntry, Prescription } from '../../src/domain/types';

const p = (over: Partial<Prescription> = {}): Prescription => ({ id: 'p-om', kind: 'medication', title: 'Омепразол', dose: '20 мг', schedule: { times: ['07:00'], withFood: false }, source: 'лікар', ...over } as Prescription);
const dose = (at: string): DayEntry => ({ id: 'd', at, kind: 'med', status: 'done', title: 'Омепразол', prescriptionId: 'p-om' });
const now = new Date('2026-11-20T07:10:00+02:00');

describe('«Натщесерце → їжа»', () => {
  it('with the minutes: «сніданок через N хв», counted from the mark; after them — nothing', () => {
    const plan = { prescriptions: [p({ beforeFoodMin: 30 })] };
    expect(beforeFood(plan, [dose('2026-11-20T07:00:00+02:00')], now)).toEqual({ title: 'Омепразол', minutes: 20 });
    expect(beforeFood(plan, [dose('2026-11-20T06:30:00+02:00')], now)).toBeNull();
  });
  it('without the minutes: «натщесерце, до їжі» for two hours — the app never makes up a number', () => {
    const plan = { prescriptions: [p()] };
    expect(beforeFood(plan, [dose('2026-11-20T07:00:00+02:00')], now)).toEqual({ title: 'Омепразол' });
    expect(beforeFood(plan, [dose('2026-11-20T04:30:00+02:00')], now)).toBeNull();
  });
  it('breakfast written, a medicine with food, or not marked — nothing', () => {
    const breakfast: DayEntry = { id: 'b', at: '2026-11-20T07:05:00+02:00', kind: 'meal', status: 'done', title: 'Сніданок', items: [] };
    expect(beforeFood({ prescriptions: [p({ beforeFoodMin: 30 })] }, [dose('2026-11-20T07:00:00+02:00'), breakfast], now)).toBeNull();
    expect(beforeFood({ prescriptions: [p({ schedule: { times: ['07:00'], withFood: true }, beforeFoodMin: 30 })] }, [dose('2026-11-20T07:00:00+02:00')], now)).toBeNull();
    expect(beforeFood({ prescriptions: [p({ beforeFoodMin: 30 })] }, [], now)).toBeNull();
  });
});
