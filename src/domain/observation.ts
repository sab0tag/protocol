// D135: observation belongs to an interval, not today's switch. This never changes a doctor's prescription.
import { addDays, format, parseISO } from 'date-fns';
import type { ModuleId } from './features';
import { isLightDay, moduleChoiceAt, weightChoiceAt, type ModuleEvent } from './modulePreferences';
import type { DayEntry, ISODate, ISODateTime, Targets } from './types';

export type TrackingKey = ModuleId | 'weight';
export type Coverage = 'on' | 'off' | 'partial' | 'unknown' | 'future';
export interface Observation {
  readonly events: readonly ModuleEvent[];
  readonly now: Date;
  readonly demo?: boolean;
  /** Optional explicit context for pure callers. Persisted light-day decisions also apply; never to medications. */
  readonly neutral?: Readonly<Partial<Record<ISODate, readonly ('food' | 'water' | 'workout')[]>>>;
}
export interface TrackingInterval { key: TrackingKey; from: ISODateTime; to: ISODateTime; since?: ISODateTime; unknownStart: boolean }
export interface TrackingInfo {
  intervals: TrackingInterval[];
  unknown: TrackingKey[];
  disabled: TrackingKey[];
}

export const observedToday = (o: Observation) => format(o.now, 'yyyy-MM-dd');
const start = (d: ISODate) => parseISO(d).getTime();
const end = (d: ISODate) => addDays(parseISO(d), 1).getTime(); // local midnight, including 23/25-hour days
const iso = (at: number) => new Date(at).toISOString();

/** Unknown before migration stays unknown. Future task visibility projects the state known now. */
export function observedState(o: Observation, key: TrackingKey, at: number): boolean | undefined {
  if (!Number.isFinite(at)) return undefined;
  if (o.demo) return true;
  const time = iso(Math.min(at, o.now.getTime()));
  if (key === 'weight') return weightChoiceAt(o.events, time)?.enabled ?? moduleChoiceAt(o.events, 'wellbeing', time)?.enabled;
  return moduleChoiceAt(o.events, key, time)?.enabled;
}

function boundaries(o: Observation, key: TrackingKey, from: number, to: number): number[] {
  const keys = key === 'weight' ? ['weight', 'wellbeing'] : [key];
  return [from, ...new Set(o.events.filter((e) => (e.kind === 'module' && keys.includes(e.module)) || (e.kind === 'weight' && key === 'weight'))
    .map((e) => Date.parse(e.at)).filter((at) => at > from && at < to && at <= o.now.getTime()))].sort((a, b) => a - b);
}

export function neutralDay(o: Observation, key: TrackingKey, date: ISODate): boolean {
  return !o.demo && date <= observedToday(o) && (key === 'food' || key === 'water' || key === 'workout')
    && ((o.neutral?.[date]?.includes(key) ?? false) || isLightDay(o.events, date));
}

export function coverage(o: Observation, key: TrackingKey, date: ISODate): Coverage {
  if (date > observedToday(o)) return 'future';
  const from = start(date), to = Math.min(end(date), o.now.getTime() + 1);
  const states = new Set(boundaries(o, key, from, to).map((at) => observedState(o, key, at)));
  if (states.size !== 1) return 'partial';
  const state = [...states][0];
  return state === undefined ? 'unknown' : state ? 'on' : 'off';
}

export const scoredDay = (o: Observation | undefined, key: TrackingKey, date: ISODate): boolean =>
  !o || (coverage(o, key, date) === 'on' && !neutralDay(o, key, date));

/** A timed task is observed at its scheduled instant. An untimed daily task needs a full observation day. */
export function observedTask(o: Observation | undefined, key: TrackingKey, date: ISODate, time?: string): boolean {
  if (!o) return true;
  if (neutralDay(o, key, date)) return false;
  if (!time) return scoredDay(o, key, date);
  return observedState(o, key, new Date(`${date}T${time}:00`).getTime()) === true;
}

export const entryOwner = (e: DayEntry): ModuleId | undefined =>
  e.kind === 'meal' ? 'food' : e.kind === 'med' ? 'meds' : e.kind === 'water' ? 'water' : e.kind === 'workout' ? 'workout' : undefined;

/** Facts are retained separately; this filters proposed tasks, never deletes recorded data. */
export function observedPlannedEntry(o: Observation | undefined, e: DayEntry): boolean {
  if (!o || e.status !== 'planned') return true;
  const key = entryOwner(e);
  if (!key) return true;
  const date = format(parseISO(e.at), 'yyyy-MM-dd');
  return !neutralDay(o, key, date) && observedState(o, key, Date.parse(e.at)) === true
    && !(e.kind === 'meal' && e.menu && observedState(o, 'menu', Date.parse(e.at)) !== true);
}

/** Goals are not assessed over half a day. Raw recorded totals remain available to the person. */
export function observedTargets(targets: Targets, date: ISODate, o?: Observation): Targets {
  if (!o) return targets;
  const next = { ...targets };
  if (!scoredDay(o, 'water', date)) delete next.waterMl;
  if (!scoredDay(o, 'food', date)) {
    for (const key of ['kcal', 'proteinG', 'carbsG', 'fatG', 'calciumMg', 'lastMealBy'] as const) delete next[key];
  }
  return next;
}

/** Half-open periods intersected with the requested local dates; no invented pre-migration start. */
export function trackingInfo(o: Observation, from: ISODate, to: ISODate, keys: readonly TrackingKey[]): TrackingInfo {
  const result: TrackingInfo = { intervals: [], unknown: [], disabled: [] };
  const first = start(from), until = Math.min(end(to), o.now.getTime() + 1);
  if (until <= first) return result;
  for (const key of keys) {
    const relevant = o.events.filter((e) => (e.kind === 'module' && e.module === (key === 'weight' ? 'wellbeing' : key)) || (key === 'weight' && e.kind === 'weight'));
    const origin = relevant.reduce((earliest, e) => Math.min(earliest, Date.parse(e.at)), first);
    const points = [...boundaries(o, key, origin, until), until];
    let sawUnknown = false, sawOn = false;
    let run: { since?: string; unknownStart: boolean } | undefined;
    for (let i = 0; i < points.length - 1; i++) {
      const at = points[i]!, next = points[i + 1]!, state = observedState(o, key, at);
      if (state !== true) {
        run = undefined;
        if (next > first && state === undefined) sawUnknown = true;
        continue;
      }
      if (!run) {
        const event = key === 'weight' ? weightChoiceAt(o.events, iso(at)) ?? moduleChoiceAt(o.events, 'wellbeing', iso(at)) : moduleChoiceAt(o.events, key, iso(at));
        const unknownStart = !o.demo && event?.source === 'migration';
        run = { ...(unknownStart || o.demo ? {} : { since: iso(at) }), unknownStart };
      }
      if (next <= first) continue;
      const clipped = Math.max(at, first);
      sawOn = true;
      const previous = result.intervals.at(-1);
      if (previous?.key === key && previous.to === iso(clipped)) previous.to = iso(next);
      else result.intervals.push({ key, from: iso(clipped), to: iso(next), ...run });
    }
    if (sawUnknown) result.unknown.push(key);
    if (!sawOn && !sawUnknown) result.disabled.push(key);
  }
  return result;
}
