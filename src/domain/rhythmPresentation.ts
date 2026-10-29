import { differenceInMinutes } from 'date-fns';
import { NOW_AFTER_MIN } from './reminders';
import type { RhythmNode } from './rhythm';
/** Clock position is presentation only; elapsed time never changes a recorded outcome. */
export function rhythmPresentation(nodes: readonly RhythmNode[], date: string, now: Date): ('past' | 'current' | 'future' | 'untimed')[] {
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const timed = (n: RhythmNode) => /^([01]\d|2[0-3]):[0-5]\d$/.test(n.at) && !(n.kind === 'entry' && n.entry.timeUnknown);
  const nearest = date === today ? nodes.findIndex(n => timed(n) && n.at >= time && (n.kind === 'dose' || (n.kind === 'entry' && n.entry.status === 'planned'))) : -1;
  return nodes.map((n, i) => !timed(n) ? 'untimed' : i === nearest ? 'current' : date < today || (date === today && n.at < time) ? 'past' : 'future');
}

export type PendingStatus = { state: 'planned' } | { state: 'deferred'; until: string } | { state: 'unmarked' };

/** ТЗ 4.1 / D142 for what still waits for a mark — a dose of the plan, a planned record: «заплановано» until its
 *  window closes (D50), «відкладено до …» while «Пізніше» holds it (D35, the reminder's own key), «не відмічено»
 *  after. Never «пропущено»: only the person says that. A record without a known time is never judged late. */
export function pendingStatus(node: RhythmNode, date: string, now: Date, snoozed: Record<string, number> = {}): PendingStatus {
  const key = node.kind === 'dose' ? `med:${date}:${node.at}` : node.kind === 'entry' && node.entry.kind === 'meal' ? `meal:${node.entry.id}:${node.entry.at}` : undefined;
  const until = key ? snoozed[key] ?? 0 : 0;
  if (until > now.getTime()) {
    const u = new Date(until);
    return { state: 'deferred', until: `${String(u.getHours()).padStart(2, '0')}:${String(u.getMinutes()).padStart(2, '0')}` };
  }
  if (node.kind === 'entry' && node.entry.timeUnknown) return { state: 'planned' };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(node.at)) return { state: 'planned' };
  return differenceInMinutes(now, new Date(`${date}T${node.at}:00`)) > NOW_AFTER_MIN ? { state: 'unmarked' } : { state: 'planned' };
}
