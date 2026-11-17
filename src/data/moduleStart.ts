import type { ProtocolDB } from './db';
import { appendModuleEvents, setModuleEnabled, setWeightEnabled } from './modulePreferences';
import { CORE_MODULES, isCoreModule, MODULE_IDS, type ModuleFlags } from '../domain/features';
import { newId } from '../domain/dates';
import { newModuleProfile, onboardingAnchor, progressOpening, starterModules, type PlanModule } from '../domain/moduleStart';
import { moduleChoiceAt, modulePreferences, type ModuleEvent } from '../domain/modulePreferences';
import type { Plan } from '../domain/types';
import { format } from 'date-fns';

export async function finishModuleOnboarding(target: ProtocolDB, args: { patch?: Partial<Plan>; weightKg?: number;
  choices?: Partial<ModuleFlags>; weightChoice?: boolean }, now = new Date()) {
  return target.transaction('rw', target.plan, target.moduleEvents, target.weights, async () => {
    const before = await target.plan.get('main');
    if (!before) throw new Error('План ще не завантажено.');
    const events = await target.moduleEvents.toArray(), fresh = newModuleProfile(events, before);
    const after = { ...before, ...args.patch, id: 'main' as const, onboardedAt: before.onboardedAt ?? onboardingAnchor('date', now).date };
    if (fresh) {
      const defaults = starterModules(after), at = now.toISOString();
      // D160: food and «Результати» start on — they are the core, with no choice to make
      const rows: ModuleEvent[] = MODULE_IDS.map((module) => ({ id: newId(), v: 1, at, kind: 'module', module,
        enabled: isCoreModule(module) || (args.choices?.[module] ?? defaults.modules[module]),
        source: !isCoreModule(module) && args.choices?.[module] !== undefined ? 'manual' : 'onboarding' }));
      if (args.weightChoice !== undefined || defaults.weight) rows.push({ id: newId(), v: 1, at, kind: 'weight', enabled: args.weightChoice ?? defaults.weight,
        source: args.weightChoice !== undefined ? 'manual' : 'onboarding' });
      rows.push(onboardingAnchor(newId(), now));
      await appendModuleEvents(target, rows);
    }
    if (args.weightKg && Number.isFinite(args.weightKg) && args.weightKg > 0) await target.weights.put({ date: format(now, 'yyyy-MM-dd'), kg: args.weightKg });
    await target.plan.put(after);
    return { before, after, fresh };
  });
}

export async function ensureProgressOpened(target: ProtocolDB, now = new Date()): Promise<boolean> {
  return target.transaction('rw', target.moduleEvents, async () => {
    const event = progressOpening(await target.moduleEvents.toArray(), now);
    if (!event) return false;
    await appendModuleEvents(target, [event]); return true;
  });
}

/** D160: a profile whose food or «Результати» was switched off earlier (onboarding, a manual «off») gets them back once —
 *  an ordinary «on» choice, so sync, copies and push read it as they read any other. Not during an unfinished onboarding. */
export async function ensureCoreModules(target: ProtocolDB, now = new Date()): Promise<boolean> {
  return target.transaction('rw', target.moduleEvents, async () => {
    const events = await target.moduleEvents.toArray();
    const visible = modulePreferences(events).modules;
    const off = CORE_MODULES.filter((m) => !visible[m] && moduleChoiceAt(events, m)?.enabled === false);
    // after the «off» even if its device clock ran ahead: a choice stamped earlier would lose and be written again every minute
    for (const module of off) await setModuleEnabled(target, module, true, 'manual',
      new Date(Math.max(now.getTime(), Date.parse(moduleChoiceAt(events, module)!.at) + 1)).toISOString());
    return off.length > 0;
  });
}

export async function acceptPlanModules(target: ProtocolDB, selected: readonly PlanModule[], at = new Date().toISOString()) {
  await target.transaction('rw', target.moduleEvents, async () => {
    for (const module of selected) {
      if (module === 'weight') await setWeightEnabled(target, true, 'plan-review', at);
      else await setModuleEnabled(target, module, true, 'plan-review', at);
    }
  });
}
