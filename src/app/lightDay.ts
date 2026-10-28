import { db } from '../data/db';
import { setTodayLightDay } from '../data/lightDay';
import { currentKeys, requestSync } from '../sync/runner';
import { pushSchedule, refreshPushNotifications } from '../sync/push';

/** Persist first. Network work is retried from history and never blocks the local result. */
export async function applyLightDay(on: boolean, source: 'manual' | 'voice' = 'manual') {
  const changed = await setTodayLightDay(db, on, source);
  refreshPushNotifications();
  const keys = currentKeys();
  if (keys) { requestSync(); void pushSchedule(keys, true).catch(() => undefined); }
  return changed;
}
