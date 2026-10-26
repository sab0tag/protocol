import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProtocolDB, ensureSeeded } from '../../src/data/db';
import { setTodayLightDay } from '../../src/data/lightDay';
import { isModuleEvent, type ModuleEvent } from '../../src/domain/modulePreferences';
import { lightDayOnDate } from '../../src/domain/lightDay';
import { lightDayCommand } from '../../src/domain/voice';
import { parseReminderPolicy, policyFromEvents, reminderAllowed } from '../../server/src/reminderPolicy';
import { DEFAULT_REMINDERS, reminders } from '../../src/domain/reminders';
import type { Plan } from '../../src/domain/types';
const databases: ProtocolDB[] = [];
afterEach(async () => { for (const d of databases.splice(0)) await d.delete(); });
const plan: Plan = { prescriptions: [{ id: 'p', kind: 'medication', title: 'Private medicine', source: '', schedule: { times: ['13:00'] } }], constraints: [], targets: { waterMl: 2000 }, modes: [] };
async function fresh() { const d = new ProtocolDB('light-day-ui-' + crypto.randomUUID()); databases.push(d); await ensureSeeded(d); return d; }
describe('local light-day voice command (D140)', () => {
  it.each(['сьогодні легкий день', 'Сьогодні легкий день!', 'сьогодні легкий день, це все', 'сегодня лёгкий день', 'сегодня легкий день'])('recognizes the exact command %s', (s) => expect(lightDayCommand(s)).toBe(true));
  it.each(['не сьогодні легкий день', 'вчора легкий день', 'завтра легкий день', 'сьогодні легкий день, яблуко 100 г', 'не можу дихати сьогодні легкий день', 'скасуй сьогодні легкий день'])('never infers a command from %s', (s) => expect(lightDayCommand(s)).toBe(false));
});
describe('persisted midnight bounds and shared reminder policy', () => {
  it.each([['2026-03-29', 23], ['2026-10-25', 25]] as const)('keeps the %s window of %s hours through projection, cancel and timezone change', async (date, hours) => {
    const d = await fresh(), now = new Date(`${date}T12:00:00`);
    await setTodayLightDay(d, true, 'voice', now);
    const events = await d.moduleEvents.toArray(), event = events[0];
    expect(isModuleEvent(event)).toBe(true);
    const policy = policyFromEvents(events, +now), rule = policy.days[0]!;
    expect(parseReminderPolicy(policy)).toEqual(policy); expect(rule.until - rule.from).toBe(hours * 3_600_000);
    try {
      vi.stubEnv('TZ', 'UTC'); expect(policyFromEvents(events, +now).days[0]).toEqual(rule);
      expect(lightDayOnDate(events, date, new Date(rule.until + 1000))).toBe(false);
    }
    finally { vi.unstubAllEnvs(); }
    const later = new Date(+now + 60_000); await setTodayLightDay(d, false, 'manual', later);
    const cancelled = policyFromEvents(await d.moduleEvents.toArray(), +later).days[0]!;
    expect(cancelled).toMatchObject({ enabled: false, from: rule.from, until: rule.until });
    for (const bad of [{ ...event, until: rule.from + 22 * 3_600_000 }, { ...event, from: undefined }, { ...event, from: rule.from - 30 * 86_400_000 }]) expect(isModuleEvent(bad)).toBe(false);
  });
  it('suppresses non-medication work today, leaves meds byte-identical, and preloads normal tomorrow without a midnight launch', async () => {
    const d = await fresh(), now = new Date('2026-10-25T12:00:00'); await setTodayLightDay(d, true, 'manual', now);
    const policy = policyFromEvents(await d.moduleEvents.toArray(), +now), until = policy.days[0]!.until;
    const args = { entries: [], plan, settings: { ...DEFAULT_REMINDERS, waterEveryH: 3 as const, waterIfBehind: false }, now, days: 2 };
    const before = reminders(args), after = reminders({ ...args, policy });
    expect(after.items.filter((x) => x.payload.k === 'med')).toEqual(before.items.filter((x) => x.payload.k === 'med'));
    expect(after.items.filter((x) => x.payload.k === 'water').every((x) => x.at >= until)).toBe(true);
    expect(after.items.some((x) => x.payload.k === 'water' && x.payload.d === '2026-10-26')).toBe(true);
    expect(reminderAllowed(policy, { k: 'water' }, until, until)).toBe(true);
    expect(reminderAllowed(policy, { k: 'water', o: +now }, until + 1000, until + 1000)).toBe(false);
    for (const k of ['test', 'visit']) expect(reminderAllowed(policy, { k }, +now)).toBe(true);
  });
  it('after cancel resumes only future slots, rejecting past repeats and future snoozes of a past slot', async () => {
    const d = await fresh(), now = new Date('2026-10-25T12:00:00');
    await setTodayLightDay(d, true, 'manual', now); await setTodayLightDay(d, false, 'manual', new Date(+now + 3_600_000));
    const policy = policyFromEvents(await d.moduleEvents.toArray(), +now);
    for (const k of ['meal', 'water', 'evening', 'week', 'weight', 'topup']) {
      expect(reminderAllowed(policy, { k }, +now, +now + 3_600_000)).toBe(false);
      expect(reminderAllowed(policy, { k, o: +now }, +now + 5_400_000, +now + 3_600_000)).toBe(false);
      expect(reminderAllowed(policy, { k }, +now + 5_400_000, +now + 3_600_000)).toBe(true);
    }
    expect(reminderAllowed(policy, { k: 'med' }, +now, +now + 3_600_000)).toBe(true);
    expect(reminderAllowed(policy, { k: 'morning' }, +now, +now + 3_600_000)).toBe(true); // its medication part remains
  });
  it('caps the projection to a bounded rolling horizon, retaining off tombstones and deterministic event order', () => {
    const now = new Date('2026-10-25T12:00:00');
    const events: ModuleEvent[] = Array.from({ length: 100 }, (_, i) => {
      const day = new Date(+now + (i - 50) * 86_400_000), date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      return { id: `d-${i}`, v: 1, kind: 'light-day', at: day.toISOString(), date, enabled: i % 2 === 0, source: 'manual' };
    });
    const p = policyFromEvents(events, +now); expect(p.days.length).toBeLessThanOrEqual(39);
    expect(p.days.some((d) => !d.enabled)).toBe(true); expect(parseReminderPolicy(p)).toEqual(p);
    expect(policyFromEvents([...events].reverse(), +now)).toEqual(p);
  });
});
