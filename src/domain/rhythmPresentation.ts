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
