// D191: «Запитати лікаря» — the phrase, the days to the visit, «Спитав» with the answer.
import { describe, expect, it } from 'vitest';
import { afterVisit, answer, doctorQuestion, visitSoon } from '../../src/domain/doctorQuestions';

describe('«Запитати лікаря»', () => {
  it('a phrase to the doctor becomes the question itself; a plain question does not', () => {
    expect(doctorQuestion('запитати лікаря, чи можна каву з Омепразолом')).toBe('Чи можна каву з Омепразолом?');
    expect(doctorQuestion('Спитати у лікаря: чи можна плавати.')).toBe('Чи можна плавати?');
    expect(doctorQuestion('питання лікарю — скільки пити води')).toBe('Скільки пити води?');
    expect(doctorQuestion('чи можна каву?')).toBeNull();
    expect(doctorQuestion('запитати лікаря')).toBeNull();
  });
  it('the list goes on «Сьогодні» 0–3 days before the visit', () => {
    const plan = { nextCheckup: { date: '2026-11-23', tests: [] } };
    expect(visitSoon(plan, '2026-11-19')).toBeNull();
    expect(visitSoon(plan, '2026-11-20')).toBe(3);
    expect(visitSoon(plan, '2026-11-23')).toBe(0);
    expect(visitSoon(plan, '2026-11-24')).toBeNull();
  });
  it('after the visit — «Спитав» moves the question to the answers, one line, dated', () => {
    expect(afterVisit({ nextCheckup: { date: '2026-11-23', tests: [] } }, '2026-11-22')).toBe(false);
    expect(afterVisit({ nextCheckup: { date: '2026-11-23', tests: [] } }, '2026-11-23')).toBe(true);
    expect(afterVisit({ lastVisit: '2026-11-10' }, '2026-11-20')).toBe(true);
    const next = answer({ questions: ['Чи можна каву?', 'Чи можна плавати?'] }, 'Чи можна каву?', '  так,   одну чашку вранці ', '2026-11-23');
    expect(next).toEqual({ questions: ['Чи можна плавати?'], answered: [{ q: 'Чи можна каву?', a: 'так, одну чашку вранці', at: '2026-11-23' }] });
  });
});
