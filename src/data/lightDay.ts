import { format } from 'date-fns';
import type { ProtocolDB } from './db';
import { appendModuleEvents, setLightDay } from './modulePreferences';
import { lightDayChoice } from '../domain/modulePreferences';
import { lightDayNotice } from '../domain/lightDay';
import { newId } from '../domain/dates';

/** UI commands have no editable date: they always act on the caller's current local calendar day. */
export async function setTodayLightDay(target: ProtocolDB, enabled: boolean, source: 'manual' | 'voice' = 'manual', now = new Date()): Promise<boolean> {
  const date = format(now, 'yyyy-MM-dd');
  return target.transaction('rw', target.moduleEvents, async () => {
    const current = lightDayChoice(await target.moduleEvents.toArray(), date);
    if ((current?.enabled ?? false) === enabled) return false;
    // Preserve local command order even for two opposite actions in the same millisecond or a clock moved backwards.
    const at = new Date(Math.max(now.getTime(), current ? Date.parse(current.at) + 1 : 0)).toISOString();
    await setLightDay(target, date, enabled, source, at); return true;
  });
}

/** Call only after the calm card is actually displayed (UI in PR 08). Recheck eligibility inside the write transaction. */
export async function markLightDayNoticeShown(target: ProtocolDB, episode: string, now = new Date()): Promise<boolean> {
  return target.transaction('rw', target.moduleEvents, async () => {
    if (lightDayNotice(await target.moduleEvents.toArray(), now)?.episode !== episode) return false;
    await appendModuleEvents(target, [{ id: newId(), v: 1, at: now.toISOString(), kind: 'light-day-notice', date: format(now, 'yyyy-MM-dd'), episode }]);
    return true;
  });
}
