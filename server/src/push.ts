// Reminders by Web Push (SPEC.md D34). The server knows a device's subscription and, per reminder, an opaque id,
// a time and a generic word («Обід», «Ліки», «Вода»); the phone's service worker fills in the details from its
// own data. A reminder not ticked on any device of the vault comes again after `repeat_every` minutes.
import webpush from 'web-push';
import type { Store } from './store.ts';

export interface Vapid { publicKey: string; privateKey: string }
export type Sender = (sub: string, payload: string) => Promise<'ok' | 'gone' | 'error'>;

/** VAPID keys from the environment, or made once and kept in the database. */
export function vapidKeys(store: Store, env: NodeJS.ProcessEnv): Vapid {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  const saved = store.setting('vapid');
  if (saved) return JSON.parse(saved) as Vapid;
  const keys = webpush.generateVAPIDKeys();
  store.setSetting('vapid', JSON.stringify(keys));
  return keys;
}

export function webPushSender(vapid: Vapid, subject: string): Sender {
  webpush.setVapidDetails(subject, vapid.publicKey, vapid.privateKey);
  return async (sub, payload) => {
    try {
      await webpush.sendNotification(JSON.parse(sub), payload, { TTL: 3600, urgency: 'high' });
      return 'ok';
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) return 'gone';
      console.error('push failed:', code, (e as Error).message.slice(0, 120));
      return 'error';
    }
  };
}

const STALE = 2 * 3600_000; // the server was down: a reminder this late is not worth sending

/** One pass over what is due. Returns how many were sent. */
export async function tick(store: Store, send: Sender, now: number): Promise<number> {
  let sent = 0;
  for (const r of store.due(now)) {
    if (r.acked || !r.sub || r.next_at < now - STALE) {
      store.afterSend(r.vault, r.device, r.rid, null);
      continue;
    }
    const payload = JSON.stringify({ ...JSON.parse(r.payload) as object, n: r.sent });
    const res = await send(r.sub, payload);
    if (res === 'gone') { store.dropDevice(r.vault, r.device); continue; }
    if (res === 'ok') sent += 1;
    store.afterSend(r.vault, r.device, r.rid, r.repeats_left > 0 ? now + r.repeat_every * 60_000 : null);
  }
  return sent;
}
