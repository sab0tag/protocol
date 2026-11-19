// D182: the rehab complex in the report to the doctor — counts from the day it entered the plan, pain by day, swelling.
import { describe, expect, it } from 'vitest';
import { emptyPlan } from '../../src/data/seed.example';
import { readRehab } from '../../src/domain/rehab';
import { rehabLines, rehabReport } from '../../src/domain/rehabReport';
import type { DayEntry, Plan } from '../../src/domain/types';

const stages = readRehab('Етап 1: без опори\nЗгинання стопи | 3 × 10');
const plan: Plan = { ...emptyPlan(), rehab: { id: 'c', perDay: 3, stages, stageId: stages[0]!.id, source: 'Травматолог', since: '2026-12-02' },
  restrictions: [{ id: 'r', kind: 'no-weight-bearing', part: 'left-leg', until: '2026-12-31', source: 'Травматолог', active: true }] };
const s = (at: string, pain: number, swelling = false): DayEntry => ({ id: at, at, kind: 'workout', status: 'done', title: 'ЛФК', rehab: { stageId: 's', pain, swelling } });
const dm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

describe('the rehab section of the report', () => {
  it('done of due counted from the day it entered the plan; pain by day (the highest); swelling days; the limits', () => {
    const entries = [s('2026-12-02T09:00:00', 3), s('2026-12-02T18:00:00', 5, true), s('2026-12-03T09:00:00', 4),
      { id: 'x', at: '2026-12-03T10:00:00', kind: 'workout' as const, status: 'done' as const, title: 'Гиря' }];
    const r = rehabReport(plan, entries, '2026-12-01', '2026-12-04')!.rehab;
    expect(r).toMatchObject({ done: 3, due: 9, perDay: 3, stage: 'Етап 1: без опори' }); // 2–4 Dec, not the 1st
    expect(r.days).toEqual([{ date: '2026-12-02', sessions: 2, maxPain: 5, swelling: true }, { date: '2026-12-03', sessions: 1, maxPain: 4, swelling: false }]);
    expect(rehabLines(r, dm)).toEqual([
      'ЛФК (Етап 1: без опори): зроблено 3 з 9 призначених (3 на день)',
      'Біль після занять, найбільший за день (0–10): 02.12 — 5; 03.12 — 4',
      'Набряк відмічено: 02.12',
      'Обмеження лікаря: без опори на ліву ногу до 31.12',
    ]);
  });
  it('no complex — no section; no sessions — said so, without pain lines', () => {
    expect(rehabReport(emptyPlan(), [], '2026-12-01', '2026-12-04')).toBeNull();
    expect(rehabLines(rehabReport(plan, [], '2026-12-01', '2026-12-04')!.rehab, dm)).toContain('Занять не записано');
  });
});
