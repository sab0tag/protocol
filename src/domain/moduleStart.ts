// D138: first start uses the confirmed plan. Reading OCR or editing a draft never calls this policy as a command.
import { addDays, format, startOfDay } from 'date-fns';
import type { ModuleFlags, ModuleId } from './features';
import { modulePreferences, type ModuleEvent, type OnboardingEvent } from './modulePreferences';
import type { Plan, Prescription } from './types';

export const ACTIVITY_KINDS = ['walking', 'strength', 'other'] as const;
export const hasActivity = (p: Prescription) => p.kind === 'lifestyle' && ACTIVITY_KINDS.some((kind) => kind === p.activity);
const positive = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0;
export function starterModules(plan: Plan): { modules: ModuleFlags; weight: boolean } {
  const meds = plan.prescriptions.some((p) => p.kind === 'medication' || p.kind === 'supplement');
  return { modules: { meds, water: positive(plan.targets.waterMl), food: !meds, menu: false, assistant: false, wellbeing: false,
    workout: plan.prescriptions.some(hasActivity), progress: false }, weight: positive(plan.targets.weightGoalKg) };
}

export function newModuleProfile(events: readonly ModuleEvent[], plan: Plan): boolean {
  return !plan.onboardedAt && events.some((e) => e.kind === 'onboarding-started')
    && !events.some((e) => e.kind === 'onboarded' || e.kind === 'module' || e.kind === 'weight');
}

/** Computed once in the completing device's calendar, then immutable across DST, travel, restore and other devices. */
export function onboardingAnchor(id: string, now: Date): Extract<OnboardingEvent, { kind: 'onboarded' }> {
  return { id, v: 1, kind: 'onboarded', at: now.toISOString(), date: format(now, 'yyyy-MM-dd'),
    progressAt: startOfDay(addDays(now, 7)).toISOString() };
}
export function progressOpening(events: readonly ModuleEvent[], now: Date): ModuleEvent | undefined {
  if (events.some((e) => e.kind === 'module' && e.module === 'progress' && !['migration', 'onboarding'].includes(e.source))) return;
  const anchors = events.filter((e): e is Extract<OnboardingEvent, { kind: 'onboarded' }> => e.kind === 'onboarded')
    .sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : a.id.localeCompare(b.id));
  const anchor = anchors[0];
  if (!anchor || now.getTime() < Date.parse(anchor.progressAt) || modulePreferences(events).modules.progress) return;
  return { id: `progress:day8:v1:${anchor.progressAt.replaceAll('.', '-')}`, v: 1, at: anchor.progressAt,
    kind: 'module', module: 'progress', enabled: true, source: 'automatic' };
}

export type PlanModule = Extract<ModuleId, 'meds' | 'food' | 'water' | 'workout'> | 'weight';
function evidence(plan: Plan): Record<PlanModule, string> {
  const rx = (test: (p: Prescription) => boolean) => JSON.stringify(plan.prescriptions.filter(test).map((p) =>
    [p.id, p.title, p.dose, p.schedule, p.asNeeded, p.until, p.activity]).sort(([a], [b]) => String(a).localeCompare(String(b))));
  const diet = plan.constraints.filter((c) => c.active).map((c) => [c.id, c.tag, c.diet, c.off]).sort(([a], [b]) => String(a).localeCompare(String(b)));
  const food = diet.length || ['kcal', 'proteinG', 'carbsG', 'fatG', 'calciumMg', 'lastMealBy'].some((key) => plan.targets[key as keyof Plan['targets']] !== undefined);
  return { meds: plan.prescriptions.some((p) => p.kind === 'medication' || p.kind === 'supplement') ? rx((p) => p.kind === 'medication' || p.kind === 'supplement') : '',
    food: food ? JSON.stringify([diet, plan.targets.kcal, plan.targets.proteinG, plan.targets.carbsG, plan.targets.fatG, plan.targets.calciumMg, plan.targets.lastMealBy]) : '',
    water: positive(plan.targets.waterMl) ? String(plan.targets.waterMl) : '', weight: positive(plan.targets.weightGoalKg) ? String(plan.targets.weightGoalKg) : '',
    workout: plan.prescriptions.some(hasActivity) ? rx(hasActivity) : '' };
}
/** A new/changed positive prescription offers an opt-in; it never turns anything on or off. */
export function planModuleSuggestions(before: Plan, after: Plan, events: readonly ModuleEvent[]): PlanModule[] {
  const a = evidence(before), b = evidence(after), prefs = modulePreferences(events);
  return (Object.keys(b) as PlanModule[]).filter((key) => !!b[key] && a[key] !== b[key]
    && (key === 'weight' ? !(prefs.overrides['wellbeing.weight'] ?? prefs.modules.wellbeing) : !prefs.modules[key]));
}
