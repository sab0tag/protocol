import { describe, expect, it } from 'vitest';
import { emptyPlan } from '../../src/data/seed.example';
import { draftLines, type ConclusionResult } from '../../src/domain/conclusion';
import { prnLimit, prnMeds, prnReport, prnTaken } from '../../src/domain/prn';
import type { DayEntry, Plan, Prescription } from '../../src/domain/types';

const para: Prescription = { id: 'para', kind: 'medication', title: 'Парацетамол', dose: '500 мг', asNeeded: true, source: '', notes: 'при болю за потреби, не більше 4 табл. на добу' };
const took = (id: string, at: string): DayEntry => ({ id, at, kind: 'med', status: 'done', title: 'Парацетамол', prescriptionId: 'para' });

describe('«за потреби» with the doctor’s daily limit (D118)', () => {
  it('the limit — set in the plan, or read from the doctor’s words; nothing invented', () => {
    expect(prnLimit(para)).toBe(4);
    expect(prnLimit({ notes: 'не більше 3 разів на день' })).toBe(3);
    expect(prnLimit({ notes: 'за потреби' })).toBeUndefined();
    expect(prnLimit({ ...para, maxPerDay: 2 })).toBe(2);
  });
  it('read off the paper into the plan line', () => {
    const r = { readable: true, date: '2026-10-16', doctor: null, note: null, diet: null, constraints: [], tests: [], nextVisit: null, targets: [], unread: [],
      prescriptions: [{ kind: 'medication', title: 'Парацетамол', dose: '500 мг', times: [], perDay: null, frequency: 'при болю за потреби, не більше 4 табл. на добу',
        durationDays: null, asNeeded: true, withFood: null, page: 1, box: [0, 0, 1, 0.1], sure: 'yes' as const }] } as ConclusionResult;
    const l = draftLines(r, () => 'x', { today: '2026-10-20' })[0]!;
    expect(l.kind === 'prescription' && l.prescription.maxPerDay).toBe(4);
  });
  it('counted per day; the report says how often and which days went over', () => {
    const plan: Plan = { ...emptyPlan(), prescriptions: [para] };
    const es = [took('a', '2026-10-20T08:00:00'), took('b', '2026-10-20T12:00:00'), took('c', '2026-10-21T08:00:00'),
      ...['06', '10', '14', '18', '22'].map((h, i) => took(`d${i}`, `2026-10-22T${h}:00:00`))];
    expect(prnMeds(plan, '2026-10-20').map((p) => p.id)).toEqual(['para']);
    expect(prnTaken(para, es, '2026-10-20')).toBe(2);
    expect(prnReport(plan, es, '2026-10-20', '2026-10-26')).toEqual([{ title: 'Парацетамол', dose: '500 мг', max: 4, total: 8, days: 3, over: ['2026-10-22'] }]);
  });
});
