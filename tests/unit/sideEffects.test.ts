// D194: a new medicine's side effects — the first 14 days, one question a day, the summary in the report.
import { describe, expect, it } from 'vitest';
import { newMedicines, sideAsk, sideKey, sideReport } from '../../src/domain/sideEffects';
import type { DayEntry, Prescription } from '../../src/domain/types';

const med = (over: Partial<Prescription> = {}): Prescription => ({ id: 'p-om', kind: 'medication', title: 'Омепразол', dose: '20 мг', since: '2026-11-10', source: 'лікар', ...over } as Prescription);
const note = (date: string, yes: boolean, text?: string): DayEntry => ({ id: `n-${date}`, at: `${date}T20:00:00+02:00`, kind: 'note', status: 'done', title: '', checkKey: sideKey('p-om'), side: { yes, ...(text ? { text } : {}) } });

describe('a new medicine\'s side effects', () => {
  it('asked days 1–14 after it entered the plan, not before, not after, not «за потреби»', () => {
    const plan = { prescriptions: [med(), med({ id: 'old', since: '2026-09-01' }), med({ id: 'prn', asNeeded: true })] };
    expect(newMedicines(plan, '2026-11-10').map((x) => [x.p.id, x.day])).toEqual([['p-om', 1]]);
    expect(newMedicines(plan, '2026-11-23').map((x) => x.day)).toEqual([14]);
    expect(newMedicines(plan, '2026-11-24')).toEqual([]);
  });
  it('once a day: answered today — not asked again', () => {
    const plan = { prescriptions: [med()] };
    expect(sideAsk(plan, [], '2026-11-12')?.p.id).toBe('p-om');
    expect(sideAsk(plan, [note('2026-11-12', false)], '2026-11-12')).toBeNull();
  });
  it('the report: answers counted, the «так» days with their words, only within the 14 days', () => {
    const entries = [note('2026-11-11', false), note('2026-11-12', true, 'нудота'), note('2026-11-13', true), note('2026-11-30', true, 'пізно')];
    expect(sideReport({ prescriptions: [med()] }, entries, '2026-11-01', '2026-11-30')).toEqual([
      { title: 'Омепразол', since: '2026-11-10', asked: 3, yes: [{ date: '2026-11-12', text: 'нудота' }, { date: '2026-11-13', text: '' }] }]);
  });
});
