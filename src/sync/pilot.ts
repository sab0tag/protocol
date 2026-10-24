// D119: the pilot by consent on this device. Nothing goes without the consent of the current text; the example (D98) never
// sends. Once a week, on the first opening after Sunday, the finished weeks (up to 4 back) are counted by domain/pilot.ts and
// sent; a week sent is kept as it went, for «Ще → Пілот». «Видалити надіслане» deletes on the server and forgets the
// participant — the next week goes with a new pid only after a new consent.
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { db, inDemo, normalizePlan, type PilotMeta } from '../data/db';
import { tallies } from '../data/tally';
import { appVersion } from '../domain/concierge';
import { dateOf, todayISO } from '../domain/dates';
import { CONSENT_VERSION, scrubNames, weekDays, weekOf, weeksDue, weekShift, weekSummary, type Platform, type Summary, type SurveyAnswer, type SurveyKind } from '../domain/pilot';
import { ApiError, pilotJoin, pilotLeave, pilotSend, pilotSource } from './api';

export const SRC = /^[A-Z0-9-]{4,12}$/;
const KEY = 'pilot' as const;

export const pilotMeta = async (): Promise<PilotMeta> => (await db.pilot.get(KEY).catch(() => undefined)) ?? { key: KEY };
const patch = async (p: Partial<PilotMeta>) => db.pilot.put({ ...(await pilotMeta()), ...p });
export const consented = (m: PilotMeta | undefined) => m?.consent?.version === CONSENT_VERSION;

export function platform(): Platform {
  const ua = navigator.userAgent;
  const app = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  if (/iPhone|iPad|iPod/.test(ua)) return app ? 'ios-pwa' : 'ios-browser';
  if (/Android/.test(ua)) return app ? 'android-pwa' : 'android-browser';
  return /Mobi/.test(ua) ? 'other' : 'desktop';
}
const build = () => { const v = appVersion(); return v === 'dev' ? 'dev' : `index-${v}`; };

/** A week's summary from this device's data — the one function for the consent's sample and for what is sent. */
export async function summaryFor(week: string, pid: string, src?: string): Promise<Summary> {
  const days = weekDays(week);
  const [plan, entries, workouts, wellbeing, weights, foods, counts, pieces, meta] = await Promise.all([
    db.plan.get('main'), db.entries.toArray(), db.workouts.toArray(), db.wellbeing.toArray(), db.weights.toArray(), db.foods.toArray(),
    tallies(days[0]!, days[6]!), db.pieces.count(), db.meta.get('sync')]);
  return weekSummary({ plan: normalizePlan(plan), entries, workouts, wellbeing, weights, foods: new Map(foods.map((f) => [f.id, f])),
    tallies: counts, fromPhoto: pieces > 0, remindersOn: !!meta?.reminders?.on, pid, ...(src ? { src } : {}), build: build(), platform: platform() }, week);
}
/** The consent's sample: last week, as it would go. */
export const lastWeek = () => weekShift(weekOf(new Date()), -1);

let running: Promise<void> | null = null;
/** Send what is due; quiet when offline (the next opening tries again). */
export function pilotTick(now = new Date()): Promise<void> {
  if (inDemo()) return Promise.resolve();
  running ??= (async () => {
    let m = await pilotMeta();
    if (!consented(m) || !m.consent) return;
    const since = m.consent.at;
    try {
      if (!m.pid || !m.secret) { const j = await pilotJoin(); m = { ...m, ...j }; await patch(j); }
      const auth = { pid: m.pid!, secret: m.secret! };
      for (const week of weeksDue(now, since, Object.keys(m.sent ?? {}))) {
        const s = await summaryFor(week, auth.pid, m.src);
        await pilotSend(auth, s);
        m = { ...m, sent: { ...m.sent, [week]: s } };
        await patch({ sent: m.sent });
      }
      for (const kind of ['d7', 'd30'] as const) { // D121: an answer given offline goes now
        const sv = m.surveys?.[kind];
        if (!sv?.answer || sv.sent) continue;
        await pilotSend(auth, { v: 1, pid: auth.pid, week: sv.week ?? weekOf(now), survey: kind, q: sv.answer });
        m = { ...m, surveys: { ...m.surveys, [kind]: { ...sv, sent: true } } };
        await patch({ surveys: m.surveys });
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) await patch({ pid: undefined, secret: undefined }); // the server forgot it — a new one next time
    }
  })().finally(() => { running = null; });
  return running;
}

export async function giveConsent(): Promise<void> {
  await patch({ consent: { at: new Date().toISOString(), version: CONSENT_VERSION }, asked: [...((await pilotMeta()).asked ?? []), { at: todayISO(), answer: 'yes' }] });
  await pilotTick();
}
export async function decline(): Promise<void> {
  await patch({ asked: [...((await pilotMeta()).asked ?? []), { at: todayISO(), answer: 'no' }] });
}
/** «Вимкнути»: nothing more is sent; what was sent stays until «Видалити надіслане». */
export const turnOff = () => patch({ consent: undefined });
/** «Видалити надіслане»: everything of the participant on the server, then the participant on this device. */
export async function leave(): Promise<void> {
  const m = await pilotMeta();
  if (m.pid && m.secret) await pilotLeave({ pid: m.pid, secret: m.secret }).catch((e: unknown) => { if (!(e instanceof ApiError && e.status === 404)) throw e; });
  await patch({ pid: undefined, secret: undefined, sent: undefined, consent: undefined, surveys: undefined, notes: undefined });
}

/** A doctor's code, typed or from the QR link: checked on the server; kept only when known. */
export async function setSource(raw: string, visit = false): Promise<'known' | 'unknown' | 'offline'> {
  const code = raw.trim().toUpperCase();
  if (!SRC.test(code)) return 'unknown';
  try {
    const { known } = await pilotSource(code, visit);
    if (known) await patch({ src: code });
    return known ? 'known' : 'unknown';
  } catch { return 'offline'; }
}
/** `?src=ENDO-01` in the address (the QR card): read once, taken out of the address. */
export async function sourceFromLink(): Promise<{ code: string; state: 'known' | 'unknown' | 'offline' } | null> {
  if (inDemo()) return null;
  const url = new URL(location.href);
  const code = url.searchParams.get('src');
  if (!code) return null;
  url.searchParams.delete('src');
  history.replaceState(history.state, '', url.toString());
  return { code: code.toUpperCase(), state: await setSource(code, true) };
}

/** «Допомогти пілоту?» on «День»: from the 3rd day of use, never with a consent, after «Ні» not before 30 days, twice at most. */
export function offerDue(m: PilotMeta, firstDay: string | undefined, today: string): boolean {
  if (consented(m) || !firstDay || differenceInCalendarDays(parseISO(today), parseISO(firstDay)) < 2) return false;
  const noes = (m.asked ?? []).filter((a) => a.answer === 'no');
  if (noes.length >= 2) return false;
  const last = noes.at(-1);
  return !last || differenceInCalendarDays(parseISO(today), parseISO(last.at)) >= 30;
}
/** The first day of use: the first record, or the day the plan was made. */
export async function firstDayOfUse(): Promise<string | undefined> {
  const [first, plan] = await Promise.all([db.entries.orderBy('at').first(), db.plan.get('main')]);
  return [first ? dateOf(first.at) : undefined, plan?.onboardedAt].filter((x): x is string => !!x).sort()[0];
}

/** D121: a survey answered — kept, then sent (now, or on the next opening if offline). */
export async function answerSurvey(kind: SurveyKind, answer: SurveyAnswer): Promise<void> {
  const m = await pilotMeta();
  await patch({ surveys: { ...m.surveys, [kind]: { ...m.surveys?.[kind], done: true, answer, week: weekOf(new Date()) } } });
  await pilotTick();
}
/** «Не зараз»: tomorrow again; the second time it is gone. */
export async function surveyLater(kind: SurveyKind): Promise<void> {
  const m = await pilotMeta(), s = m.surveys?.[kind] ?? {};
  await patch({ surveys: { ...m.surveys, [kind]: { ...s, later: [...(s.later ?? []), todayISO()] } } });
}

/** D121: «Що заважало» → «Надіслати розробникам»: the one place text goes — this line, as the person left it, names replaced. */
export async function sendNote(id: string, text: string): Promise<void> {
  const m = await pilotMeta();
  if (!consented(m) || !m.pid || !m.secret) throw new ApiError(403, 'no_pilot');
  const nid = id.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 16);
  await pilotSend({ pid: m.pid, secret: m.secret }, { v: 1, pid: m.pid, week: weekOf(new Date()), nid, note: scrubNames(text.trim()).slice(0, 1000) });
  await patch({ notes: [...(m.notes ?? []), id] });
}
