// D134: immutable events, not one mutable settings row. Explicit choices always outrank migration defaults.
import { ALL_MODULES, isModuleId, type FeatureOverrides, type ModuleFlags, type ModuleId } from './features';
import type { ISODate, ISODateTime } from './types';

export const MODULE_SOURCES = ['manual', 'onboarding', 'offer', 'plan-review', 'automatic'] as const;
export type ModuleSource = (typeof MODULE_SOURCES)[number];
export type MigrationReason = 'records' | 'plan' | 'compatibility';
type Provenance = { source: ModuleSource } | { source: 'migration'; reason: MigrationReason; before: 'unknown' };
interface EventBase { id: string; v: 1; at: ISODateTime }
export type ModuleChoice = EventBase & Provenance & { kind: 'module'; module: ModuleId; enabled: boolean };
export type WeightChoice = EventBase & Provenance & { kind: 'weight'; enabled: boolean };
export type LightDayChoice = EventBase & { kind: 'light-day'; date: ISODate; enabled: boolean; source: 'manual' | 'voice' };
export type ModuleOfferEvent = EventBase & { kind: 'offer'; module: ModuleId; offerId: string; action: 'shown' | 'yes' | 'later' | 'no' };
export type ModuleEvent = ModuleChoice | WeightChoice | LightDayChoice | ModuleOfferEvent | (EventBase & { kind: 'initialised' });
export interface ModulePreferences { modules: ModuleFlags; overrides: FeatureOverrides }

const ID = /^[A-Za-z0-9:_-]{1,160}$/;
export const isEventId = (x: unknown): x is string => typeof x === 'string' && ID.test(x);
export const isEventTime = (x: unknown): x is ISODateTime => typeof x === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x)
  && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x;
export const isLocalDate = (x: unknown): x is ISODate => typeof x === 'string'
  && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x + 'T00:00:00.000Z'))
  && new Date(x + 'T00:00:00.000Z').toISOString().slice(0, 10) === x;

/** Unknown fields are rejected too: the event vocabulary cannot carry arbitrary text or feature overrides. */
export function isModuleEvent(value: unknown): value is ModuleEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const e = value as Record<string, unknown>;
  if (!isEventId(e.id) || e.v !== 1 || !isEventTime(e.at)) return false;
  let fields: string[];
  if (e.kind === 'module' || e.kind === 'weight') {
    if (typeof e.enabled !== 'boolean' || (e.kind === 'module' && !isModuleId(e.module))) return false;
    fields = ['enabled', 'source', ...(e.kind === 'module' ? ['module'] : [])];
    if (e.source === 'migration') {
      if (e.enabled !== true || !['records', 'plan', 'compatibility'].some((r) => r === e.reason) || e.before !== 'unknown') return false;
      fields.push('reason', 'before');
    } else if (!MODULE_SOURCES.some((s) => s === e.source)) return false;
    if (e.source === 'automatic' && (e.kind !== 'module' || e.module !== 'progress' || e.enabled !== true)) return false;
  } else if (e.kind === 'light-day') {
    if (!isLocalDate(e.date) || typeof e.enabled !== 'boolean' || !['manual', 'voice'].some((s) => s === e.source)) return false;
    fields = ['date', 'enabled', 'source'];
  } else if (e.kind === 'offer') {
    if (!isModuleId(e.module) || !isEventId(e.offerId) || !['shown', 'yes', 'later', 'no'].some((a) => a === e.action)) return false;
    fields = ['module', 'offerId', 'action'];
  } else if (e.kind === 'initialised') fields = [];
  else return false;
  const allowed = new Set(['id', 'v', 'at', 'kind', ...fields]);
  return Object.keys(e).length === allowed.size && Object.keys(e).every((key) => allowed.has(key));
}

export function validateModuleEvents(value: unknown): ModuleEvent[] {
  if (!Array.isArray(value) || !value.every(isModuleEvent)) throw new Error('Пошкоджено історію налаштувань розділів.');
  if (new Set(value.map((e) => e.id)).size !== value.length) throw new Error('Повторні події в історії налаштувань розділів.');
  return value;
}

const explicit = (e: ModuleChoice | WeightChoice) => e.source !== 'migration';
const later = (a: EventBase, b: EventBase) => a.at > b.at || (a.at === b.at && a.id > b.id);
function latest<T extends ModuleEvent>(events: readonly T[]): T | undefined {
  return events.reduce<T | undefined>((best, e) => !best || later(e, best) ? e : best, undefined);
}
function choice<T extends ModuleChoice | WeightChoice>(events: readonly T[]): T | undefined {
  const selected = events.filter(explicit);
  return latest(selected.length ? selected : events);
}

/** Undefined before the first known event means unknown history, not «disabled» or a guessed start date. */
export function moduleChoiceAt(events: readonly ModuleEvent[], module: ModuleId, at?: ISODateTime): ModuleChoice | undefined {
  return choice(events.filter((e): e is ModuleChoice => e.kind === 'module' && e.module === module && (at === undefined || e.at <= at)));
}

export function weightChoiceAt(events: readonly ModuleEvent[], at?: ISODateTime): WeightChoice | undefined {
  return choice(events.filter((e): e is WeightChoice => e.kind === 'weight' && (at === undefined || e.at <= at)));
}

/** Visibility defaults only. Historical metrics must use moduleChoiceAt so unknown history stays unknown. */
export function modulePreferences(events: readonly ModuleEvent[], at?: ISODateTime): ModulePreferences {
  const known = at === undefined ? events : events.filter((e) => e.at <= at);
  const modules = { ...ALL_MODULES };
  for (const id of Object.keys(modules) as ModuleId[]) modules[id] = moduleChoiceAt(known, id)?.enabled ?? true;
  const weight = weightChoiceAt(known);
  return { modules, overrides: weight ? { 'wellbeing.weight': weight.enabled } : {} };
}

export function lightDayChoice(events: readonly ModuleEvent[], date: ISODate): LightDayChoice | undefined {
  return latest(events.filter((e): e is LightDayChoice => e.kind === 'light-day' && e.date === date));
}

export const isLightDay = (events: readonly ModuleEvent[], date: ISODate): boolean => lightDayChoice(events, date)?.enabled ?? false;
