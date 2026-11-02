import { describe, expect, it } from 'vitest';
import { buildReport, reportText } from '../../src/domain/report';
import type { DayEntry, Plan } from '../../src/domain/types';

const date = '2026-10-27';
const now = new Date('2026-10-28T12:00:00');
const plan: Plan = {
  prescriptions: [{ id: 'med', kind: 'medication', title: 'Тестовий препарат', dose: '1 таб.', source: 'Тест',
    schedule: { times: ['08:30'] } }],
  constraints: [], targets: {}, modes: [],
};
const water: DayEntry = { id: 'water', at: `${date}T12:00:00+02:00`, kind: 'water', status: 'done', title: 'Вода', waterMl: 250 };
const report = (entries: DayEntry[], p = plan, from = date, to = date) => buildReport({
  from, to, plan: p, entries, now, workouts: [], wellbeing: [], weights: [], foods: new Map(),
});

describe('report medicine outcomes without module observation', () => {
  it('adding only water never turns an unmarked medicine into a skipped dose', () => {
    const r = report([water]);
    expect(r.meds).toMatchObject({ taken: 0, due: 1, noData: 1, uncertain: 0, missed: [] });
    const text = reportText(r, d => d);
    expect(text).toContain('Дані відсутні: 1 доз.');
    expect(text).not.toContain('пропущено');
    expect(text).toContain('Дні без записів не оцінюються');
  });

  it('keeps taken, explicitly skipped and unmarked doses distinct', () => {
    const p: Plan = { ...plan, prescriptions: [{ ...plan.prescriptions[0]!, schedule: { times: ['08:30', '12:00', '20:00'] } }] };
    const entries: DayEntry[] = [
      { id: 'taken', at: `${date}T08:35:00+02:00`, kind: 'med', status: 'done', title: 'Тестовий препарат', checkKey: 'med:med:08:30', prescriptionId: 'med' },
      { id: 'skipped', at: `${date}T12:00:00+02:00`, kind: 'med', status: 'skipped', title: 'Тестовий препарат', checkKey: 'med:med:12:00', prescriptionId: 'med' },
    ];
    const r = report(entries, p);
    expect(r.meds).toMatchObject({ taken: 1, due: 3, noData: 1, missed: [{ title: 'Тестовий препарат', count: 1 }] });
    expect(reportText(r, d => d)).toContain('Тестовий препарат — пропущено 1');
    expect(reportText(r, d => d)).toContain('Дані відсутні: 1 доз.');
  });

  it('does not score days without records', () => {
    expect(report([]).meds).toBeUndefined();
    expect(report([water], plan, '2026-10-25', '2026-10-28').meds).toMatchObject({ due: 1, noData: 1, missed: [] });
  });

  it('excludes future doses today while retaining an elapsed unmarked dose', () => {
    const p: Plan = { ...plan, prescriptions: [{ ...plan.prescriptions[0]!, schedule: { times: ['08:30', '20:00'] } }] };
    const todayWater = { ...water, at: '2026-10-28T10:00:00+02:00' };
    expect(report([todayWater], p, '2026-10-28', '2026-10-28').meds).toMatchObject({ taken: 0, due: 1, noData: 1, missed: [] });
  });

  it('counts completed late by actual event time and keeps it within completed doses', () => {
    const late: DayEntry = { id: 'late', at: `${date}T09:10:00+02:00`, kind: 'med', status: 'done',
      adherence: 'completed_late', title: 'Тестовий препарат', checkKey: 'med:med:08:30', prescriptionId: 'med' };
    const r = report([late]);
    expect(r.meds).toMatchObject({ taken: 1, due: 1, completedLate: 1, uncertain: 0, noData: 0 });
    expect(reportText(r, d => d)).toContain('Пізно виконано: 1 доз.');
  });

  it('reports uncertainty separately from completed, skipped, and absent data', () => {
    const uncertain: DayEntry = { id: 'uncertain', at: `${date}T08:30:00+02:00`, kind: 'med', status: 'planned',
      adherence: 'uncertain', markedAt: '2026-10-27T12:00:00+02:00', title: 'Тестовий препарат',
      checkKey: 'med:med:08:30', prescriptionId: 'med' };
    const r = report([uncertain]);
    expect(r.meds).toMatchObject({ taken: 0, due: 1, completedLate: 0, uncertain: 1, noData: 0, missed: [] });
    expect(reportText(r, d => d)).toContain('Не впевнені, чи прийнято: 1 доз.');
  });
});
