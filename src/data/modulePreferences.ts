// D134: storage commands. No UI filtering or changes to the doctor's plan in this preparation release.
import type { ProtocolDB } from './db';
import { MODULE_IDS, type ModuleId } from '../domain/features';
import { newId } from '../domain/dates';
import { isModuleEvent, lightDayChoice, moduleChoiceAt, weightChoiceAt, type ModuleEvent, type ModuleSource, type MigrationReason } from '../domain/modulePreferences';

/** Same id and content is an idempotent retry; a different event may never overwrite that id. */
export async function appendModuleEvents(target: ProtocolDB, events: readonly ModuleEvent[]): Promise<void> {
  if (!events.every(isModuleEvent) || new Set(events.map((e) => e.id)).size !== events.length) throw new Error('Невірна подія налаштувань розділів.');
  await target.transaction('rw', target.moduleEvents, async () => {
    for (const event of events) {
      const old = await target.moduleEvents.get(event.id);
      if (old && !sameModuleEvent(old, event)) throw new Error('Подію налаштувань розділів уже записано з іншим вмістом.');
      if (!old) await target.moduleEvents.add(event);
    }
  });
}

// Key order is not part of an event's identity (a JSON backup or sync may reorder it).
export function sameModuleEvent(a: ModuleEvent, b: ModuleEvent): boolean {
  const sorted = (x: ModuleEvent) => Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}

export async function setModuleEnabled(target: ProtocolDB, module: ModuleId, enabled: boolean,
  source: ModuleSource = 'manual', at = new Date().toISOString()): Promise<void> {
  await target.transaction('rw', target.moduleEvents, async () => {
    const current = moduleChoiceAt(await target.moduleEvents.toArray(), module);
    if (current?.enabled === enabled && current.source === source) return;
    await appendModuleEvents(target, [{ id: newId(), v: 1, at, kind: 'module', module, enabled, source }]);
  });
}

export async function setLightDay(target: ProtocolDB, date: string, enabled: boolean,
  source: 'manual' | 'voice' = 'manual', at = new Date().toISOString()): Promise<void> {
  await target.transaction('rw', target.moduleEvents, async () => {
    if ((lightDayChoice(await target.moduleEvents.toArray(), date)?.enabled ?? false) === enabled) return;
    await appendModuleEvents(target, [{ id: newId(), v: 1, at, kind: 'light-day', date, enabled, source }]);
  });
}

export async function setWeightEnabled(target: ProtocolDB, enabled: boolean,
  source: ModuleSource = 'manual', at = new Date().toISOString()): Promise<void> {
  await target.transaction('rw', target.moduleEvents, async () => {
    const current = weightChoiceAt(await target.moduleEvents.toArray());
    if (current?.enabled === enabled && current.source === source) return;
    await appendModuleEvents(target, [{ id: newId(), v: 1, at, kind: 'weight', enabled, source }]);
  });
}

/** A single manual action, atomically across modules and the independent weight override. */
export async function enableAllModules(target: ProtocolDB, at = new Date().toISOString()): Promise<void> {
  await target.transaction('rw', target.moduleEvents, async () => {
    const events = await target.moduleEvents.toArray();
    for (const module of MODULE_IDS) if (moduleChoiceAt(events, module)?.enabled === false) await setModuleEnabled(target, module, true, 'manual', at);
    if (weightChoiceAt(events)?.enabled === false) await setWeightEnabled(target, true, 'manual', at);
  });
}
/** Only the presence of an old draft/talk is used. Its words never enter the preference history. */
export function legacyModuleUsage(demo = false, storage?: Storage): Partial<Record<ModuleId, boolean>> {
  const used: Partial<Record<ModuleId, boolean>> = {};
  try {
    const s = storage ?? globalThis.localStorage, prefix = `protocol.kept.${demo ? 'demo.' : ''}`;
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (!key || (!key.startsWith(prefix + 'assistant:') && key !== prefix + 'menu')) continue;
      const value = JSON.parse(s.getItem(key) ?? 'null') as { v?: { drafts?: unknown[] } | unknown[] } | null;
      if (key.startsWith(prefix + 'assistant:') && Array.isArray(value?.v) && value.v.length) used.assistant = true;
      if (key === prefix + 'menu' && value?.v && !Array.isArray(value.v) && Array.isArray(value.v.drafts) && value.v.drafts.length) used.menu = true;
    }
  } catch { /* unavailable or damaged old storage: conservative compatibility defaults keep access */ }
  return used;
}

/** Idempotent, additive migration, called at boot after seeding (never from a screen render).
 *  All legacy access is preserved. Evidence explains why; absence of a record is not proof of non-use.
 *  `at` is the migration time, explicitly NOT an invented historical first-use date. */
export async function initialiseModulePreferences(target: ProtocolDB, at = new Date().toISOString(),
  legacy: Partial<Record<ModuleId, boolean>> = {}, options: { minimalNew?: boolean } = {}): Promise<void> {
  await target.transaction('rw', [target.moduleEvents, target.plan, target.entries, target.workouts, target.wellbeing, target.weights,
    target.labs, target.recipes, target.favorites], async () => {
    const events = await target.moduleEvents.toArray();
    if (events.some((e) => e.kind === 'initialised')) return;
    const missing = MODULE_IDS.filter((id) => !events.some((e) => e.kind === 'module' && e.module === id));
    const weightKnown = events.some((e) => e.kind === 'weight');
    const [plan, entries, workouts, wellbeing, weights, labs, recipes, favorites] = await Promise.all([
      target.plan.get('main'), target.entries.toArray(), target.workouts.toArray(), target.wellbeing.toArray(), target.weights.toArray(),
      target.labs.toArray(), target.recipes.toArray(), target.favorites.toArray(),
    ]);
    const fresh = options.minimalNew && target.name !== 'protocol-demo' && !events.length && !plan?.onboardedAt
      && !plan?.prescriptions.length && !plan?.constraints.length && !plan?.modes.length && !Object.keys(plan?.targets ?? {}).length
      && !plan?.nextCheckup && !plan?.profile && !plan?.questions?.length && !plan?.lastVisit
      && !entries.length && !workouts.length && !wellbeing.length && !weights.length && !labs.length && !favorites.length
      && !recipes.some((r) => !r.builtIn) && !Object.values(legacy).some(Boolean);
    if (fresh) {
      await appendModuleEvents(target, [{ id: newId(), v: 1, at, kind: 'onboarding-started' }, { id: newId(), v: 1, at, kind: 'initialised' }]);
      return;
    }
    const real = entries.filter((e) => !e.demo);
    const used: Partial<Record<ModuleId, boolean>> = {
      ...legacy,
      meds: !!legacy.meds || real.some((e) => e.kind === 'med'), water: !!legacy.water || real.some((e) => e.kind === 'water'),
      food: !!legacy.food || real.some((e) => e.kind === 'meal') || recipes.some((r) => !r.builtIn) || favorites.length > 0,
      menu: !!legacy.menu || real.some((e) => !!e.menu),
      workout: !!legacy.workout || workouts.some((w) => !w.demo) || real.some((e) => e.kind === 'workout'),
      wellbeing: !!legacy.wellbeing || wellbeing.some((w) => !w.demo) || real.some((e) => e.kind === 'symptom'),
      progress: !!legacy.progress || weights.some((w) => !w.demo) || labs.some((l) => !l.demo),
    };
    const prescribed: Partial<Record<ModuleId, boolean>> = {
      meds: (plan?.prescriptions ?? []).some((p) => p.kind === 'medication' || p.kind === 'supplement'),
      water: (plan?.targets?.waterMl ?? 0) > 0,
    };
    const reason = (id: ModuleId): MigrationReason => used[id] ? 'records' : prescribed[id] ? 'plan' : 'compatibility';
    const migration = `migration:v1:${newId()}`; // independent devices must not collide when a backup or first sync joins their histories
    const next: ModuleEvent[] = missing.map((module) => ({ id: `${migration}:${module}`, v: 1, at, kind: 'module', module,
      enabled: true, source: 'migration', reason: reason(module), before: 'unknown' }));
    if (!weightKnown && ((plan?.targets?.weightGoalKg ?? 0) > 0 || weights.some((w) => !w.demo))) next.push({
      id: `${migration}:weight`, v: 1, at, kind: 'weight', enabled: true, source: 'migration',
      reason: weights.some((w) => !w.demo) ? 'records' : 'plan', before: 'unknown',
    });
    next.push({ id: migration, v: 1, at, kind: 'initialised' });
    await appendModuleEvents(target, next);
  });
}
