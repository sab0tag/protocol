// «Мій день» (SPEC.md §5.4): built from the plan, ticked by DayEntries carrying a checkKey (D18). Pure.
import { differenceInMinutes } from 'date-fns';
import { timeOf } from './dates';
import { activeMode, dayTotals, effectiveTargets } from './nutrition';
import type { DayEntry, Food, ISODate, Plan, Workout } from './types';
import { workoutDay } from './workouts';

export const WATER_SEGMENT_ML = 250;
export const WATER_SEGMENTS = 10;
export const DINNER_COUNTDOWN_MIN = 120;

export type CheckKind = 'med' | 'water' | 'workout' | 'dinner' | 'mode';

export interface CheckItem {
  key: string;
  kind: CheckKind;
  title: string;
  detail?: string;
  done: boolean;
  doneAt?: string; // "HH:mm" of the tick
  /** Ticked by tapping (med, dinner); water and mode goals follow the data, the workout opens its log. */
  tappable: boolean;
  prescriptionId?: string;
  time?: string; // scheduled "HH:mm"
  minutesLeft?: number; // dinner: shown within DINNER_COUNTDOWN_MIN before lastMealBy
  late?: boolean; // dinner: the time has passed and it is not ticked
}

export interface Checklist {
  items: CheckItem[];
  done: number;
  total: number;
  water: { ml: number; segments: number; target?: number };
  /** The workout was due but a test tomorrow moved it (§5.6). */
  workoutNote?: string;
}

export function buildChecklist(args: {
  plan: Plan | undefined; date: ISODate; entries: DayEntry[]; workouts: Workout[]; foods: Map<string, Food>; now: Date;
}): Checklist {
  const { plan, date, entries, workouts, foods, now } = args;
  const ticks = new Map(entries.filter((e) => e.checkKey && e.status === 'done').map((e) => [e.checkKey!, e]));
  const targets = effectiveTargets(plan, date);
  const totals = dayTotals(entries, foods);
  const items: CheckItem[] = [];

  for (const p of plan?.prescriptions ?? []) {
    if (p.kind !== 'medication' && p.kind !== 'supplement') continue;
    // D49: a medicine without a time in the plan is once a day, whenever — still on the list, not forgotten
    const times: (string | undefined)[] = p.schedule?.times.length ? p.schedule.times : [undefined];
    for (const time of times) {
      const key = `med:${p.id}:${time ?? 'day'}`;
      const tick = ticks.get(key);
      items.push({ key, kind: 'med', title: p.title, ...(time ? { time } : {}), prescriptionId: p.id, tappable: true,
        detail: [time ?? 'раз на день', p.dose, p.schedule?.withFood ? 'під час їжі' : undefined].filter(Boolean).join(' · '),
        done: !!tick, ...(tick ? { doneAt: timeOf(tick.at) } : {}) });
    }
  }
  items.sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99')); // «раз на день» after the timed ones

  const water = { ml: totals.waterMl, segments: Math.min(WATER_SEGMENTS, Math.floor(totals.waterMl / WATER_SEGMENT_ML)),
    ...(targets.waterMl ? { target: targets.waterMl } : {}) };
  if (targets.waterMl) {
    items.push({ key: 'water', kind: 'water', title: 'Вода', tappable: false, done: totals.waterMl >= targets.waterMl,
      detail: `${totals.waterMl} / ${targets.waterMl} мл` });
  }

  const wd = workoutDay(plan, workouts, date);
  const workedOut = workouts.some((w) => w.date === date);
  if (wd.due || workedOut) {
    items.push({ key: 'workout', kind: 'workout', title: 'Тренування', tappable: false, done: workedOut, detail: 'Гиря 16 кг' });
  }

  if (targets.lastMealBy) {
    const tick = ticks.get('dinner');
    const deadline = new Date(`${date}T${targets.lastMealBy}:00`);
    const left = differenceInMinutes(deadline, now);
    items.push({ key: 'dinner', kind: 'dinner', title: `Вечеря до ${targets.lastMealBy}`, tappable: true, done: !!tick,
      ...(tick ? { doneAt: timeOf(tick.at) } : {}),
      ...(!tick && left > 0 && left <= DINNER_COUNTDOWN_MIN ? { minutesLeft: left } : {}),
      ...(!tick && left <= 0 ? { late: true } : {}) });
  }

  const mode = activeMode(plan, date)?.mode;
  const min = mode?.targetsOverride.carbsG?.min;
  if (mode && min != null) {
    items.push({ key: 'mode:carbs', kind: 'mode', title: `Вуглеводи не менше ${min} г`, tappable: false,
      done: totals.carbs >= min, detail: `${Math.round(totals.carbs)} г · ${mode.title}` });
  }

  const done = items.filter((i) => i.done).length;
  return { items, done, total: items.length, water, ...(wd.postponed ? { workoutNote: wd.postponed } : {}) };
}
