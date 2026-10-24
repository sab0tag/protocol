// D118, R01: «за потреби» with the doctor's daily limit in its own unit. The limits here are made up — they check the arithmetic,
// not a clinical dose.
import { describe, expect, it } from 'vitest';
import { emptyPlan } from '../../src/data/seed.example';
import { draftLines, type ConclusionResult } from '../../src/domain/conclusion';
import { parseLimit, prnLimit, prnMeds, prnRecords, prnReport, prnTaken, prnUsed, proposedAmount } from '../../src/domain/prn';
import type { AmountUnit, DayEntry, Plan, Prescription } from '../../src/domain/types';

const para: Prescription = { id: 'para', kind: 'medication', title: 'Парацетамол', dose: '500 мг', asNeeded: true, source: '', notes: 'при болю за потреби, не більше 4 табл. на добу' };
const took = (id: string, at: string, qty?: number, unit: AmountUnit = 'tablet'): DayEntry =>
  ({ id, at, kind: 'med', status: 'done', title: 'Парацетамол', prescriptionId: 'para', ...(qty !== undefined ? { amount: { qty, unit } } : {}) });

describe('the daily limit with its unit (R01)', () => {
  it('read from the doctor’s words with the unit they name; a number alone is a limit of unknown unit', () => {
    expect(parseLimit('не більше 4 табл. на добу')).toMatchObject({ value: 4, unit: 'tablet' });
    expect(parseLimit('не більше 3 разів на день')).toMatchObject({ value: 3, unit: 'intake' });
    expect(parseLimit('не більше 2 капсул на добу')).toMatchObject({ value: 2, unit: 'capsule' });
    expect(parseLimit('максимум 2 г на добу')).toMatchObject({ value: 2000, unit: 'mg' });
    expect(parseLimit('до 20 мл на добу')).toMatchObject({ value: 20, unit: 'ml' });
    expect(parseLimit('не більше 4 на добу')).toMatchObject({ value: 4, unit: 'unknown' });
    expect(parseLimit('не більше 4 шт. на добу')).toMatchObject({ value: 4, unit: 'unknown' });
    expect(parseLimit('при болю')).toBeUndefined();
    expect(parseLimit('не більше 4 табл. на добу')!.sourceText).toBe('не більше 4 табл. на добу');
  });

  it('the old number-only limit keeps its number, its unit is not guessed', () => {
    expect(prnLimit({ maxPerDay: 4 })).toEqual({ value: 4, unit: 'unknown', sourceText: '', source: 'legacy' });
    expect(prnLimit({ limit: { value: 3, unit: 'intake', sourceText: '', source: 'plan' }, maxPerDay: 4 })!.unit).toBe('intake');
  });

  it('2 tablets at once: a tablet limit goes down by 2, an intake limit by 1', () => {
    const rs = [took('a', '2026-10-20T08:00:00', 2)];
    expect(prnUsed({ value: 4, unit: 'tablet', sourceText: '', source: 'plan' }, rs)).toMatchObject({ matched: true, used: 2 });
    expect(prnUsed({ value: 3, unit: 'intake', sourceText: '', source: 'plan' }, rs)).toMatchObject({ matched: true, used: 1 });
  });

  it('a half tablet stays a half; mg are not tablets without a confirmed strength; a record with no amount is not guessed', () => {
    expect(prnUsed({ value: 4, unit: 'tablet', sourceText: '', source: 'plan' }, [took('a', '2026-10-20T08:00:00', 0.5), took('b', '2026-10-20T12:00:00', 1)]))
      .toMatchObject({ matched: true, used: 1.5 });
    expect(prnUsed({ value: 2000, unit: 'mg', sourceText: '', source: 'paper' }, [took('a', '2026-10-20T08:00:00', 2)])).toMatchObject({ matched: false, intakes: 1 });
    expect(prnUsed({ value: 4, unit: 'tablet', sourceText: '', source: 'paper' }, [took('a', '2026-10-20T08:00:00')])).toMatchObject({ matched: false });
    expect(prnUsed({ value: 4, unit: 'unknown', sourceText: '', source: 'legacy' }, [took('a', '2026-10-20T08:00:00', 1)])).toMatchObject({ matched: false });
  });

  it('what «Прийняв зараз» proposes: the limit’s own countable unit, else the dose', () => {
    expect(proposedAmount(para)).toEqual({ qty: 1, unit: 'tablet' });
    expect(proposedAmount({ dose: '10 мл', limit: { value: 30, unit: 'ml', sourceText: '', source: 'plan' } })).toEqual({ unit: 'ml' });
    expect(proposedAmount({ dose: '2 капс.' })).toEqual({ qty: 2, unit: 'capsule' });
  });

  it('read off the paper into the plan line, with the unit', () => {
    const r = { readable: true, date: '2026-10-16', doctor: null, note: null, diet: null, constraints: [], tests: [], nextVisit: null, targets: [], unread: [],
      prescriptions: [{ kind: 'medication', title: 'Парацетамол', dose: '500 мг', times: [], perDay: null, frequency: 'при болю за потреби, не більше 4 табл. на добу',
        durationDays: null, asNeeded: true, withFood: null, page: 1, box: [0, 0, 1, 0.1], sure: 'yes' as const }] } as ConclusionResult;
    const l = draftLines(r, () => 'x', { today: '2026-10-20' })[0]!;
    expect(l.kind === 'prescription' && l.prescription.limit).toMatchObject({ value: 4, unit: 'tablet', source: 'paper' });
  });

  it('counted per day; the report: how often, the days over the limit in its unit, the days that could not be matched', () => {
    const plan: Plan = { ...emptyPlan(), prescriptions: [para] };
    const es = [took('a', '2026-10-20T08:00:00', 1), took('b', '2026-10-20T12:00:00', 1), took('c', '2026-10-21T08:00:00', 2),
      took('d1', '2026-10-22T06:00:00', 2), took('d2', '2026-10-22T14:00:00', 2), took('d3', '2026-10-22T22:00:00', 1), // 5 tablets in 3 intakes
      took('e', '2026-10-23T08:00:00')]; // an old record with no amount
    expect(prnMeds(plan, '2026-10-20').map((p) => p.id)).toEqual(['para']);
    expect(prnTaken(para, es, '2026-10-20')).toBe(2);
    expect(prnRecords(para, es, '2026-10-22')).toHaveLength(3);
    expect(prnReport(plan, es, '2026-10-20', '2026-10-26')).toEqual([{ title: 'Парацетамол', dose: '500 мг', limit: expect.objectContaining({ value: 4, unit: 'tablet' }),
      total: 7, days: 4, over: ['2026-10-22'], unmatched: 1 }]);
  });
});
