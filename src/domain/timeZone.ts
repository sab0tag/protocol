// D195 («Очередь агента», задача 13.5): the time zone changed — «перенести час прийому?». «За місцевим часом»: the plan's times stay
// as they are (08:00 on the local clock); «як удома»: the medicines' times move by the difference once, so a dose comes at the same
// moment as at home, and the shift is remembered — at home again the app asks to move them back. No answer — nothing moves.
import type { Plan, Prescription } from './types';

export interface ZoneState { home: string; asked?: string[]; shift?: { zone: string; minutes: number } }

export const deviceZone = (): string => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

/** Minutes east of UTC of a zone at a moment (DST included). */
export function zoneOffset(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(at).reduce<Record<string, string>>((o, p) => ({ ...o, [p.type]: p.value }), {});
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute));
  return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/** The same clock: one zone under two names («Europe/Kiev» / «Europe/Kyiv»), or zones with the same offsets in winter and summer —
 *  for a dose time they are no different. */
export function sameClock(a: string, b: string, now: Date): boolean {
  if (a === b) return true;
  const later = new Date(now.getTime() + 182 * 86_400_000);
  try { return zoneOffset(a, now) === zoneOffset(b, now) && zoneOffset(a, later) === zoneOffset(b, later); } catch { return false; }
}

/** What to ask now: away (a zone not answered yet, with the difference in minutes), back home with a shift to undo, or nothing. */
export function zoneQuestion(zone: ZoneState | undefined, here: string, now: Date): { kind: 'away'; minutes: number } | { kind: 'home'; minutes: number } | null {
  if (!zone?.home) return null;
  if (sameClock(here, zone.home, now)) return zone.shift ? { kind: 'home', minutes: zone.shift.minutes } : null;
  if ((zone.shift && sameClock(zone.shift.zone, here, now)) || zone.asked?.some((z) => sameClock(z, here, now))) return null;
  const minutes = zoneOffset(here, now) - zoneOffset(zone.home, now);
  return minutes === 0 ? null : { kind: 'away', minutes };
}

const move = (time: string, minutes: number) => {
  const [h, m] = time.split(':').map(Number);
  const t = (((h! * 60 + m! + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
/** The medicines' times moved by `minutes` (a dose at home 08:00 is local 08:00 + the difference). */
export function shiftTimes(prescriptions: Prescription[], minutes: number): Prescription[] {
  return prescriptions.map((p) => (p.kind === 'medication' || p.kind === 'supplement') && p.schedule?.times.length
    ? { ...p, schedule: { ...p.schedule, times: [...p.schedule.times.map((x) => move(x, minutes))].sort() } } : p);
}

/** The plan after an answer: away — «local» (remember the zone) or «home» (shift and remember); at home — «back» or «keep». */
export function answerZone(plan: Pick<Plan, 'prescriptions' | 'zone'>, here: string, answer: 'local' | 'home' | 'back' | 'keep', minutes: number): Pick<Plan, 'prescriptions' | 'zone'> {
  const zone: ZoneState = plan.zone ?? { home: here };
  const asked = [...new Set([...(zone.asked ?? []), here])];
  if (answer === 'local') return { prescriptions: plan.prescriptions, zone: { ...zone, asked } };
  if (answer === 'home') return { prescriptions: shiftTimes(plan.prescriptions, minutes), zone: { ...zone, asked, shift: { zone: here, minutes } } };
  const { shift: _s, ...rest } = zone;
  return { prescriptions: answer === 'back' && zone.shift ? shiftTimes(plan.prescriptions, -zone.shift.minutes) : plan.prescriptions, zone: rest };
}
