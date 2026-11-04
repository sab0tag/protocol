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

  it('lists only confirmed skips with planned time and optional patient reason', () => {
    const entries: DayEntry[] = [
      { id: 'skip-med', at: `${date}T08:30:00+02:00`, kind: 'med', status: 'skipped', title: 'Тестовий препарат', checkKey: 'med:med:08:30', skipReason: 'Не було вдома' },
      { id: 'skip-meal', at: `${date}T13:00:00+02:00`, kind: 'meal', status: 'skipped', title: 'Обід', plannedAt: `${date}T12:30:00+02:00` },
      { id: 'unmarked', at: `${date}T20:00:00+02:00`, kind: 'meal', status: 'planned', title: 'Вечеря' },
    ];
    const r = report(entries);
    expect(r.skipDetails).toEqual([
      { kind: 'meal', title: 'Обід', date, plannedTime: '12:30' },
      { kind: 'med', title: 'Тестовий препарат', date, plannedTime: '08:30', reason: 'Не було вдома' },
    ]);
    const text = reportText(r, d => d);
    expect(text).toContain('причина: Не було вдома');
    expect(text).not.toContain('Вечеря');
  });

  it('orders skips by newest day then full planned time, independently of recording time and input order', () => {
    const skipped = (id: string, day: string, time: string): DayEntry => ({
      id, kind: 'med', status: 'skipped', title: id, at: `${day}T23:00:00+02:00`, checkKey: `med:${id}:${time}`,
    });
    const r = report([
      skipped('morning:external-id', date, '08:45'),
      skipped('previous-evening', '2026-10-26', '22:00'),
      skipped('afternoon', date, '14:05'),
      { ...skipped('outside', '2026-10-25', '20:00'), skipReason: 'Outside range' },
    ], plan, '2026-10-26', date);
    expect(r.skipDetails?.map(x => [x.title, x.date, x.plannedTime])).toEqual([
      ['afternoon', date, '14:05'],
      ['morning:external-id', date, '08:45'],
      ['previous-evening', '2026-10-26', '22:00'],
    ]);
    expect(reportText(r, d => d)).not.toContain('Outside range');
  });

  it.each([undefined, 'med:legacy:day', 'legacy-key'])('uses the recorded time for legacy keys without a scheduled time: %s', (checkKey) => {
    const r = report([{ id: 'legacy', kind: 'med', status: 'skipped', title: 'Legacy',
      at: `${date}T10:15:00+02:00`, checkKey, skipReason: '  Немає препарату  ' }]);
    expect(r.skipDetails).toEqual([{ kind: 'med', title: 'Legacy', date, plannedTime: '10:15', reason: 'Немає препарату' }]);
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
