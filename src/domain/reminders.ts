// What to remind about and when (SPEC.md D34). Pure. Each reminder has a stable key — the same on every device
// of the person, so a tick on one device stops the repeats on all of them. The payload carries only a generic
// word; the phone's service worker reads the details (what to eat, which medicine) from its own data.
import { addDays, format } from 'date-fns';
import { dateOf } from './dates';
import type { DayEntry, Plan } from './types';

export interface ReminderSettings {
  meals: boolean;
  meds: boolean;
  waterEveryH: 0 | 2 | 3;
  repeatMin: 0 | 10 | 15 | 30; // 0 = no repeat; otherwise up to 2 more times
}

export const DEFAULT_REMINDERS: ReminderSettings = { meals: true, meds: true, waterEveryH: 0, repeatMin: 15 };

export interface Reminder {
  key: string;
  at: number; // ms
  payload: { t: string; b: string; k: 'meal' | 'med' | 'water'; u: string; tag: string; e?: string; h?: string };
}

const WATER_FROM = 9, WATER_TO = 21;

export function reminders(args: { entries: DayEntry[]; plan: Plan | undefined; settings: ReminderSettings; now: Date; days?: number }) {
  const { entries, plan, settings, now } = args;
  const days = args.days ?? 7;
  const from = now.getTime() - (settings.repeatMin ? settings.repeatMin * 3 : 1) * 60_000; // still repeating
  const to = now.getTime() + days * 86_400_000;
  const items: Reminder[] = [];
  const done: string[] = [];
  const url = (d: string) => `./#/?date=${d}`;

  if (settings.meals) {
    for (const e of entries) {
      if (e.kind !== 'meal') continue;
      const at = Date.parse(e.at);
      if (at < from - 86_400_000 || at > to) continue;
      const key = `meal:${e.id}:${e.at}`;
      if (e.status !== 'planned') { done.push(key); continue; }
      if (at < from) continue;
      items.push({ key, at, payload: { t: e.title, b: 'Час їсти — відкрийте, щоб відмітити', k: 'meal', u: url(dateOf(e.at)), tag: key, e: e.id } });
    }
  }

  const dates = Array.from({ length: days + 2 }, (_, i) => format(addDays(now, i - 1), 'yyyy-MM-dd'));
  if (settings.meds && plan) {
    const ticked = new Set(entries.filter((e) => e.checkKey && e.status === 'done').map((e) => `${dateOf(e.at)}|${e.checkKey}`));
    const times = new Set<string>();
    for (const p of plan.prescriptions) if (p.kind === 'medication' || p.kind === 'supplement') for (const t of p.schedule?.times ?? []) times.add(t);
    for (const d of dates) {
      for (const time of times) {
        const at = new Date(`${d}T${time}:00`).getTime();
        const key = `med:${d}:${time}`;
        const meds = plan.prescriptions.filter((p) => p.schedule?.times.includes(time) && (p.kind === 'medication' || p.kind === 'supplement'));
        if (meds.every((p) => ticked.has(`${d}|med:${p.id}:${time}`))) { done.push(key); continue; }
        if (at < from || at > to) continue;
        items.push({ key, at, payload: { t: 'Ліки', b: 'Час прийняти — відкрийте, щоб відмітити', k: 'med', u: url(d), tag: key, h: time } });
      }
    }
  }

  if (settings.waterEveryH) {
    for (const d of dates) {
      for (let h = WATER_FROM; h <= WATER_TO; h += settings.waterEveryH) {
        const time = `${String(h).padStart(2, '0')}:00`;
        const at = new Date(`${d}T${time}:00`).getTime();
        if (at < now.getTime() || at > to) continue;
        const key = `water:${d}:${time}`;
        items.push({ key, at, payload: { t: 'Вода', b: 'Склянка води', k: 'water', u: url(d), tag: key } });
      }
    }
  }
  items.sort((a, b) => a.at - b.at);
  return { items: items.slice(0, 400), done };
}
