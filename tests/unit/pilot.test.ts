import { describe, expect, it } from 'vitest';
import { demoData } from '../../src/data/demo';
import { FOODS } from '../../src/data/foods';
import { RECIPES } from '../../src/data/recipes';
import { emptyPlan, examplePlan } from '../../src/data/seed.example';
import { buildChecklist } from '../../src/domain/checklist';
import { applyLines, draftLines, type ConclusionResult } from '../../src/domain/conclusion';
import { dietOf } from '../../src/domain/diets';
import { scrubNames, surveyDue, weekDays, weekOf, weeksDue, weekSummary, type PilotData } from '../../src/domain/pilot';
import { dateOf } from '../../src/domain/dates';
import type { DayEntry, Plan } from '../../src/domain/types';
import { offerDue } from '../../src/sync/pilot';

const foods = new Map(FOODS.map((f) => [f.id, f]));
const base = (o: Partial<PilotData>): PilotData => ({ plan: emptyPlan(), entries: [], workouts: [], wellbeing: [], weights: [], foods, tallies: {},
  fromPhoto: false, remindersOn: false, pid: 'p_abcdefghij', build: 'index-DvpmBBM0', platform: 'ios-pwa', ...o });

/** Every leaf: an integer, a boolean, or a string at one of the allowed places. */
function leaves(x: unknown, path = ''): { path: string; v: unknown }[] {
  return x && typeof x === 'object' ? Object.entries(x).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k)) : [{ path, v: x }];
}
const STRINGS = new Set(['pid', 'week', 'src', 'app.build', 'app.platform']);

// the analyst's made-up discharge (tests/fixtures/prescription-cases: printed-01), as the model reads it
const at = { page: 1, box: [0.1, 0.2, 0.5, 0.05], sure: 'yes' as const };
const rx = (o: Partial<ConclusionResult['prescriptions'][number]>): ConclusionResult['prescriptions'][number] => ({
  kind: 'medication', title: '', dose: null, times: [], perDay: null, frequency: null, durationDays: null, asNeeded: false, withFood: null, ...at, ...o });
const DISCHARGE: ConclusionResult = {
  readable: true, date: '2026-10-16', doctor: 'Ендокринолог', note: null, diagnosis: 'Цукровий діабет 2 типу', nextVisit: { date: '2027-01-15', title: 'Повторний огляд', ...at },
  diet: { said: 'стіл №5', ...at }, tests: [{ title: 'Глюкоза та ліпідограма', ...at }],
  constraints: [{ tag: 'sodium', title: 'Обмежити сіль', reason: 'тиск', allergens: [], ...at }],
  prescriptions: [
    rx({ title: 'Метформін', dose: '500 мг', times: ['08:00', '20:00'], perDay: 2, withFood: true }),
    rx({ title: 'Аторвастатин', dose: '20 мг', times: ['20:00'], perDay: 1 }),
    rx({ title: 'Омепразол', dose: '20 мг', times: ['07:30'], perDay: 1, durationDays: 14, withFood: false }),
    rx({ title: 'Парацетамол', dose: '500 мг', asNeeded: true, frequency: 'при болю, не більше 4 табл. на добу' }),
  ],
  targets: [{ key: 'kcal', value: '1800', ...at }], unread: [],
} as unknown as ConclusionResult;

describe('the pilot’s weekly summary (D119)', () => {
  it('nothing but counts: no name, no INN, no diet, no food, no tag, no date but the week — the example and a made-up discharge', () => {
    const today = new Date('2026-11-02T10:00:00');
    const demoPlan = examplePlan(today), d = demoData(foods, today);
    let n = 0;
    const lines = draftLines(DISCHARGE, () => `l${++n}`, { today: '2026-10-19' });
    const discharge: Plan = { ...emptyPlan(), ...applyLines(emptyPlan(), lines, { since: '2026-10-19', sinceTime: '09:00' }) };
    expect(discharge.prescriptions.length).toBeGreaterThanOrEqual(4);
    const cases: [Plan, DayEntry[]][] = [[demoPlan, d.entries], [discharge, d.entries]];
    for (const [plan, entries] of cases) {
      const week = weekOf('2026-10-26');
      const s = weekSummary(base({ plan, entries, workouts: d.workouts, wellbeing: d.wellbeing, weights: d.weights, src: 'ENDO-01', fromPhoto: true, remindersOn: true,
        tallies: { nf: 2, why: 1, topup_shown: 1, topup_taken: 1, danger: 0, report: 1, photo_rows: 9, photo_edit: 1, rem_sent: 14, rem_open: 11 } }), week);
      expect(s.food.entries).toBeGreaterThan(0); // the example's week has records — the test is not of an empty summary
      for (const { path, v } of leaves(s)) {
        if (typeof v === 'string') expect(STRINGS.has(path), `a string at ${path}: ${v}`).toBe(true);
        else if (typeof v === 'number') expect(Number.isInteger(v) && v >= 0, `${path}: ${v}`).toBe(true);
        else expect(typeof v, path).toBe('boolean');
      }
      const json = JSON.stringify(s);
      expect(json.match(/\d{4}-\d{2}-\d{2}/g)).toBeNull();
      const words = [
        ...plan.prescriptions.flatMap((p) => [p.title, p.dose, p.notes, p.source, p.med?.inn, p.med?.name]),
        ...plan.constraints.flatMap((c) => [c.title, c.reason, c.source, c.tag, c.diet, ...(c.allergens ?? [])]),
        ...(plan.modes ?? []).map((m) => m.title), dietOf('ЩД')?.name, 'Цукровий', 'Ендокринолог',
        ...entries.flatMap((e) => [e.title, ...(e.items ?? []).map((i) => i.name), ...(e.symptoms ?? [])]),
        ...[...foods.values()].map((f) => f.name), ...RECIPES.map((r) => r.name),
      ].filter((w): w is string => !!w && w.trim().length >= 3);
      for (const w of words) expect(json.includes(w), `«${w}» in the summary`).toBe(false);
    }
  });

  it('meds.due is «Ліки N з M» of every day: a course that ended, «за потреби», the day and time a medicine came in', () => {
    const plan: Plan = { ...emptyPlan(), prescriptions: [
      { id: 'a', kind: 'medication', title: 'A', dose: '1', schedule: { times: ['08:00', '20:00'] }, source: '', since: '2026-10-28', sinceTime: '12:00' },
      { id: 'b', kind: 'medication', title: 'B', dose: '1', schedule: { times: ['09:00'] }, source: '', since: '2026-10-01', until: '2026-10-29' },
      { id: 'c', kind: 'medication', title: 'C', dose: '1', asNeeded: true, maxPerDay: 4, source: '' },
      { id: 't', kind: 'test', title: 'T', source: '', dueDate: '2026-10-30' },
    ] };
    const med = (id: string, p: string, key: string, at: string, status: 'done' | 'skipped' = 'done'): DayEntry =>
      ({ id, at, kind: 'med', status, title: p, prescriptionId: p, ...(key ? { checkKey: key } : {}) });
    const entries = [
      med('1', 'a', 'med:a:20:00', '2026-10-29T20:10:00'),
      med('2', 'a', 'med:a:08:00', '2026-10-30T09:00:00'), // an hour after the plan's time
      med('3', 'b', 'med:b:09:00', '2026-10-26T09:05:00'),
      med('4', 'a', 'med:a:08:00', '2026-10-31T08:00:00', 'skipped'),
      med('5', 'c', '', '2026-10-27T10:00:00'), med('6', 'c', '', '2026-10-27T15:00:00'), med('7', 'c', '', '2026-11-01T10:00:00'),
    ];
    const week = '2026-W44';
    const s = weekSummary(base({ plan, entries }), week);
    expect(s.meds).toEqual({ due: 13, done: 3, skipped: 1, late_30: 1, prn_taken: 3 }); // A: 1 on Wed + 2 × 4; B: Mon–Thu
    // the same as «День» day by day
    const perDay = weekDays(week).map((d) => buildChecklist({ plan, date: d, entries: entries.filter((e) => dateOf(e.at) === d), workouts: [], foods, now: new Date(`${d}T23:59:00`) })
      .items.filter((i) => i.kind === 'med').length);
    expect(perDay).toEqual([1, 1, 2, 3, 2, 2, 2]);
    expect(perDay.reduce((a, b) => a + b, 0)).toBe(s.meds.due);
    expect(s.plan.meds).toBe(3); // A, B (its course ends inside the week), C; not the test
  });

  it('food: days and ways; reminders only when they are on; the week’s counts', () => {
    const meal = (id: string, at: string, via?: 'voice' | 'photo'): DayEntry => ({ id, at, kind: 'meal', status: 'done', title: 'Обід', items: [], ...(via ? { via } : {}) });
    const entries = [meal('1', '2026-10-26T13:00:00', 'voice'), meal('2', '2026-10-26T19:00:00'), meal('3', '2026-10-28T13:00:00', 'photo'),
      { ...meal('4', '2026-10-29T13:00:00'), status: 'planned' as const }, meal('5', '2026-11-02T08:00:00', 'voice')];
    const s = weekSummary(base({ entries, plan: { ...emptyPlan(), onboardedAt: '2026-10-20' }, tallies: { nf: 3, rem_sent: 5, rem_open: 2 } }), '2026-W44');
    expect(s.food).toEqual({ days_logged: 2, entries: 3, by_voice: 1, by_text: 1, by_photo: 1, not_found: 3 });
    expect(s.active_days).toBe(2);
    expect(s.days_in).toBe(13); // 20 Oct … 1 Nov
    expect(s.rem).toBeUndefined();
    expect(weekSummary(base({ remindersOn: true, tallies: { rem_sent: 5, rem_open: 2 } }), '2026-W44').rem).toEqual({ sent: 5, acked: 2 });
  });

  it('the weeks to send: finished, from the week before consent, at most 4 back, none twice', () => {
    expect(weeksDue(new Date('2026-11-16T09:00:00'), '2026-11-04T10:00:00', [])).toEqual(['2026-W44', '2026-W45', '2026-W46']);
    expect(weeksDue(new Date('2026-11-16T09:00:00'), '2026-11-04T10:00:00', ['2026-W45'])).toEqual(['2026-W44', '2026-W46']);
    expect(weeksDue(new Date('2026-12-21T09:00:00'), '2026-10-01T10:00:00', [])).toEqual(['2026-W48', '2026-W49', '2026-W50', '2026-W51']);
    expect(weeksDue(new Date('2026-11-05T09:00:00'), '2026-11-04T10:00:00', ['2026-W44'])).toEqual([]);
    expect(weeksDue(new Date('2027-01-04T09:00:00'), '2026-12-20T10:00:00', [])).toEqual(['2026-W50', '2026-W51', '2026-W52', '2026-W53']);
  });

  it('the offer on «День»: from the 3rd day, after «Ні» not before 30 days, twice at most, never with a consent', () => {
    const m = { key: 'pilot' as const };
    expect(offerDue(m, '2026-11-01', '2026-11-02')).toBe(false);
    expect(offerDue(m, '2026-11-01', '2026-11-03')).toBe(true);
    const no1 = { ...m, asked: [{ at: '2026-11-03', answer: 'no' as const }] };
    expect(offerDue(no1, '2026-11-01', '2026-12-02')).toBe(false);
    expect(offerDue(no1, '2026-11-01', '2026-12-03')).toBe(true);
    expect(offerDue({ ...m, asked: [...no1.asked, { at: '2026-12-03', answer: 'no' as const }] }, '2026-11-01', '2027-06-01')).toBe(false);
    expect(offerDue({ ...m, consent: { at: '2026-11-03T10:00:00Z', version: 1 } }, '2026-11-01', '2026-11-10')).toBe(false);
    expect(offerDue(m, undefined, '2026-11-10')).toBe(false);
  });

  it('surveys: the 7th day of taking part, then the 30th; «Не зараз» — tomorrow, the second one puts it away (D121)', () => {
    const at = '2026-11-02T10:00:00Z';
    expect(surveyDue(undefined, {}, '2026-11-20')).toBeNull(); // not a participant
    expect(surveyDue(at, {}, '2026-11-07')).toBeNull();
    expect(surveyDue(at, {}, '2026-11-08')).toBe('d7');
    expect(surveyDue(at, { d7: { later: ['2026-11-08'] } }, '2026-11-08')).toBeNull();
    expect(surveyDue(at, { d7: { later: ['2026-11-08'] } }, '2026-11-09')).toBe('d7');
    expect(surveyDue(at, { d7: { later: ['2026-11-08', '2026-11-09'] } }, '2026-11-10')).toBeNull();
    expect(surveyDue(at, { d7: { done: true } }, '2026-11-30')).toBeNull();
    expect(surveyDue(at, { d7: { done: true } }, '2026-12-01')).toBe('d30');
    expect(surveyDue(at, {}, '2026-12-01')).toBe('d7'); // the 7th first, the 30th the day after it is done
  });

  it('a note goes with names replaced, the first word of a sentence kept', () => {
    expect(scrubNames('Довго шукав сирники. Дружина Оксана каже — додайте.')).toBe('Довго шукав сирники. Дружина [ім’я] каже — додайте.');
  });
});
