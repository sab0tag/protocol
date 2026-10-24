// The pilot's weekly summary (SPEC.md D119). Pure: a week of the person's own data in, only counts out — the same rules as
// «День» and the report (a dose due — D97, D103; «за потреби» not in due). The consent screen shows exactly this for the
// last week, and exactly this is sent. No name, no date but the week, no dose, no food, no free text: a test holds it.
import { addDays, differenceInCalendarDays, format, getISOWeek, getISOWeekYear, parseISO, setISOWeek, startOfISOWeek } from 'date-fns';
import { buildChecklist } from './checklist';
import { dateOf } from './dates';
import { prnMeds, prnTaken } from './prn';
import type { DayEntry, Food, ISODate, Plan, Wellbeing, WeightLog, Workout } from './types';

/** The text of the consent screen; a new version with new fields asks for consent again. */
export const CONSENT_VERSION = 1;
export const PLATFORMS = ['ios-pwa', 'ios-browser', 'android-pwa', 'android-browser', 'desktop', 'other'] as const;
export type Platform = (typeof PLATFORMS)[number];

export interface Summary {
  v: 1; pid: string; week: string; src?: string; days_in: number; active_days: number;
  meds: { due: number; done: number; skipped: number; late_30: number; prn_taken: number };
  food: { days_logged: number; entries: number; by_voice: number; by_text: number; by_photo: number; not_found: number };
  plan: { meds: number; constraints: number; from_photo: boolean; photo_rows: number; photo_rows_edited: number };
  help: { why_opened: number; topup_shown: number; topup_taken: number; danger_card: number };
  rem?: { sent: number; acked: number };
  other: { water_days: number; workouts: number; wellbeing_days: number; report_made: number };
  app: { build: string; platform: Platform };
}

export interface PilotData {
  plan: Plan | undefined; entries: DayEntry[]; workouts: Workout[]; wellbeing: Wellbeing[]; weights: WeightLog[]; foods: Map<string, Food>;
  /** the week's counts from data/tally.ts */
  tallies: Partial<Record<'nf' | 'why' | 'topup_shown' | 'topup_taken' | 'danger' | 'report' | 'photo_rows' | 'photo_edit' | 'rem_sent' | 'rem_open', number>>;
  fromPhoto: boolean; // a line of the plan came off a doctor's paper (D114 pieces)
  remindersOn: boolean;
  pid: string; src?: string; build: string; platform: Platform;
}

/** 'YYYY-Www' of a local date. */
export const weekOf = (d: Date | ISODate): string => {
  const x = typeof d === 'string' ? parseISO(d) : d;
  return `${getISOWeekYear(x)}-W${String(getISOWeek(x)).padStart(2, '0')}`;
};
/** The seven dates of a week, Monday first. */
export function weekDays(week: string): ISODate[] {
  const [y = 0, w = 0] = week.split('-W').map(Number);
  const monday = startOfISOWeek(setISOWeek(new Date(y, 0, 4), w));
  return Array.from({ length: 7 }, (_, i) => format(addDays(monday, i), 'yyyy-MM-dd'));
}
export const weekShift = (week: string, n: number) => weekOf(addDays(parseISO(weekDays(week)[0]!), n * 7));

const minutes = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const isMed = (k: string) => k === 'medication' || k === 'supplement';

export function weekSummary(data: PilotData, week: string): Summary {
  const { plan, entries, workouts, wellbeing, weights, foods, tallies: n } = data;
  const days = weekDays(week), first = days[0]!, last = days[6]!;
  const inWeek = entries.filter((e) => { const d = dateOf(e.at); return d >= first && d <= last; });
  const byDay = new Map(days.map((d) => [d, inWeek.filter((e) => dateOf(e.at) === d)]));
  const meds = { due: 0, done: 0, skipped: 0, late_30: 0, prn_taken: 0 };
  for (const d of days) {
    const day = byDay.get(d)!;
    // the same list as «Ліки N з M» on «День» that day
    for (const i of buildChecklist({ plan, date: d, entries: day, workouts, foods, now: new Date(`${d}T23:59:00`) }).items) {
      if (i.kind !== 'med') continue;
      meds.due += 1;
      if (i.done) {
        meds.done += 1;
        if (i.time && i.doneAt && minutes(i.doneAt) - minutes(i.time) > 30) meds.late_30 += 1;
      } else if (i.skipped) meds.skipped += 1;
    }
    for (const p of prnMeds(plan, d)) meds.prn_taken += prnTaken(p, day, d);
  }
  const meals = inWeek.filter((e) => e.kind === 'meal' && e.status === 'done');
  const recorded = new Set([
    ...inWeek.filter((e) => e.status !== 'planned').map((e) => dateOf(e.at)),
    ...workouts.map((w) => w.date), ...wellbeing.map((w) => w.date), ...weights.map((w) => w.date),
  ].filter((d) => d >= first && d <= last));
  const firstDay = [...entries.filter((e) => e.status !== 'planned').map((e) => dateOf(e.at)), ...workouts.map((w) => w.date),
    ...wellbeing.map((w) => w.date), ...weights.map((w) => w.date), ...(plan?.onboardedAt ? [plan.onboardedAt] : [])].sort()[0];
  const voice = meals.filter((e) => e.via === 'voice').length, photo = meals.filter((e) => e.via === 'photo').length;
  return {
    v: 1, pid: data.pid, week, ...(data.src ? { src: data.src } : {}),
    days_in: firstDay && firstDay <= last ? differenceInCalendarDays(parseISO(last), parseISO(firstDay)) + 1 : 0,
    active_days: recorded.size,
    meds,
    food: { days_logged: new Set(meals.map((e) => dateOf(e.at))).size, entries: meals.length, by_voice: voice, by_text: meals.length - voice - photo,
      by_photo: photo, not_found: n.nf ?? 0 },
    plan: {
      meds: (plan?.prescriptions ?? []).filter((p) => isMed(p.kind) && !(p.since && p.since > last) && !(p.until && p.until < first)).length,
      constraints: (plan?.constraints ?? []).filter((c) => c.active).length,
      from_photo: data.fromPhoto, photo_rows: n.photo_rows ?? 0, photo_rows_edited: n.photo_edit ?? 0,
    },
    help: { why_opened: n.why ?? 0, topup_shown: n.topup_shown ?? 0, topup_taken: n.topup_taken ?? 0, danger_card: n.danger ?? 0 },
    ...(data.remindersOn ? { rem: { sent: n.rem_sent ?? 0, acked: n.rem_open ?? 0 } } : {}),
    other: {
      water_days: new Set(inWeek.filter((e) => e.kind === 'water' && e.status === 'done').map((e) => dateOf(e.at))).size,
      workouts: workouts.filter((w) => w.date >= first && w.date <= last).length,
      wellbeing_days: new Set(wellbeing.filter((w) => w.date >= first && w.date <= last).map((w) => w.date)).size,
      report_made: n.report ?? 0,
    },
    app: { build: data.build, platform: data.platform },
  };
}

/** The weeks to send now: finished ones (before this week), not older than 4, from the week before consent on, not sent yet. */
export function weeksDue(now: Date, consentAt: string, sent: Iterable<string>): string[] {
  const done = new Set(sent), current = weekOf(now), from = weekShift(weekOf(parseISO(consentAt)), -1);
  const out: string[] = [];
  for (let k = 4; k >= 1; k -= 1) {
    const w = weekShift(current, -k);
    if (w >= from && !done.has(w)) out.push(w);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ surveys (D121)
export type SurveyKind = 'd7' | 'd30';
export const BLOCKERS = ['slow_food', 'not_found', 'forget', 'too_many_reminders', 'unclear', 'other'] as const;
export const REPORT_SHOWN = ['yes', 'no', 'no_visit'] as const;
export interface SurveyState { done?: true; later?: ISODate[]; answer?: SurveyAnswer; sent?: true; week?: string }
export interface SurveyAnswer { helps: number; blocker?: (typeof BLOCKERS)[number]; report?: (typeof REPORT_SHOWN)[number]; nps?: number }

/** The survey to show on «День» today: the 7th day of taking part (the day of consent is the 1st), then the 30th; «Не зараз» —
 *  tomorrow again, and after the second one it is gone. */
export function surveyDue(consentAt: string | undefined, surveys: Partial<Record<SurveyKind, SurveyState>>, today: ISODate): SurveyKind | null {
  if (!consentAt) return null;
  const day = differenceInCalendarDays(parseISO(today), parseISO(consentAt.slice(0, 10))) + 1;
  for (const [kind, from] of [['d7', 7], ['d30', 30]] as const) {
    const s = surveys[kind] ?? {};
    if (day < from || s.done || (s.later?.length ?? 0) >= 2 || s.later?.includes(today)) continue;
    return kind;
  }
  return null;
}

/** A capitalised word not at the start of a sentence is taken for a name (the same rule as the concierge's log on the server). */
export function scrubNames(text: string): string {
  return text.split(/(?<=[.!?])\s+/u).map((sentence) => {
    let first = true;
    return sentence.replace(/\p{L}[\p{L}’'-]*/gu, (w) => {
      const name = !first && /^\p{Lu}\p{Ll}/u.test(w);
      first = false;
      return name ? '[ім’я]' : w;
    });
  }).join(' ');
}
