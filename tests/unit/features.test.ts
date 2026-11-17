import { describe, expect, it } from 'vitest';
import { ALL_MODULES, can, FEATURES, isEntitled, isFeatureId, isFeatureVisible, isModuleId, LEGACY_FEATURE_CONTEXT,
  MODULE_IDS, type FeatureContext, type FeatureDefinition, type FeatureId, type ModuleFlags } from '../../src/domain/features';
import { MORE_ROUTES, parentPath, QUICK_ACTION_FEATURES, ROUTES, SETTINGS_PATH, SETTINGS_ROUTES, TAB_ROUTES, tabForPath } from '../../src/app/navigation';

const off: ModuleFlags = { meds: false, water: false, food: false, menu: false, assistant: false, wellbeing: false, workout: false, progress: false };
const disabled: FeatureContext = { modules: off, tier: 'free' };

describe('feature access (D133)', () => {
  it('keeps every existing feature available during the preparation release', () => {
    for (const id of Object.keys(FEATURES) as FeatureId[]) expect(can(id, LEGACY_FEATURE_CONTEXT), id).toBe(true);
  });

  it('keeps safety features free, including the prescribed-plan and food checks', () => {
    for (const [id, feature] of Object.entries(FEATURES) as [FeatureId, FeatureDefinition][]) {
      if (feature.safety) expect(feature.tier, id).toBe('free');
    }
    for (const id of ['plan.scan', 'food.check', 'food.why', 'report', 'danger.cards'] as const) {
      expect(FEATURES[id].safety, id).toBe(true);
    }
  });

  it('does not let safety or a plus plan override a disabled module', () => {
    expect(can('meds.reminders', disabled)).toBe(false);
    expect(can('meds.prn', { ...disabled, tier: 'plus' })).toBe(false);
    expect(can('food.check', disabled)).toBe(false);
    expect(can('food.why', disabled)).toBe(false);
  });

  it('keeps the plan, reports, emergency input and recovery available with all modules off', () => {
    for (const id of ['day', 'plan', 'plan.scan', 'plan.incomplete', 'plan.course-end', 'report', 'unwell', 'danger.cards',
      'voice', 'sync', 'backup', 'pilot', 'frictions', 'modules.settings'] as const) expect(can(id, disabled), id).toBe(true);
  });

  it('changes only the selected module, without implicitly enabling dependent modules', () => {
    const food = { ...disabled, modules: { ...off, food: true } };
    expect(can('food.log', food)).toBe(true);
    expect(can('dishes.batch', food)).toBe(true);
    expect(can('menu.ai', food)).toBe(false);
    expect(can('assistant.chat', food)).toBe(false);
    expect(can('workout.log', food)).toBe(false);
  });

  it('can enable weight on its own without enabling the wellbeing scales', () => {
    const weight = { ...disabled, overrides: { 'wellbeing.weight': true } } as const;
    expect(can('wellbeing.weight', weight)).toBe(true);
    expect(can('wellbeing.log', weight)).toBe(false);
    expect(can('progress', weight)).toBe(false);
    expect(can('wellbeing.weight', { modules: ALL_MODULES, tier: 'free', overrides: { 'wellbeing.weight': false } })).toBe(false);
  });

  it('shows all modules in the example, including a manually hidden weight feature', () => {
    const demo = { ...disabled, demo: true, overrides: { 'wellbeing.weight': false } } as const;
    for (const id of Object.keys(FEATURES) as FeatureId[]) expect(isFeatureVisible(id, demo), id).toBe(true);
  });

  it('keeps tier entitlement independent of visibility and the example', () => {
    expect(isEntitled('free', 'free')).toBe(true);
    expect(isEntitled('free', 'plus')).toBe(true);
    expect(isEntitled('plus', 'free')).toBe(false);
    expect(isEntitled('plus', 'plus')).toBe(true);
  });

  it('accepts only known identifiers, never object prototype names', () => {
    expect(isFeatureId('food.log')).toBe(true);
    expect(isModuleId('food')).toBe(true);
    for (const value of ['unknown', 'constructor', 'toString', '__proto__', null, undefined, 0, {}]) {
      expect(isFeatureId(value)).toBe(false);
      expect(isModuleId(value)).toBe(false);
    }
  });
});

describe('navigation ownership (D133)', () => {
  it('assigns every real route to a registered feature and does not duplicate paths', () => {
    const paths = Object.values(ROUTES).map((route) => route.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const route of Object.values(ROUTES)) expect(isFeatureId(route.feature), route.path).toBe(true);
    for (const feature of Object.values(FEATURES)) {
      expect(feature.module === null || MODULE_IDS.includes(feature.module)).toBe(true);
    }
  });

  it('makes tabs and More refer to the actual router instead of separate URL lists', () => {
    const more = [...MORE_ROUTES, ...SETTINGS_ROUTES];
    expect(new Set(more).size).toBe(more.length);
    for (const id of [...TAB_ROUTES, ...more]) {
      expect(ROUTES[id].path).not.toMatch(/[:*]/);
      expect(can(ROUTES[id].feature, LEGACY_FEATURE_CONTEXT)).toBe(true);
    }
  });

  it('shows three tabs only on their own screens; every other screen has a parent for «Назад» (ТЗ 17.11, step 2)', () => {
    expect(TAB_ROUTES).toEqual(['day', 'plan', 'progress']);
    expect(['/', '/plan', '/progress'].map(tabForPath)).toEqual(['day', 'plan', 'progress']);
    for (const path of ['/more', '/meal/new', '/meal/x', '/plan/prescriptions', '/week', '/report', '/welcome', '/sync']) expect(tabForPath(path), path).toBeNull();
    expect(parentPath('/plan/constraints')).toBe('/plan');
    expect(parentPath('/report')).toBe('/progress');
    expect(parentPath('/progress/labs')).toBe('/progress');
    expect(parentPath('/sync')).toBe('/more/settings');
    expect(parentPath('/more/settings')).toBe('/more');
    expect(parentPath('/dishes')).toBe('/more');
    expect(parentPath('/meal/new')).toBe('/');
    expect(parentPath('/more')).toBe('/');
  });

  it('keeps the generic quick-action shell available while its actions have separate owners', () => {
    expect(can(ROUTES.quickAction.feature, disabled)).toBe(true);
    expect(can(QUICK_ACTION_FEATURES.water, disabled)).toBe(false);
    expect(can(QUICK_ACTION_FEATURES.med, disabled)).toBe(false);
    expect(can(QUICK_ACTION_FEATURES.symptom, disabled)).toBe(true);
    expect(can(QUICK_ACTION_FEATURES.voice, disabled)).toBe(true);
  });
});

describe('nothing is lost after the simplification (ТЗ 17.11, «Ничего не потеряно»)', () => {
  // where each function is used; a screen route, or the screen that holds it
  const ENTRY: Record<FeatureId, string> = {
    profiles: '/profiles', day: '/', 'day.checklist': '/my-day', 'day.light': '/', 'meds.log': '/', 'meds.reminders': '/reminders', 'meds.prn': '/',
    'water.log': '/', 'water.reminders': '/reminders', 'food.log': '/', 'food.photo': '/', 'food.label': '/meal/new', 'food.check': '/', 'food.why': '/',
    'food.products': '/foods', 'food.favorites': '/', 'food.not-found': '/', 'dishes.list': '/dishes', 'dishes.single': '/dishes', 'dishes.batch': '/dishes',
    'dishes.export': '/dishes', 'menu.ai': '/menu', 'menu.yesterday': '/', 'menu.shopping': '/shopping', 'menu.evening': '/', 'menu.topup': '/',
    'assistant.chat': '/assistant', 'assistant.log': '/concierge-log', 'wellbeing.log': '/wellbeing', 'wellbeing.weight': '/weight',
    'workout.log': '/workout', 'workout.exercises': '/exercises', 'workout.progression': '/workout', 'workout.ai': '/workout',
    progress: '/progress', 'progress.week': '/week', 'progress.patterns': '/progress/insights', 'progress.labs': '/progress/labs', 'progress.labs-photo': '/progress/labs',
    plan: '/plan', 'plan.scan': '/plan/scan', 'plan.medbox': '/plan', 'plan.incomplete': '/plan', 'plan.course-end': '/plan', report: '/report',
    unwell: '/', 'danger.cards': '/', voice: '/', sync: '/sync', backup: '/data', pilot: '/pilot', frictions: '/frictions', about: '/about',
    'clinic.portal': '/clinic', onboarding: '/welcome', more: '/more', 'modules.settings': '/modules', 'reminders.settings': '/reminders',
    'quick.links': '/quick', 'quick.action': '/do/water',
  };
  // the app's sources as text, through Vite (no Node API: the build type-checks tests without @types/node)
  const files = import.meta.glob<string>(['../../src/**/*.ts', '../../src/**/*.tsx', '!../../src/app/navigation.ts'], { query: '?raw', import: 'default', eager: true });
  const code = Object.values(files).join('\n');
  const matches = (pattern: string, path: string) => new RegExp(`^${pattern.replace(/:[^/]+/g, '[^/]+')}$`).test(path);
  const listed = new Set<string>(['/more', SETTINGS_PATH, ...TAB_ROUTES.map((id) => ROUTES[id].path), ...[...MORE_ROUTES, ...SETTINGS_ROUTES].map((id) => ROUTES[id].path)]);

  it('every function in the registry has a route, and the route has a way in — a tab, «Ще», «Налаштування» or a link from a screen', () => {
    const missing: string[] = [];
    for (const [feature, path] of Object.entries(ENTRY) as [FeatureId, string][]) {
      const route = Object.values(ROUTES).find((r) => r.path !== '*' && matches(r.path, path));
      if (!route) { missing.push(`${feature}: no route for ${path}`); continue; }
      const base = route.path.split('/:')[0]!;
      // the clinic portal is for staff (not in the patient menu); a way in is still checked: its own address
      const linked = listed.has(route.path) || feature === 'clinic.portal'
        || new RegExp(`(to=|to: |navigate\\(|href=|#)\\{?[\`'"]?${base.replace(/[/]/g, '\\/')}(?:[\`'"?/$])`).test(code);
      if (!linked) missing.push(`${feature}: nothing links to ${route.path}`);
    }
    expect(missing).toEqual([]);
  });
});

