import type { ProtocolDB } from './db';
import { appendModuleEvents, setModuleEnabled, setWeightEnabled } from './modulePreferences';
import { MODULE_IDS, type ModuleFlags } from '../domain/features';
import { newId } from '../domain/dates';
import { newModuleProfile, onboardingAnchor, progressOpening, starterModules, type PlanModule } from '../domain/moduleStart';
import type { ModuleEvent } from '../domain/modulePreferences';
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
      const rows: ModuleEvent[] = MODULE_IDS.map((module) => ({ id: newId(), v: 1, at, kind: 'module', module,
        enabled: args.choices?.[module] ?? defaults.modules[module], source: args.choices?.[module] !== undefined ? 'manual' : 'onboarding' }));
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

export async function acceptPlanModules(target: ProtocolDB, selected: readonly PlanModule[], at = new Date().toISOString()) {
  await target.transaction('rw', target.moduleEvents, async () => {
    for (const module of selected) {
      if (module === 'weight') await setWeightEnabled(target, true, 'plan-review', at);
      else await setModuleEnabled(target, module, true, 'plan-review', at);
    }
  });
}
