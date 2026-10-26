import { afterEach, describe, expect, it } from 'vitest';
import { addDays, format, parseISO } from 'date-fns';
import { ProtocolDB, ensureSeeded } from '../../src/data/db';
import { appendModuleEvents } from '../../src/data/modulePreferences';
import { markLightDayNoticeShown, setTodayLightDay } from '../../src/data/lightDay';
import { lightDayHistory, lightDayNotice } from '../../src/domain/lightDay';
import { isLightDay, isModuleEvent, type ModuleEvent } from '../../src/domain/modulePreferences';
import { MODULE_IDS } from '../../src/domain/features';
import { neutralDay, scoredDay, type Observation } from '../../src/domain/observation';
import { buildChecklist } from '../../src/domain/checklist';
import { dayFlags, FOOD_COMPLETE, habits, weekSummary } from '../../src/domain/habits';
import { buildReport, reportText } from '../../src/domain/report';
import { exportAll, importAll, parseExport } from '../../src/data/backup';
import { deriveKeys, newCode, parseCode } from '../../src/sync/crypto';
import { syncOnce, type Api, type RemoteRecord } from '../../src/sync/engine';
import type { DayEntry, Food, Plan, Workout } from '../../src/domain/types';

const databases: ProtocolDB[] = [];
afterEach(async () => { for (const d of databases.splice(0)) await d.delete(); });
async function fresh() { const d = new ProtocolDB('light-day-' + crypto.randomUUID()); databases.push(d); await ensureSeeded(d); return d; }
const at = (d: string, hm = '12:00') => new Date(`${d}T${hm}:00`).toISOString();
const plus = (d: string, n: number) => format(addDays(parseISO(d), n), 'yyyy-MM-dd');
const light = (date: string, enabled = true, id = `light-${date}`): ModuleEvent => ({ id, v: 1, kind: 'light-day', date, enabled, source: 'manual', at: at(date) });
const lights = (first: string, n: number) => Array.from({ length: n }, (_, i) => light(plus(first, i)));
const initial: ModuleEvent[] = MODULE_IDS.map((module) => ({ id: `on-${module}`, v: 1, kind: 'module', module, enabled: true, source: 'onboarding', at: at('2026-10-01', '00:00') }));
const now = new Date('2026-10-26T23:00:00+02:00');
const observe = (events: readonly ModuleEvent[]): Observation => ({ events, now });
const foods = new Map<string, Food>();
const plan: Plan = { prescriptions: [{ id: 'med', kind: 'medication', title: 'Препарат', source: 'Лікар', dose: '1 таб.', schedule: { times: ['08:00'] } },
  { id: 'prn', kind: 'medication', title: 'За потреби', source: 'Лікар', dose: '1 таб.', asNeeded: true }], constraints: [], modes: [],
  targets: { proteinG: 100, carbsG: { max: 150 }, waterMl: 2000, lastMealBy: '19:00' } };
const meal = (date: string, protein = 100, carbs = 100): DayEntry => ({ id: `meal-${date}`, kind: 'meal', status: 'done', at: at(date), title: 'Їжа',
  items: [{ name: 'Страва', grams: 100, manual: { kcal: 500, protein, carbs, fat: 20 } }] });
const complete = (date: string): DayEntry => ({ id: `complete-${date}`, kind: 'note', status: 'done', at: at(date), title: '', checkKey: FOOD_COMPLETE });
const workout = (date: string): Workout => ({ id: `workout-${date}`, date, durationMin: 20, equipment: 'Гиря', exercises: [] });
const report = (events: ModuleEvent[], entries: DayEntry[], workouts: Workout[] = []) => buildReport({ from: '2026-10-20', to: '2026-10-30',
  plan, entries, workouts, foods, weights: [], wellbeing: [], observation: observe(events) });

describe('dated light-day commands and history (D139)', () => {
  it.each(['2026-03-29', '2026-10-25'])('acts on the current local DST date %s, is idempotent, cancels and rolls over without deleting history', async (date) => {
    const d = await fresh(), clock = new Date(`${date}T23:59:59`), saved = await d.plan.get('main');
    expect(await setTodayLightDay(d, false, 'manual', clock)).toBe(false);
    expect(await Promise.all([setTodayLightDay(d, true, 'voice', clock), setTodayLightDay(d, true, 'voice', clock)])).toEqual([true, false]);
    expect(await d.moduleEvents.count()).toBe(1);
    expect(isLightDay(await d.moduleEvents.toArray(), date)).toBe(true);
    const tomorrow = plus(date, 1);
    expect(isLightDay(await d.moduleEvents.toArray(), tomorrow)).toBe(false);
    expect(lightDayHistory(await d.moduleEvents.toArray(), date, tomorrow, new Date(`${tomorrow}T00:00:01`))).toMatchObject({ dates: [date], count: 1, days: 2 });
    // Opposite commands in the same millisecond keep their local order, including a backward clock.
    expect(await setTodayLightDay(d, false, 'manual', clock)).toBe(true);
    expect(await setTodayLightDay(d, false, 'manual', clock)).toBe(false);
    expect(isLightDay(await d.moduleEvents.toArray(), date)).toBe(false);
    expect(await setTodayLightDay(d, true, 'manual', new Date(`${date}T22:00:00`))).toBe(true);
    expect(isLightDay(await d.moduleEvents.toArray(), date)).toBe(true);
    expect(await d.moduleEvents.count()).toBe(3);
    expect(await d.plan.get('main')).toEqual(saved); expect(await d.entries.count()).toBe(0);
  });
  it('projects last decisions independent of order, counts unique dates and clips future/empty ranges', () => {
    const events = [light('2026-10-20'), light('2026-10-21'), light('2026-10-27'), { ...light('2026-10-20', false, 'cancel'), at: at('2026-10-22') },
      light('2026-10-25'), light('2026-10-25', true, 'retry')];
    const actual = lightDayHistory(events, '2026-10-20', '2026-11-01', now);
    expect(actual).toEqual({ dates: ['2026-10-21', '2026-10-25'], count: 2, days: 7 });
    expect(lightDayHistory([...events].reverse(), '2026-10-20', '2026-11-01', now)).toEqual(actual);
    expect(lightDayHistory(events, '2026-10-27', '2026-11-01', now)).toEqual({ dates: [], count: 0, days: 0 });
    expect(lightDayHistory(events, '2026-10-26', '2026-10-25', now).days).toBe(0);
    expect(lightDayHistory([], '2026-10-20', '2026-10-26', now)).toEqual({ dates: [], count: 0, days: 7 });
  });
});

describe('neutral outcomes, retained facts and unchanged medications', () => {
  it.each(['nothing', 'met goals', 'over limits'])('keeps food/water/workout neutral with %s recorded; meds remain due', (scenario) => {
    const date = '2026-10-25', events = [...initial, light(date)], o = observe(events);
    const entries: DayEntry[] = scenario === 'nothing' ? [] : [meal(date, scenario === 'met goals' ? 100 : 1, scenario === 'met goals' ? 100 : 500), complete(date),
      { id: 'water', kind: 'water', status: 'done', title: '', waterMl: 2500, at: at(date) },
      { id: 'med-mark', kind: 'med', status: 'done', title: 'Препарат', prescriptionId: 'med', checkKey: 'med:med:08:00', at: at(date, '08:00') }];
    const workouts = scenario === 'nothing' ? [] : [workout(date)], snapshot = JSON.stringify({ plan, entries, workouts });
    const flags = dayFlags(plan, entries, date, workouts, foods, o);
    expect(flags).toMatchObject({ meds: scenario !== 'nothing' });
    expect(flags.protein).toBeUndefined(); expect(flags.carbs).toBeUndefined(); expect(flags.water).toBeUndefined();
    const checklist = buildChecklist({ plan, date, entries, workouts, foods, now, observation: o });
    expect(checklist.items.map((x) => x.kind)).toEqual(['med']);
    expect(checklist.total).toBe(1); expect(checklist.done).toBe(scenario === 'nothing' ? 0 : 1);
    const r = report(events, entries, workouts);
    expect(r.workouts).toBe(0); expect(r.lightDayWorkouts).toBe(workouts.length);
    expect(r.deviations).toBeUndefined(); expect(r.habits.some((h) => ['protein', 'carbs', 'water'].includes(h.key))).toBe(false);
    if (entries.length) expect(r.meds).toMatchObject({ taken: 1, due: 1 });
    expect(JSON.stringify({ plan, entries, workouts })).toBe(snapshot);
    // Cancellation restores ordinary calculations from the same retained records.
    const ordinary = observe([...events, { ...light(date, false, 'cancel'), at: at('2026-10-26') }]);
    expect(buildChecklist({ plan, date, entries, workouts, foods, now, observation: ordinary }).items.some((i) => i.kind === 'water')).toBe(true);
    expect(scoredDay(ordinary, 'food', date)).toBe(true);
  });
  it('never enables meds when off, never neutralizes weight/wellbeing, and excludes future/demo light markers', () => {
    const events: ModuleEvent[] = [...initial, light('2026-10-25'), { id: 'med-off', v: 1, kind: 'module', module: 'meds', enabled: false, source: 'manual', at: at('2026-10-24') }];
    const o = observe(events);
    expect(buildChecklist({ plan, date: '2026-10-25', entries: [], workouts: [], foods, now, observation: o }).items).toEqual([]);
    for (const key of ['meds', 'weight', 'wellbeing'] as const) expect(neutralDay(o, key, '2026-10-25')).toBe(false);
    expect(neutralDay(observe([...events, light('2026-10-27')]), 'food', '2026-10-27')).toBe(false);
    expect(neutralDay({ ...o, demo: true }, 'food', '2026-10-25')).toBe(false);
  });
  it('pauses food/water streaks without adding success or breaking them; off periods still break them', () => {
    const entries: DayEntry[] = ['2026-10-23', '2026-10-24', '2026-10-26'].flatMap((d) => [meal(d), complete(d), { id: `water-${d}`, kind: 'water', status: 'done', at: at(d), title: 'Вода', waterMl: 2000 }]);
    const events = [...initial, light('2026-10-25')];
    const h = habits({ plan, entries, workouts: [], foods, today: '2026-10-26', observation: observe(events) }).find((h) => h.key === 'protein');
    expect(h).toMatchObject({ streak: 3, best: 3, last7: 3, days7: 3 });
    expect(habits({ plan, entries, workouts: [], foods, today: '2026-10-26', observation: observe(events) }).find((h) => h.key === 'water')).toMatchObject({ streak: 3, best: 3, last7: 3, days7: 3 });
    const off: ModuleEvent = { id: 'food-off', v: 1, kind: 'module', module: 'food', enabled: false, source: 'manual', at: at('2026-10-25', '00:00') };
    const on: ModuleEvent = { ...off, id: 'food-on', enabled: true, at: at('2026-10-26', '00:00') };
    expect(habits({ plan, entries, workouts: [], foods, today: '2026-10-26', observation: observe([...events, off, on]) }).find((h) => h.key === 'protein')?.streak).toBe(1);
  });
  it('uses the same light-day period and neutral workout counts in week/report/shared text; menu outcomes stay neutral', () => {
    const events = [...initial, light('2026-10-25'), light('2026-10-27')];
    const entries: DayEntry[] = ['done', 'skipped', 'planned'].map((status, i) => ({ ...meal('2026-10-25'), id: `menu-${i}`, menu: {}, status: status as DayEntry['status'] }));
    const workouts = [workout('2026-10-25'), workout('2026-10-26')], o = observe(events);
    const week = weekSummary({ plan, entries, workouts, foods, today: '2026-10-26', observation: o });
    const r = report(events, entries, workouts);
    expect(week).toMatchObject({ workouts: 1, lightDayWorkouts: 1, lightDays: { count: 1, days: 7, dates: ['2026-10-25'] } });
    expect(r).toMatchObject({ workouts: 1, lightDayWorkouts: 1, lightDays: week.lightDays }); expect(r.menu).toBeUndefined();
    const text = reportText(r, (d) => d);
    expect(text).toContain('Легких днів: 1 з 7'); expect(text).toContain('Дати: 2026-10-25');
    expect(text).toContain('Добровільно записано тренувань у легкі дні: 1'); expect(text).not.toContain('2026-10-27');
    expect(buildReport({ from: r.from, to: '2026-10-26', plan, entries, workouts, foods, weights: [], wellbeing: [] }).lightDays).toBeUndefined();
  });
});

describe('one calm notice per rolling-calendar episode', () => {
  it('does not trigger at 7/14; triggers at 8/14 and loses old dates without extending the window', () => {
    expect(lightDayNotice(lights('2026-10-01', 7), new Date('2026-10-07T12:00:00'))).toBeUndefined();
    const events = lights('2026-10-01', 8);
    expect(lightDayNotice(events, new Date('2026-10-08T12:00:00'))).toEqual({ episode: '2026-10-08', count: 8 });
    expect(lightDayNotice(events, new Date('2026-10-14T12:00:00'))).toEqual({ episode: '2026-10-08', count: 8 });
    expect(lightDayNotice(events, new Date('2026-10-15T00:00:00'))).toBeUndefined();
    expect(lightDayNotice(lights('2026-10-20', 8), now)).toBeUndefined(); // eighth date is still in the future
    const sparse = ['01', '03', '05', '07', '09', '10', '12', '14'].map((d) => light(`2026-10-${d}`));
    expect(lightDayNotice(sparse, new Date('2026-10-14T12:00:00'))).toEqual({ episode: '2026-10-14', count: 8 });
    expect(lightDayNotice(sparse, new Date('2026-10-15T12:00:00'))).toBeUndefined();
  });
  it('stores actual display once, rejects stale eligibility, and allows a fresh episode after falling to 7', async () => {
    const d = await fresh(); await appendModuleEvents(d, lights('2026-10-01', 8));
    const first = new Date('2026-10-08T12:00:00');
    expect(await markLightDayNoticeShown(d, '2026-10-07', first)).toBe(false);
    expect(await Promise.all([markLightDayNoticeShown(d, '2026-10-08', first), markLightDayNoticeShown(d, '2026-10-08', first)])).toEqual([true, false]);
    expect(lightDayNotice(await d.moduleEvents.toArray(), new Date('2026-10-14T12:00:00'))).toBeUndefined();
    await appendModuleEvents(d, lights('2026-10-20', 8));
    expect(lightDayNotice(await d.moduleEvents.toArray(), new Date('2026-10-27T12:00:00'))).toEqual({ episode: '2026-10-27', count: 8 });
    expect(await markLightDayNoticeShown(d, '2026-10-27', new Date('2026-10-27T12:00:00'))).toBe(true);
    expect((await d.moduleEvents.toArray()).filter((e) => e.kind === 'light-day-notice')).toHaveLength(2);
  });
  it('honours a display inside an episode whose inferred start moved after a late sync; cancellation removes readiness', () => {
    const events: ModuleEvent[] = [...lights('2026-10-01', 9), { id: 'shown', v: 1, kind: 'light-day-notice', date: '2026-10-09', episode: '2026-10-09', at: at('2026-10-09') }];
    expect(lightDayNotice(events, new Date('2026-10-10T12:00:00'))).toBeUndefined();
    expect(lightDayNotice([...lights('2026-10-01', 8), { ...light('2026-10-08', false, 'cancel'), at: at('2026-10-09') }], new Date('2026-10-10T12:00:00'))).toBeUndefined();
  });
  it('validates the closed display event vocabulary without free text', () => {
    const event = { id: 'notice', v: 1, kind: 'light-day-notice', date: '2026-10-26', episode: '2026-10-20', at: now.toISOString() };
    expect(isModuleEvent(event)).toBe(true);
    for (const bad of [{ ...event, text: 'free text' }, { ...event, episode: '2026-10-27' }, { ...event, date: '2026-02-30' }, { ...event, episode: 'bad' }]) expect(isModuleEvent(bad)).toBe(false);
  });
});

it('preserves cancellations and notice acknowledgements through encrypted two-device sync and backup v2', async () => {
  const a = await fresh(), b = await fresh(), records = new Map<string, RemoteRecord>(); let seq = 0;
  const api: Api = { async pull(since) { return { records: [...records.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq), more: false, seq }; },
    async push(rows) { for (const r of rows) records.set(r.k, { ...r, seq: ++seq }); return { seq }; } };
  const code = newCode(), keys = await deriveKeys(parseCode(code)!);
  for (const d of [a, b]) await d.meta.put({ key: 'sync', code, seq: 0 });
  await appendModuleEvents(a, lights('2026-10-01', 8));
  await markLightDayNoticeShown(a, '2026-10-08', new Date('2026-10-08T12:00:00'));
  await syncOnce(a, keys, api, 1000); await syncOnce(b, keys, api, 1100);
  expect(lightDayNotice(await b.moduleEvents.toArray(), new Date('2026-10-09T12:00:00'))).toBeUndefined();
  await setTodayLightDay(a, true, 'voice', new Date('2026-10-25T12:00:00'));
  await setTodayLightDay(b, true, 'manual', new Date('2026-10-25T13:00:00'));
  await setTodayLightDay(b, false, 'manual', new Date('2026-10-25T14:00:00'));
  await syncOnce(a, keys, api, 2000); await syncOnce(b, keys, api, 2100); await syncOnce(a, keys, api, 2200);
  for (const d of [a, b]) expect(isLightDay(await d.moduleEvents.toArray(), '2026-10-25')).toBe(false);
  expect(JSON.stringify([...records.values()])).not.toContain('light-day');
  const restored = await fresh(); await importAll(parseExport(JSON.stringify(await exportAll(a))), restored);
  const lightHistory = (events: ModuleEvent[]) => events.filter((e) => e.kind === 'light-day' || e.kind === 'light-day-notice');
  expect(lightHistory(await restored.moduleEvents.toArray())).toEqual(lightHistory(await a.moduleEvents.toArray()));
  expect(lightDayNotice(await restored.moduleEvents.toArray(), new Date('2026-10-09T12:00:00'))).toBeUndefined();
  expect(isLightDay(await restored.moduleEvents.toArray(), '2026-10-25')).toBe(false);
});
