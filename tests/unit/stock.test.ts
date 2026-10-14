import { describe, expect, it } from 'vitest';
import { runningLow, stockLeft } from '../../src/domain/stock';
import type { DayEntry, Prescription } from '../../src/domain/types';

const vitd: Prescription = { id: 'p', kind: 'supplement', title: 'Вітамін D', source: '', schedule: { times: ['08:30', '20:00'] },
  stock: { left: 20, perDose: 1, at: '2026-10-01T10:00:00+03:00' } };
const tick = (at: string, id = 'p'): DayEntry => ({ id: at, at, kind: 'med', status: 'done', title: 'x', prescriptionId: id });

describe('medicine stock (D69)', () => {
  it('counts down the doses ticked since it was counted, at the plan’s doses a day', () => {
    const entries = [tick('2026-10-01T08:30:00+03:00'), tick('2026-10-01T20:00:00+03:00'), tick('2026-10-02T08:30:00+03:00'), tick('2026-10-02T09:00:00+03:00', 'other')];
    expect(stockLeft(vitd, entries)).toEqual({ left: 18, days: 9 }); // the morning before counting is not taken off
    expect(runningLow([vitd], entries)).toEqual([]);
    const many = Array.from({ length: 10 }, (_, i) => tick(`2026-10-0${2 + Math.floor(i / 2)}T${i % 2 ? '20' : '08'}:30:00+03:00`));
    expect(runningLow([vitd], many).map((x) => [x.p.id, x.days])).toEqual([['p', 5]]);
  });

  it('nothing without a count', () => {
    expect(stockLeft({ ...vitd, stock: undefined } as Prescription, [])).toBeUndefined();
  });
});
