import { describe, expect, it } from 'vitest';
import { FOODS } from '../../src/data/foods';
import { examplePlan } from '../../src/data/seed.example';
import { buildChecklist } from '../../src/domain/checklist';
import type { DayEntry, Plan, Workout } from '../../src/domain/types';
import { blankExercise, plannedPerSet, pressHint, programme, programmeWeek, workoutDay, workoutTally } from '../../src/domain/workouts';

const foods = new Map(FOODS.map((f) => [f.id, f]));
const DATE = '2026-10-04';
const plan = examplePlan(new Date(`${DATE}T12:00:00`));
const at = (time: string) => `${DATE}T${time}:00+03:00`;
const w = (date: string): Workout => ({ id: date, date, durationMin: 30, equipment: 'Гиря 16 кг', exercises: [] });

describe('«Мій день»', () => {
  it('is built from the plan: medicine at its time, water, workout, dinner deadline', () => {
    const c = buildChecklist({ plan, date: DATE, entries: [], workouts: [], foods, now: new Date(`${DATE}T09:00:00`) });
    expect(c.items.map((i) => i.key)).toEqual(['med:p-vitd:08:30', 'water', 'workout', 'dinner']);
    expect(c).toMatchObject({ done: 0, total: 4 });
    expect(c.items[0]?.detail).toBe('08:30 · 2000 МО · під час їжі');
  });

  it('a medicine without a time is once a day, after the timed ones (D49)', () => {
    const p: Plan = { ...plan, prescriptions: [...plan.prescriptions,
      { id: 'p-mg', kind: 'supplement', title: 'Магній', dose: '1 таб.', source: '' },
      { id: 'p-x', kind: 'medication', title: 'Без часу', schedule: { times: [] }, source: '' }] };
    const c = buildChecklist({ plan: p, date: DATE, entries: [{ id: '1', at: at('09:00'), kind: 'med', status: 'done', title: 'Магній', checkKey: 'med:p-mg:day' }],
      workouts: [], foods, now: new Date(`${DATE}T09:00:00`) });
    const meds = c.items.filter((i) => i.kind === 'med');
    expect(meds.map((i) => i.key)).toEqual(['med:p-vitd:08:30', 'med:p-mg:day', 'med:p-x:day']);
    expect(meds[1]).toMatchObject({ detail: 'раз на день · 1 таб.', done: true, doneAt: '09:00' });
    expect(meds[1]?.time).toBeUndefined();
  });

  it('a tick whose time was not remembered shows no invented time (D52)', () => {
    const c = buildChecklist({ plan, date: DATE, entries: [{ id: '1', at: at('08:30'), kind: 'med', status: 'done', title: 'Вітамін D',
      checkKey: 'med:p-vitd:08:30', timeUnknown: true }], workouts: [], foods, now: new Date(`${DATE}T21:00:00`) });
    expect(c.items[0]).toMatchObject({ done: true });
    expect(c.items[0]?.doneAt).toBeUndefined();
  });

  it('a tick is an entry with the item’s key; water fills by 250 ml segments', () => {
    const entries: DayEntry[] = [
      { id: '1', at: at('08:41'), kind: 'med', status: 'done', title: 'Вітамін D', checkKey: 'med:p-vitd:08:30', prescriptionId: 'p-vitd' },
      ...Array.from({ length: 4 }, (_, i): DayEntry => ({ id: `w${i}`, at: at('10:00'), kind: 'water', status: 'done', title: 'Вода', waterMl: 250 })),
    ];
    const c = buildChecklist({ plan, date: DATE, entries, workouts: [], foods, now: new Date(`${DATE}T11:00:00`) });
    expect(c.items[0]).toMatchObject({ done: true, doneAt: '08:41' });
    expect(c.water).toEqual({ ml: 1000, segments: 4, target: 2500 });
    expect(c.done).toBe(1);
  });

  it('dinner counts down within two hours of the deadline, then says it is late', () => {
    const at1830 = buildChecklist({ plan, date: DATE, entries: [], workouts: [], foods, now: new Date(`${DATE}T18:30:00`) });
    expect(at1830.items.find((i) => i.key === 'dinner')?.minutesLeft).toBe(90);
    const at1500 = buildChecklist({ plan, date: DATE, entries: [], workouts: [], foods, now: new Date(`${DATE}T15:00:00`) });
    expect(at1500.items.find((i) => i.key === 'dinner')?.minutesLeft).toBeUndefined();
    const at2100 = buildChecklist({ plan, date: DATE, entries: [], workouts: [], foods, now: new Date(`${DATE}T21:00:00`) });
    expect(at2100.items.find((i) => i.key === 'dinner')?.late).toBe(true);
  });

  it('in the OGTT mode the carbs minimum is a goal of the day', () => {
    const date = '2026-10-07';
    const c = buildChecklist({ plan, date, entries: [], workouts: [], foods, now: new Date(`${date}T09:00:00`) });
    expect(c.items.find((i) => i.key === 'mode:carbs')).toMatchObject({ title: 'Вуглеводи не менше 150 г', done: false });
  });
});

describe('workouts (§5.6, §9.2)', () => {
  it('every other day', () => {
    expect(workoutDay(plan, [], DATE).due).toBe(true);
    expect(workoutDay(plan, [w('2026-10-03')], DATE)).toMatchObject({ due: false, next: '2026-10-05' });
    expect(workoutDay(plan, [w('2026-10-02')], DATE).due).toBe(true);
  });

  it('moves the workout when a test is due tomorrow, and says why', () => {
    const p: Plan = { ...plan, nextCheckup: { date: '2026-10-05', tests: ['Глюкоза натщесерце'] } };
    const d = workoutDay(p, [w('2026-10-02')], DATE);
    expect(d).toMatchObject({ due: false, next: '2026-10-06' });
    expect(d.postponed).toContain('Глюкоза натщесерце');
    expect(buildChecklist({ plan: p, date: DATE, entries: [], workouts: [w('2026-10-02')], foods, now: new Date() }).workoutNote)
      .toContain('перенесено');
  });

  it('the programme adds swings from week 5', () => {
    expect(programmeWeek(undefined, DATE)).toBe(1);
    expect(programmeWeek('2026-09-01', DATE)).toBe(5);
    expect(programme(4).map((e) => e.id)).not.toContain('swing');
    expect(programme(5).map((e) => e.id)).toContain('swing');
  });

  it('one-arm work has R and L sets; a weaker left press gets the hint', () => {
    const press = blankExercise(programme(1).find((e) => e.id === 'press')!);
    expect(press.sets.map((s) => s.side)).toEqual(['R', 'L', 'R', 'L', 'R', 'L']);
    const done = { ...press, sets: press.sets.map((s) => ({ ...s, reps: s.side === 'R' ? 8 : 6 })) };
    expect(pressHint(done)).toContain('по Л');
    expect(pressHint({ ...press, sets: press.sets.map((s) => ({ ...s, reps: 8 })) })).toBeUndefined();
  });
});

describe('plan against fact (D141)', () => {
  it('reads the plan of one set from the target, ranges kept', () => {
    expect(plannedPerSet('3 × 10')).toBe('10');
    expect(plannedPerSet('3 × 8 кожною ногою')).toBe('8');
    expect(plannedPerSet('3 × 30-45 с')).toBe('30–45');
    expect(plannedPerSet('як вийде')).toBeUndefined();
  });
  it('counts only typed sets as done; empty slots and zeros stay planned', () => {
    const tally = workoutTally([
      { exerciseId: 'goblet-squat', name: 'Гоблет-присід', target: '3 × 10', sets: [{ reps: 10 }, { reps: 8 }, {}] },
      { exerciseId: 'row', name: 'Тяга в нахилі однією рукою', target: '3 × 10 кожною', sets: [{ side: 'R', reps: 10 }, { side: 'L', reps: 0 }] },
      { exerciseId: 'plank', name: 'Планка', target: '2 × 30 с', sets: [{ seconds: 30 }, {}] },
      { name: 'Планка', target: '1 × 20 с', sets: [{ seconds: 20 }] }, // an old record: known by its name
    ]);
    expect(tally).toEqual({ planned: 8, done: 5, reps: 28, seconds: 50 });
    expect(workoutTally([])).toEqual({ planned: 0, done: 0, reps: 0, seconds: 0 });
  });
});
