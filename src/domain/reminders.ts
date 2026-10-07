// What to remind about and when (SPEC.md D34, D35). Pure. Each reminder has a stable key — the same on every
// device of the person, so a tick on one device stops the repeats on all of them. The payload carries only a
// generic word; the phone's service worker reads the details (what to eat, which medicine) from its own data.
import { addDays, format } from 'date-fns';
import { dateOf, timeOf } from './dates';
import type { DayEntry, Plan, Prescription } from './types';

export interface ReminderSettings {
  meals: boolean;
  meds: boolean;
  waterEveryH: 0 | 2 | 3;
  repeatMin: 0 | 10 | 15 | 30; // 0 = no repeat; otherwise up to 2 more times
  morning: string; // D35: '' = off, else "HH:MM" — the day's plan in one message
  evening: string; // D35: '' = off — tomorrow's prep tips, or «скласти меню?»
  visits: boolean; // D35: lab tests due and the next checkup
  weekly?: boolean; // D38: Sunday 19:00 — the week in numbers
  weightDay?: number; // D38: 0 = off, 1–7 = ISO weekday of a weighing reminder (at the morning time or 08:00)
}

export const DEFAULT_REMINDERS: ReminderSettings = { meals: true, meds: true, waterEveryH: 0, repeatMin: 15, morning: '07:30', evening: '20:30', visits: true,
  weekly: true, weightDay: 1 };

export type ReminderKind = 'meal' | 'med' | 'water' | 'morning' | 'evening' | 'test' | 'visit' | 'week' | 'weight';

export interface Reminder {
  key: string;
  at: number; // ms
  once?: boolean; // never repeated
  payload: { t: string; b: string; k: ReminderKind; u: string; tag: string; e?: string; h?: string; d?: string };
}

const WATER_FROM = 9, WATER_TO = 21;
const isMed = (p: Prescription) => p.kind === 'medication' || p.kind === 'supplement';

export function reminders(args: { entries: DayEntry[]; plan: Plan | undefined; settings: ReminderSettings; now: Date;
  days?: number; snoozed?: Record<string, number> }) {
  const { entries, plan, settings, now } = args;
  const days = args.days ?? 30; // D35: daily ones a month ahead — they keep coming even if the app is not opened
  const snoozed = args.snoozed ?? {};
  const t0 = now.getTime();
  const from = t0 - (settings.repeatMin ? settings.repeatMin * 3 : 1) * 60_000; // still repeating
  const to = t0 + (days + 1) * 86_400_000;
  const items: Reminder[] = [];
  const done: string[] = [];
  const url = (d: string) => `./#/?date=${d}`;
  const at = (d: string, time: string) => new Date(`${d}T${time}:00`).getTime();
  const dates = Array.from({ length: days + 2 }, (_, i) => format(addDays(now, i - 1), 'yyyy-MM-dd'));
  const push = (r: Reminder) => {
    const until = snoozed[r.key];
    if (until && until > t0) { // «Пізніше»: the original stops, a new one comes at the snooze time
      done.push(r.key);
      items.push({ ...r, key: `snooze:${r.key}:${until}`, at: until, payload: { ...r.payload, tag: `snooze:${r.key}` } });
    } else if (r.at >= (r.once ? t0 : from) && r.at <= to) items.push(r);
  };

  if (settings.meals) {
    for (const e of entries) {
      if (e.kind !== 'meal') continue;
      const key = `meal:${e.id}:${e.at}`;
      if (e.status !== 'planned') { done.push(key); continue; }
      push({ key, at: Date.parse(e.at), payload: { t: e.title, b: 'Час їсти — відкрийте, щоб відмітити', k: 'meal', u: url(dateOf(e.at)), tag: key, e: e.id } });
    }
  }

  if (settings.meds && plan) {
    const ticked = new Set(entries.filter((e) => e.checkKey && e.status === 'done').map((e) => `${dateOf(e.at)}|${e.checkKey}`));
    const times = [...new Set(plan.prescriptions.filter(isMed).flatMap((p) => p.schedule?.times ?? []))];
    for (const d of dates) {
      for (const time of times) {
        const key = `med:${d}:${time}`;
        const meds = plan.prescriptions.filter((p) => isMed(p) && p.schedule?.times.includes(time));
        if (meds.every((p) => ticked.has(`${d}|med:${p.id}:${time}`))) { done.push(key); continue; }
        push({ key, at: at(d, time), payload: { t: 'Ліки', b: 'Час прийняти — відкрийте, щоб відмітити', k: 'med', u: url(d), tag: key, h: time } });
      }
    }
  }

  for (const d of dates) {
    if (settings.waterEveryH && d <= format(addDays(now, 7), 'yyyy-MM-dd')) {
      for (let h = WATER_FROM; h <= WATER_TO; h += settings.waterEveryH) {
        const time = `${String(h).padStart(2, '0')}:00`;
        push({ key: `water:${d}:${time}`, at: at(d, time), once: true, payload: { t: 'Вода', b: 'Склянка води', k: 'water', u: url(d), tag: `water:${d}` } });
      }
    }
    if (settings.morning) {
      push({ key: `morning:${d}`, at: at(d, settings.morning), once: true,
        payload: { t: 'План на сьогодні', b: 'Відкрийте, щоб подивитися день', k: 'morning', u: url(d), tag: `morning:${d}`, d } });
    }
    const wd = ((new Date(`${d}T12:00:00`).getDay() + 6) % 7) + 1; // ISO weekday
    if (settings.weekly && wd === 7) {
      push({ key: `week:${d}`, at: at(d, '19:00'), once: true,
        payload: { t: 'Тиждень у цифрах', b: 'Подивіться «Прогрес»', k: 'week', u: './#/progress', tag: `week:${d}`, d } });
    }
    if (settings.weightDay && wd === settings.weightDay) {
      push({ key: `weight:${d}`, at: at(d, settings.morning || '08:00') + 5 * 60_000, once: true,
        payload: { t: 'Зважування', b: 'Зранку, до сніданку — і запишіть у «Прогрес»', k: 'weight', u: './#/progress', tag: `weight:${d}`, d } });
    }
    if (settings.evening) {
      const next = format(addDays(new Date(`${d}T12:00:00`), 1), 'yyyy-MM-dd');
      push({ key: `evening:${d}`, at: at(d, settings.evening), once: true,
        payload: { t: 'На завтра', b: 'Відкрийте, щоб підготуватися', k: 'evening', u: url(next), tag: `evening:${d}`, d: next } });
    }
  }

  if (settings.visits && plan) {
    const before = (d: string) => format(addDays(new Date(`${d}T12:00:00`), -1), 'yyyy-MM-dd');
    for (const due of [...new Set(plan.prescriptions.filter((p) => p.kind === 'test' && p.dueDate).map((p) => p.dueDate!))]) {
      push({ key: `test:${due}:eve`, at: at(before(due), '19:00'), once: true, payload: { t: 'Завтра — аналізи', b: 'Перевірте, що потрібно', k: 'test', u: url(due), tag: `test:${due}`, d: due } });
      push({ key: `test:${due}`, at: at(due, '07:00'), once: true, payload: { t: 'Сьогодні — аналізи', b: 'Перевірте, що потрібно', k: 'test', u: url(due), tag: `test:${due}`, d: due } });
    }
    const visit = plan.nextCheckup?.date;
    if (visit) {
      push({ key: `visit:${visit}:eve`, at: at(before(visit), '19:00'), once: true, payload: { t: 'Завтра — візит до лікаря', b: 'Підготуйте звіт і питання', k: 'visit', u: './#/report', tag: `visit:${visit}`, d: visit } });
      push({ key: `visit:${visit}`, at: at(visit, '08:00'), once: true, payload: { t: 'Сьогодні — візит до лікаря', b: 'Звіт і питання — у «Звіт для лікаря»', k: 'visit', u: './#/report', tag: `visit:${visit}`, d: visit } });
    }
  }

  items.sort((a, b) => a.at - b.at);
  return { items: items.slice(0, 480), done };
}

// ------------------------------------------------------------------ «Зараз» on «День» (D35)
export interface NowMed { key: string; title: string; prescriptionId: string }
export interface NowItem {
  key: string; // the reminder key — «Пізніше» snoozes it
  kind: 'meal' | 'med';
  time: string;
  title: string;
  overdue: boolean;
  entry?: DayEntry; // meal
  meds?: NowMed[]; // the medicines due at this time, not yet ticked
}

/** The one thing to do now: the earliest overdue item of today, else the next one. Snoozed ones wait. */
export function nowItem(args: { entries: DayEntry[]; plan: Plan | undefined; date: string; now: Date; snoozed?: Record<string, number> }): NowItem | undefined {
  const { entries, plan, date, now } = args;
  const t0 = now.getTime();
  const sleeping = (key: string) => (args.snoozed?.[key] ?? 0) > t0;
  const nowHm = format(now, 'HH:mm');
  const out: NowItem[] = [];
  for (const e of entries) {
    if (e.kind !== 'meal' || e.status !== 'planned' || dateOf(e.at) !== date) continue;
    const key = `meal:${e.id}:${e.at}`;
    if (!sleeping(key)) out.push({ key, kind: 'meal', time: timeOf(e.at), title: e.title, overdue: timeOf(e.at) <= nowHm, entry: e });
  }
  const ticked = new Set(entries.filter((e) => e.checkKey && e.status === 'done' && dateOf(e.at) === date).map((e) => e.checkKey!));
  const byTime = new Map<string, NowMed[]>();
  for (const p of plan?.prescriptions ?? []) {
    if (!isMed(p)) continue;
    for (const time of p.schedule?.times ?? []) {
      const key = `med:${p.id}:${time}`;
      if (!ticked.has(key)) byTime.set(time, [...(byTime.get(time) ?? []), { key, title: [p.title, p.dose].filter(Boolean).join(' '), prescriptionId: p.id }]);
    }
  }
  for (const [time, meds] of byTime) {
    const key = `med:${date}:${time}`;
    if (!sleeping(key)) out.push({ key, kind: 'med', time, title: 'Ліки', overdue: time <= nowHm, meds });
  }
  out.sort((a, b) => a.time.localeCompare(b.time));
  return out.find((x) => x.overdue) ?? out[0];
}
