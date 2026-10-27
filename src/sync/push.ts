// Reminders on this device (SPEC.md D34): subscribe to Web Push and keep the server's schedule in step with the
// day's plan. Called after every sync round, so a tick on another device stops the repeats here too.
import { activeProfileId } from '../data/profiles';
import { addDays, format } from 'date-fns';
import { db, normalizePlan } from '../data/db';
import { DEFAULT_REMINDERS, reminders, type ReminderSettings } from '../domain/reminders';
import { dateOf } from '../domain/dates';
import { dayTotals, effectiveTargets } from '../domain/nutrition';
import { shortGoals } from '../domain/topup';
import type { DayEntry, Plan } from '../domain/types';
import { ApiError, dropDevice, pushKey, putDevice, putReminderPolicy, putReminders, testPush } from './api';
import { recordKey, type Keys } from './crypto';
import { MODULE_POLICY_ENABLED } from '../domain/rollout';
import { policyFromEvents, type ReminderPolicy } from '../../server/src/reminderPolicy';

export const pushSupported = () => activeProfileId === 'main' && typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
/** iPhone: push only for a Протокол added to the home screen and opened from there. */
export const needsHomeScreen = () => /iPhone|iPad|iPod/.test(navigator.userAgent)
  && !(window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone);

const b64ToBytes = (b64: string) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64.length / 4) * 4, '='));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
const randomId = () => [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join('');

async function subscribe(keys: Keys, device: string) {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(await pushKey()) as BufferSource });
  await putDevice(keys, device, sub.toJSON());
}

export async function enablePush(keys: Keys, settings?: ReminderSettings) {
  if (!pushSupported()) throw new ApiError(400, 'unsupported');
  if (await Notification.requestPermission() !== 'granted') throw new ApiError(403, 'denied');
  const meta = await db.meta.get('sync');
  const device = meta?.device ?? randomId();
  await subscribe(keys, device);
  await db.meta.update('sync', { device, reminders: { ...DEFAULT_REMINDERS, ...meta?.reminders, ...settings, on: true } });
  await pushSchedule(keys, true);
}

export async function disablePush(keys: Keys | undefined) {
  if (activeProfileId !== 'main') return; // secondary profiles must never unsubscribe the original person's push
  const meta = await db.meta.get('sync');
  try { await (await navigator.serviceWorker.ready).pushManager.getSubscription().then((s) => s?.unsubscribe()); } catch { /* none */ }
  if (keys && meta?.device) await dropDevice(keys, meta.device).catch(() => undefined);
  if (meta?.reminders) await db.meta.update('sync', { reminders: { ...meta.reminders, on: false } });
  last = '';
}

export async function sendTest(keys: Keys) {
  const meta = await db.meta.get('sync');
  if (meta?.device) await testPush(keys, meta.device);
}

let last = '';
let scheduleTail: Promise<void> = Promise.resolve();
const policyAcks = new Map<string, { signature: string; at: number }>();

/** Persistent history is the retry queue. Ack is written only after a compatible server accepted this projection. */
export async function reconcileReminderPolicy(keys: Keys, force = false): Promise<ReminderPolicy | undefined> {
  if (!MODULE_POLICY_ENABLED) return;
  const policy = policyFromEvents(await db.moduleEvents.toArray());
  const sig = JSON.stringify(policy);
  const meta = await db.meta.get('sync');
  if (!meta) return policy;
  const cached = policyAcks.get(keys.vaultId);
  if (!force && cached?.signature === sig && Date.now() - cached.at < 300_000
    && meta.reminderPolicyAck === sig && meta.reminderPolicyState === 'synced') return policy;
  if (meta.reminderPolicyState !== 'pending') await db.meta.update('sync', { reminderPolicyState: 'pending' });
  const ack = await putReminderPolicy(keys, policy);
  if (ack.v !== 1) throw new ApiError(503, 'reminder_policy_unsupported');
  policyAcks.set(keys.vaultId, { signature: sig, at: Date.now() });
  // A change during the request remains pending and is retried by the next sync; never mark it as acknowledged.
  const current = JSON.stringify(policyFromEvents(await db.moduleEvents.toArray()));
  await db.meta.update('sync', { reminderPolicyAck: sig, reminderPolicyState: current === sig ? 'synced' : 'pending' });
  return policy;
}

/** Close already displayed v2 notifications using their opaque reminder metadata, including while offline. */
export function refreshPushNotifications() {
  if (MODULE_POLICY_ENABLED && typeof navigator !== 'undefined') navigator.serviceWorker?.controller?.postMessage({ type: 'reminder-policy-changed' });
}

/** D116: today's day is short of a target of the plan — the time for the evening nudge (two hours before the last meal, not
 *  before 16:00), or nothing. Sent again after every record, so a meal that closes the gap takes the nudge back. */
async function eveningTopup(plan: Plan, entries: DayEntry[], now: Date): Promise<string | undefined> {
  const today = format(now, 'yyyy-MM-dd');
  const day = entries.filter((e) => dateOf(e.at) === today);
  const foods = new Map((await db.foods.toArray()).map((f) => [f.id, f]));
  const totals = dayTotals(day, foods);
  const short = shortGoals({ plan, targets: effectiveTargets(plan, today), date: today, foods, usual: [],
    mealsDone: day.filter((e) => e.kind === 'meal' && e.status === 'done').length,
    have: { kcal: totals.kcal, protein: totals.protein, calciumMg: totals.calciumMg, carbs: totals.carbs } });
  if (!short.length) return undefined;
  const by = effectiveTargets(plan, today).lastMealBy ?? '20:00';
  const m = Math.max(16 * 60, Number(by.slice(0, 2)) * 60 + Number(by.slice(3, 5)) - 120);
  const at = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return at > format(now, 'HH:mm') ? at : undefined;
}

/** Send this device's schedule if it changed (or `force`). On app start the subscription is renewed too. */
export async function pushSchedule(keys: Keys, force = false) {
  const next = scheduleTail.catch(() => undefined).then(() => sendSchedule(keys, force));
  scheduleTail = next;
  return next;
}

async function sendSchedule(keys: Keys, force: boolean) {
  const policy = await reconcileReminderPolicy(keys, force); // even without push here: another device may have a stale queue
  const meta = await db.meta.get('sync');
  const s = meta?.reminders;
  if (!meta || !s?.on || !meta.device || !pushSupported() || Notification.permission !== 'granted') return;
  const now = new Date();
  const entries = await db.entries.where('at').between(format(addDays(now, -2), 'yyyy-MM-dd'), format(addDays(now, 33), 'yyyy-MM-dd')).toArray();
  const plan = normalizePlan(await db.plan.get('main'));
  const topupAt = plan ? await eveningTopup(plan, entries, now) : undefined; // D116
  const { items, done } = reminders({ entries, plan, settings: { ...DEFAULT_REMINDERS, ...s }, now, snoozed: meta.snoozed,
    ...(topupAt ? { topupAt } : {}), ...(policy ? { policy } : {}) });
  const rid = (k: string) => recordKey(keys, `rem:${k}`);
  const body = {
    ...(policy ? { policyVersion: 1 } : {}),
    items: await Promise.all(items.map(async (i) => ({ rid: await rid(i.key), at: i.at, ...(i.once ? { once: true } : {}),
      payload: { ...i.payload, tag: await rid(i.payload.tag) } }))),
    done: await Promise.all(done.map(rid)),
    repeatEvery: s.repeatMin || 15, repeats: s.repeatMin ? 2 : 0,
  };
  const sig = `${keys.vaultId}:${meta.device}:${JSON.stringify(body)}`;
  if (!force && sig === last) return;
  try {
    await putReminders(keys, meta.device, body);
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 404) throw e;
    await subscribe(keys, meta.device); // the server forgot this device (a gone subscription): register again
    await putReminders(keys, meta.device, body);
  }
  last = sig;
}

/** On start: make sure the server still has a fresh subscription for this device. */
export async function renewPush(keys: Keys) {
  const meta = await db.meta.get('sync');
  if (!meta?.reminders?.on || !meta.device || !pushSupported() || Notification.permission !== 'granted') return;
  await subscribe(keys, meta.device).catch(() => undefined);
  await pushSchedule(keys, true).catch(() => undefined);
}

/** «Пізніше 15 хв» (D35): this reminder stops repeating and comes again at `until`. */
export async function snooze(key: string, until: number) {
  const meta = await db.meta.get('sync');
  const now = Date.now();
  const kept = Object.fromEntries(Object.entries(meta?.snoozed ?? {}).filter(([, t]) => t > now - 86_400_000));
  if (meta) await db.meta.update('sync', { snoozed: { ...kept, [key]: until } });
  else localSnoozed[key] = until;
}
/** Without sync the snooze lives in memory only (no reminders then anyway). */
export const localSnoozed: Record<string, number> = {};
