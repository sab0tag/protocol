import { describe, expect, it } from 'vitest';
import { toResult, type ConclusionModel } from '../src/conclusion.ts';

const line = (o: Partial<ConclusionModel['lines'][number]>): ConclusionModel['lines'][number] => ({ group: 'medication', title: '', words: '', dose: '',
  times: [], perDay: 0, durationDays: 0, asNeeded: false, food: 'unsaid', tag: 'none', allergens: [], target: 'none', value: '', date: '',
  page: 1, box: [0.1, 0.4, 0.7, 0.03], sure: 'yes', ...o });

describe('the model’s flat lines → the app’s conclusion (D101)', () => {
  it('empty means not said; the groups as the app keeps them', () => {
    const r = toResult({ readable: true, date: '2026-10-16', doctor: 'Ендокринолог', note: '', lines: [
      line({ group: 'diet', title: 'стіл №5' }),
      line({ title: 'Метформін', dose: '500 мг', perDay: 2, words: '2 рази на день під час їжі, тривало', food: 'with' }),
      line({ title: 'Омепразол', dose: '20 мг', perDay: 1, durationDays: 14, food: 'empty', sure: 'check' }),
      line({ title: 'Парацетамол', dose: '500 мг', asNeeded: true }),
      line({ group: 'limit', tag: 'sodium', title: 'Обмеження солі', words: 'до 5 г на добу' }),
      line({ group: 'limit', title: 'Без смаженого' }),
      line({ group: 'test', title: 'Глюкоза натще, ліпідограма через 3 місяці' }),
      line({ group: 'visit', title: 'Огляд ендокринолога', date: '2027-01-15', page: 1 }),
      line({ group: 'target', target: 'waterMl', value: '2000' }),
      line({ group: 'unread', title: 'Ам…ин', page: 2 }),
    ] });
    expect(r).toMatchObject({ date: '2026-10-16', doctor: 'Ендокринолог', note: null, diagnosis: null, diet: { said: 'стіл №5' },
      nextVisit: { date: '2027-01-15' }, tests: [{ title: 'Глюкоза натще, ліпідограма через 3 місяці' }],
      targets: [{ key: 'waterMl', value: '2000' }], unread: [{ text: 'Ам…ин', page: 2 }] });
    expect(r.prescriptions.map((p) => [p.title, p.dose, p.perDay, p.durationDays, p.asNeeded, p.withFood, p.sure])).toEqual([
      ['Метформін', '500 мг', 2, null, false, true, 'yes'], ['Омепразол', '20 мг', 1, 14, false, false, 'check'], ['Парацетамол', '500 мг', null, null, true, null, 'yes']]);
    expect(r.constraints.map((c) => [c.tag, c.title, c.reason])).toEqual([['sodium', 'Обмеження солі', 'до 5 г на добу'], ['custom', 'Без смаженого', '']]);
    expect(toResult({ readable: false, date: 'вчора', doctor: ' ', note: 'Це чек', lines: [] })).toMatchObject({ date: null, doctor: null, note: 'Це чек', diet: null, nextVisit: null });
  });
});
