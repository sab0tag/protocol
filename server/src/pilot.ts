// The pilot's numbers by consent (SPEC.md D119). The phone counts a week of its own records and sends only counts —
// never a name, a date, a dose, a food or a word of free text (the only text is a «Що заважало» note, sent by its own
// button). A participant is a random pid with a secret, given at consent; nothing links it to a vault or a device token.
import { z } from 'zod';
import { isoWeek } from './conciergeLog.ts';

const DAY = 86_400_000;
export const PID = /^p_[a-z2-7]{10}$/;
export const SECRET = /^[A-Za-z0-9_-]{43}$/;
export const WEEK = /^\d{4}-W\d{2}$/;
export const SRC = /^[A-Z0-9-]{4,12}$/;
const BUILD = /^(index-[A-Za-z0-9_-]{6,16}|dev)$/;
export const PLATFORMS = ['ios-pwa', 'ios-browser', 'android-pwa', 'android-browser', 'desktop', 'other'] as const;
export const BLOCKERS = ['slow_food', 'not_found', 'forget', 'too_many_reminders', 'unclear', 'other'] as const;
export const REPORT_SHOWN = ['yes', 'no', 'no_visit'] as const;

/** 'YYYY-Www' of a date (ISO week, UTC). */
export function weekKey(d: Date): string {
  const [y, w] = isoWeek(d);
  return `${y}-W${String(w).padStart(2, '0')}`;
}
/** Monday 00:00 UTC of a week key. */
export function weekMonday(key: string): number {
  const [y = 0, w = 0] = key.split('-W').map(Number);
  const jan4 = Date.UTC(y, 0, 4);
  return jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY + (w - 1) * 7 * DAY;
}
export const weekAdd = (key: string, n: number) => weekKey(new Date(weekMonday(key) + n * 7 * DAY));
export const weeksBetween = (from: string, to: string) => Math.round((weekMonday(to) - weekMonday(from)) / (7 * DAY));

const n = (max: number) => z.number().int().min(0).max(max);
// strict: an extra field, a string for a number or a missing count is a 400 — what is not on the list does not get in
const summary = z.strictObject({
  v: z.literal(1),
  pid: z.string().regex(PID),
  week: z.string().regex(WEEK),
  src: z.string().regex(SRC).optional(),
  days_in: n(3650),
  active_days: n(7),
  meds: z.strictObject({ due: n(500), done: n(500), skipped: n(500), late_30: n(500), prn_taken: n(500) }),
  food: z.strictObject({ days_logged: n(7), entries: n(1000), by_voice: n(1000), by_text: n(1000), by_photo: n(1000), not_found: n(1000) }),
  plan: z.strictObject({ meds: n(100), constraints: n(100), from_photo: z.boolean(), photo_rows: n(200), photo_rows_edited: n(200) }),
  help: z.strictObject({ why_opened: n(1000), topup_shown: n(1000), topup_taken: n(1000), danger_card: n(1000) }),
  rem: z.strictObject({ sent: n(2000), acked: n(2000) }).optional(),
  other: z.strictObject({ water_days: n(7), workouts: n(50), wellbeing_days: n(7), report_made: n(50) }),
  app: z.strictObject({ build: z.string().regex(BUILD), platform: z.enum(PLATFORMS) }),
});
const survey = z.strictObject({
  v: z.literal(1),
  pid: z.string().regex(PID),
  week: z.string().regex(WEEK),
  survey: z.enum(['d7', 'd30']),
  q: z.strictObject({
    helps: z.number().int().min(1).max(5),
    blocker: z.enum(BLOCKERS).optional(), // d7
    report: z.enum(REPORT_SHOWN).optional(), // d30
    nps: z.number().int().min(0).max(10).optional(), // d30
  }),
}).refine((s) => (s.survey === 'd7' ? s.q.report === undefined && s.q.nps === undefined : s.q.blocker === undefined), { message: 'wrong questions' });
const note = z.strictObject({
  v: z.literal(1),
  pid: z.string().regex(PID),
  week: z.string().regex(WEEK),
  nid: z.string().regex(/^[a-z0-9]{6,16}$/),
  note: z.string().min(1).max(1000),
});

export type Summary = z.infer<typeof summary>;
export type Survey = z.infer<typeof survey>;
export type PilotRecord = { kind: 'week'; body: Summary } | { kind: 'd7' | 'd30'; body: Survey } | { kind: `note:${string}`; body: z.infer<typeof note> };

/** The one record kind a body is, or null — then nothing is written. */
export function parsePilot(x: unknown): PilotRecord | null {
  const o = x as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return null;
  if ('survey' in o) { const r = survey.safeParse(o); return r.success ? { kind: r.data.survey, body: r.data } : null; }
  if ('note' in o) { const r = note.safeParse(o); return r.success ? { kind: `note:${r.data.nid}`, body: r.data } : null; }
  const r = summary.safeParse(o);
  return r.success ? { kind: 'week', body: r.data } : null;
}

/** The nightly purge: pilot records after 12 months (52 weeks), the vaults' online weeks after 56. */
export function pilotHousekeeping(store: { purgePilot(before: string): number; purgeSeen(before: string): number }, now: Date) {
  const week = weekKey(now);
  return { pilot: store.purgePilot(weekAdd(week, -52)), seen: store.purgeSeen(weekAdd(week, -56)) };
}
