// D181 (task 7, step 6): pain thresholds, red flags with an injury, the assistant's own words about exercise — never a model.
import { describe, expect, it } from 'vitest';
import { emptyPlan } from '../../src/data/seed.example';
import { routeQuestion } from '../../src/domain/assistant';
import { readRehab } from '../../src/domain/rehab';
import { injured, painAlert, redFlagInText, rehabAnswer } from '../../src/domain/rehabSafety';
import { CORPUS_CONTEXT } from '../../src/domain/speechCorpus';
import { readOneInput } from '../../src/domain/oneInput';
import type { DayEntry, Plan } from '../../src/domain/types';

const s = (at: string, pain: number): DayEntry => ({ id: at, at, kind: 'workout', status: 'done', title: 'ЛФК', rehab: { stageId: 's', pain, swelling: false } });
const stages = readRehab('Етап 1: без опори\nЗгинання стопи | 3 × 10');
const rehabPlan: Plan = { ...emptyPlan(), rehab: { id: 'c', perDay: 3, stages, stageId: stages[0]!.id, source: 'Реабілітолог' } };
const limitPlan: Plan = { ...emptyPlan(), restrictions: [{ id: 'r', kind: 'no-weight-bearing', part: 'left-leg', until: '2099-12-09', source: 'Травматолог', active: true }] };

describe('pain', () => {
  it('7 or more after today’s last session — stop; 6 — nothing', () => {
    expect(painAlert([s('2026-12-01T09:00:00', 7)], '2026-12-01')).toBe('high');
    expect(painAlert([s('2026-12-01T09:00:00', 6)], '2026-12-01')).toBeNull();
    expect(painAlert([s('2026-12-01T09:00:00', 8), s('2026-12-01T18:00:00', 3)], '2026-12-01')).toBeNull(); // the last one counts
  });
  it('rising three days in a row, ending today — stop; a gap, a flat day or not today — nothing', () => {
    expect(painAlert([s('2026-11-29T09:00:00', 2), s('2026-11-30T09:00:00', 3), s('2026-12-01T09:00:00', 4)], '2026-12-01')).toBe('rising');
    expect(painAlert([s('2026-11-28T09:00:00', 2), s('2026-11-30T09:00:00', 3), s('2026-12-01T09:00:00', 4)], '2026-12-01')).toBeNull();
    expect(painAlert([s('2026-11-29T09:00:00', 2), s('2026-11-30T09:00:00', 3), s('2026-12-01T09:00:00', 3)], '2026-12-01')).toBeNull();
    expect(painAlert([s('2026-11-29T09:00:00', 2), s('2026-11-30T09:00:00', 3), s('2026-12-01T09:00:00', 4)], '2026-12-02')).toBeNull();
  });
});

describe('red flags', () => {
  it('the words of the draft list', () => {
    for (const t of ['біль під гіпсом посилюється', 'під гіпсом дуже болить', 'пальці посиніли', 'пальці на нозі німіють', 'холодні пальці', 'литка болить і набрякла', 'набрякла литка', 'ікра опухла'])
      expect(redFlagInText(t), t).toBe(true);
    for (const t of ['пальці в борошні', 'болить голова', 'гіпс зняли', 'вода холодна', 'з’їв литку курки']) expect(redFlagInText(t), t).toBe(false);
  });
  it('an injury is a rehab complex or a doctor’s limit for training', () => {
    expect(injured(emptyPlan(), '2026-12-01')).toBe(false);
    expect(injured(rehabPlan, '2026-12-01')).toBe(true);
    expect(injured(limitPlan, '2026-12-01')).toBe(true);
  });
  it('the one field: with an injury — the 103 card; without — not', () => {
    expect(readOneInput('пальці посиніли', { ...CORPUS_CONTEXT, injured: true }).kind).toBe('danger');
    expect(readOneInput('пальці посиніли', CORPUS_CONTEXT).kind).not.toBe('danger');
  });
  it('«Помічник»: a red flag with an injury — the 103 card before any model', () => {
    expect(routeQuestion('пальці посиніли під гіпсом', limitPlan, '2026-12-01')).toBe('danger');
    expect(routeQuestion('пальці посиніли під гіпсом', emptyPlan(), '2026-12-01')).toBe('model');
  });
});

describe('«Помічник» about exercise with an injury', () => {
  it('only the plan and «запитайте лікаря» — never the model', () => {
    expect(routeQuestion('чи можна мені присідати?', rehabPlan, '2026-12-01')).toBe('rehab');
    const a = rehabAnswer('чи можна мені присідати?', rehabPlan, '2026-12-01')!;
    expect(a).toContain('Згинання стопи (3 × 10)');
    expect(a).toContain('запитайте лікаря');
    expect(rehabAnswer('які вправи можна?', limitPlan, '2026-12-01')).toContain('без опори на ліву ногу до 09.12');
  });
  it('without an injury, or a question not about exercise — the usual way', () => {
    expect(routeQuestion('чи можна мені присідати?', emptyPlan(), '2026-12-01')).toBe('model');
    expect(routeQuestion('що з’їсти на вечерю?', rehabPlan, '2026-12-01')).toBe('model');
  });
});
