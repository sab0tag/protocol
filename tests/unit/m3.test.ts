import { describe, expect, it } from 'vitest';
import { FOODS } from '../../src/data/foods';
import { examplePlan } from '../../src/data/seed.example';
import { buildChecklist } from '../../src/domain/checklist';
import type { DayEntry, Plan, Workout } from '../../src/domain/types';
import { blankExercise, pressHint, programme, programmeWeek, workoutDay } from '../../src/domain/workouts';

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
    expect(c.items[0]?.detail).toBe('08:30 · під час їжі');
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
    expect(programme(4).map((e) => e.name)).not.toContain('Махи');
    expect(programme(5).map((e) => e.name)).toContain('Махи');
  });

  it('one-arm work has R and L sets; a weaker left press gets the hint', () => {
    const press = blankExercise(programme(1).find((e) => e.name === 'Жим стоячи')!);
    expect(press.sets.map((s) => s.side)).toEqual(['R', 'L', 'R', 'L', 'R', 'L']);
    const done = { ...press, sets: press.sets.map((s) => ({ ...s, reps: s.side === 'R' ? 8 : 6 })) };
    expect(pressHint(done)).toContain('по Л');
    expect(pressHint({ ...press, sets: press.sets.map((s) => ({ ...s, reps: 8 })) })).toBeUndefined();
  });
});
