// D193: a test on an empty stomach — the evening before, that morning, and the medicines as a question for the doctor.
import { describe, expect, it } from 'vitest';
import { fasting, fastingHours, fastingMorning, fastingTests } from '../../src/domain/fastingTest';
import { reminders, type ReminderSettings } from '../../src/domain/reminders';
import type { DayEntry, Plan, Prescription } from '../../src/domain/types';

const test = (over: Partial<Prescription>): Prescription => ({ id: 't', kind: 'test', title: 'Ліпідограма', dueDate: '2026-11-24', source: 'лікар', ...over } as Prescription);
const med: Prescription = { id: 'm', kind: 'medication', title: 'Метформін', dose: '500 мг', schedule: { times: ['08:00', '20:00'], withFood: true }, source: 'лікар' } as Prescription;
const plan = (tests: Prescription[]): Plan => ({ constraints: [], targets: {}, modes: [], prescriptions: [...tests, med] } as unknown as Plan);

describe('a test on an empty stomach', () => {
  it('marked in the plan or said in its words; the referral\'s hours, the longest of the day', () => {
    expect(fasting(test({ title: 'Глюкоза натще' }))).toBe(true);
    expect(fasting(test({ fasting: true }))).toBe(true);
    expect(fasting(test({}))).toBe(false);
    expect(fastingHours([test({ fasting: true, fastingHours: 8 }), test({ fasting: true, fastingHours: 12 })])).toBe(12);
    expect(fastingTests(plan([test({ title: 'Глюкоза натще' })]), '2026-11-25')).toEqual([]);
  });
  it('that morning: the test first, the morning medicine as a question; breakfast written — nothing', () => {
    const p = plan([test({ title: 'Глюкоза натще' })]);
    expect(fastingMorning(p, '2026-11-24', [])).toEqual({ tests: ['Глюкоза натще'], meds: ['Метформін'] });
    const breakfast: DayEntry = { id: 'b', at: '2026-11-24T09:30:00+02:00', kind: 'meal', status: 'done', title: 'Сніданок', items: [] };
    expect(fastingMorning(p, '2026-11-24', [breakfast])).toBeNull();
  });
  it('the reminders: the evening before with the hours (or the lab\'s rules), «спершу аналіз» that morning', () => {
    const OFF: ReminderSettings = { meals: false, meds: false, waterEveryH: 0, repeatMin: 0, morning: '', evening: '', visits: true };
    const now = new Date('2026-11-22T10:00:00');
    const r = reminders({ entries: [], plan: plan([test({ title: 'Глюкоза натще', fastingHours: 10 })]), settings: OFF, now, days: 5 });
    expect(r.items.find((i) => i.key === 'test:2026-11-24:eve')!.payload.b).toBe('Завтра аналіз натщесерце — без їжі 10 год до нього');
    expect(r.items.find((i) => i.key === 'test:2026-11-24')!.payload.b).toBe('Спершу аналіз натщесерце, сніданок — після нього');
    const plain = reminders({ entries: [], plan: plan([test({ fasting: true })]), settings: OFF, now, days: 5 });
    expect(plain.items.find((i) => i.key === 'test:2026-11-24:eve')!.payload.b).toBe('Завтра аналіз натщесерце — без їжі, за правилами лабораторії');
    const other = reminders({ entries: [], plan: plan([test({})]), settings: OFF, now, days: 5 });
    expect(other.items.find((i) => i.key === 'test:2026-11-24:eve')!.payload.b).toBe('Перевірте, що потрібно');
  });
});
