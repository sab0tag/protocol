// D179 (task 7, step 5): the rehabilitation complex — read as written, stages only after «Так», sessions counted; the same
// complex from the clinic cabinet and from a photo of the sheet.
import { describe, expect, it } from 'vitest';
import { emptyPlan } from '../../src/data/seed.example';
import { composePlan } from '../../src/domain/clinicPlanDraft';
import { applyLines, draftLines, type ConclusionResult } from '../../src/domain/conclusion';
import { confirmImport, parseClinicPlan, previewClinicPlan } from '../../src/domain/planImport';
import { allowStage, currentStage, notYetStage, readRehab, rehabText, sessionsOn, stageToAsk } from '../../src/domain/rehab';
import { trainingMode } from '../../src/domain/trainingRules';
import type { DayEntry, RehabComplex } from '../../src/domain/types';

const SHEET = `Етап 1: без опори
Згинання стопи | 3 × 10 | повільно
Напруження чотириголового м'яза | 10 × 5 с
Етап 2 з 10.12.2026: часткова опора
Ходьба з милицями | 5 хв`;

describe('the complex as written', () => {
  it('stages, their dates and exercises — names, doses and notes word for word', () => {
    const s = readRehab(SHEET);
    expect(s.map((x) => [x.title, x.from ?? null, x.exercises.length])).toEqual([['Етап 1: без опори', null, 2], ['Етап 2: часткова опора', '2026-12-10', 1]]);
    expect(s[0]!.exercises[0]).toMatchObject({ name: 'Згинання стопи', dose: '3 × 10', note: 'повільно' });
    expect(s[0]!.exercises[1]).toMatchObject({ name: 'Напруження чотириголового м\'яза', dose: '10 × 5 с' });
  });
  it('no stage line — one stage; an ISO date works too; an empty stage is dropped', () => {
    expect(readRehab('Згинання стопи | 3 × 10').map((x) => x.title)).toEqual(['Етап 1']);
    expect(readRehab('Етап з 2026-12-01: нові вправи\nПрисід біля стіни | 3 × 8')[0]!.from).toBe('2026-12-01');
    expect(readRehab('Етап 1: пусто\nЕтап 2: є\nВправа')).toHaveLength(1);
  });
  it('back to the same text for editing', () => {
    expect(readRehab(rehabText(readRehab(SHEET))).map((s) => [s.title, s.from, s.exercises.map((x) => [x.name, x.dose, x.note])]))
      .toEqual(readRehab(SHEET).map((s) => [s.title, s.from, s.exercises.map((x) => [x.name, x.dose, x.note])]));
  });
});

describe('stages move only after «Так»', () => {
  const stages = readRehab(SHEET);
  const c: RehabComplex = { id: 'c', perDay: 3, stages, stageId: stages[0]!.id, source: 'Реабілітолог' };
  it('before its date nothing is asked; on the date — asked, and still stage 1 until «Так»', () => {
    expect(stageToAsk(c, '2026-12-09')).toBeNull();
    expect(stageToAsk(c, '2026-12-10')?.title).toBe('Етап 2: часткова опора');
    expect(currentStage(c).title).toBe('Етап 1: без опори'); // the date alone never moves it
    expect(stageToAsk(c, '2027-01-30')?.id).toBe(stages[1]!.id); // weeks later — still a question
  });
  it('«Ще ні» — nothing changes, asked again the next day; «Так» — the stage moves', () => {
    const later = notYetStage(c, stages[1]!.id, '2026-12-10');
    expect(currentStage(later).id).toBe(stages[0]!.id);
    expect(stageToAsk(later, '2026-12-10')).toBeNull();
    expect(stageToAsk(later, '2026-12-11')?.id).toBe(stages[1]!.id);
    const moved = allowStage(later, stages[1]!.id);
    expect(currentStage(moved).id).toBe(stages[1]!.id);
    expect(stageToAsk(moved, '2026-12-11')).toBeNull(); // the last stage
  });
  it('the mode: a complex in the plan — rehab, whatever the limits', () => {
    expect(trainingMode({ ...emptyPlan(), rehab: c }, '2026-12-01')).toBe('rehab');
  });
  it('sessions of the day — only the complex’s marks', () => {
    const e = (id: string, at: string, rehab?: DayEntry['rehab']): DayEntry => ({ id, at, kind: 'workout', status: 'done', title: 'x', ...(rehab ? { rehab } : {}) });
    const list = [e('1', '2026-12-01T09:00:00', { stageId: 's', pain: 2, swelling: false }), e('2', '2026-12-01T18:00:00'), e('3', '2026-12-02T09:00:00', { stageId: 's', pain: 1, swelling: false })];
    expect(sessionsOn(list, '2026-12-01').map((x) => x.id)).toEqual(['1']);
  });
});

describe('from the clinic cabinet', () => {
  const who = { organizationId: 'org', organizationName: 'Клініка', displayName: 'Реабілітолог' };
  it('the form carries it; the patient sees it in the preview and gets it as given', () => {
    const r = composePlan({ title: 'Після перелому', medications: '', restrictions: '', tests: '', followUp: '', rehab: SHEET, rehabPerDay: 3 }, who);
    if ('error' in r) throw new Error(r.error);
    expect(r.plan.rehab).toEqual({ perDay: 3, text: SHEET });
    const preview = previewClinicPlan(r.plan)!;
    const item = preview.items.find((i) => i.key === 'rehab')!;
    expect(item).toMatchObject({ kind: 'activity', title: 'Комплекс ЛФК' });
    expect(item.detail).toContain('Згинання стопи 3 × 10');
    const draft = confirmImport(preview, ['rehab'], 'main')!;
    const content = draft.items[0]!.content;
    expect(content.type).toBe('rehab');
    if (content.type === 'rehab') {
      expect(content.value.perDay).toBe(3);
      expect(content.value.stageId).toBe(content.value.stages[0]!.id);
      expect(content.value.source).toBe('Реабілітолог, Клініка');
    }
  });
  it('a malformed complex refuses the whole plan', () => {
    const base = { schemaVersion: 1, planId: 'p', organizationId: 'o', issuedAt: '2026-11-19T10:00:00Z', clinician: { displayName: 'a', organizationName: 'b' },
      title: 't', medications: [], restrictions: [], tests: [] };
    expect(parseClinicPlan({ ...base, rehab: { perDay: 2, text: 'Вправа' } })).not.toBeNull();
    for (const rehab of [{ perDay: 0, text: 'x' }, { perDay: 2, text: '' }, { perDay: 2, text: 'x', extra: 1 }, { perDay: 2.5, text: 'x' }]) expect(parseClinicPlan({ ...base, rehab })).toBeNull();
  });
});

describe('from a photo of the sheet', () => {
  const read: ConclusionResult = { readable: true, date: '2026-11-18', doctor: 'Реабілітолог', constraints: [], prescriptions: [], tests: [], nextVisit: null, targets: [], unread: [], note: null,
    exercises: [
      { name: 'Згинання стопи', dose: '3 × 10', note: null, stage: 'Тижні 1–3', page: 1, box: [0, 0, 1, 0.1], sure: 'yes' },
      { name: 'Ходьба з милицями', dose: '5 хв', note: 'з 4-го тижня', stage: 'З 4-го тижня', page: 1, box: [0, 0.2, 1, 0.1], sure: 'yes' }] };
  it('one complex to check — never ✓, stages in paper order — and it goes into the plan when ticked', () => {
    let n = 0;
    const lines = draftLines(read, () => `id${n++}`, { today: '2026-11-19' });
    const r = lines.find((l) => l.kind === 'rehab')!;
    expect(r.status).toBe('check');
    if (r.kind !== 'rehab') throw new Error();
    expect(r.complex.stages.map((s) => [s.title, s.exercises.map((x) => x.name)])).toEqual([['Тижні 1–3', ['Згинання стопи']], ['З 4-го тижня', ['Ходьба з милицями']]]);
    const applied = applyLines(emptyPlan(), [r]);
    expect(applied.rehab?.stageId).toBe(r.complex.stages[0]!.id);
    expect(applyLines(emptyPlan(), []).rehab).toBeUndefined();
  });
  it('an older server without exercises gives no complex', () => {
    const { exercises: _e, ...old } = read;
    expect(draftLines(old, () => 'x', { today: '2026-11-19' }).some((l) => l.kind === 'rehab')).toBe(false);
  });
});
