// D133: module visibility and tier entitlement are independent. Safety means free, not «ignore module off».
// This is a contract only: persisted preferences, day eligibility and server quotas land in later PRs.

export const MODULE_IDS = ['meds', 'water', 'food', 'menu', 'assistant', 'wellbeing', 'workout', 'progress'] as const;
export type ModuleId = (typeof MODULE_IDS)[number];
export type ModuleFlags = Readonly<Record<ModuleId, boolean>>;
export type Tier = 'free' | 'plus';

/** Names of server AI operations; a client-side entitlement never authorizes an API request. */
export type AiOperation = 'photo' | 'label' | 'conclusion' | 'medbox' | 'labs' | 'dish' | 'dishes' | 'menu' | 'workout' | 'not-found' | 'chat';

/** A safety function cannot be assigned a paid tier, including when a new function is added. */
export type FeatureDefinition = {
  readonly module: ModuleId | null;
  readonly ai?: AiOperation;
} & ({ readonly safety: true; readonly tier: 'free' } | { readonly safety?: false; readonly tier: Tier });

export const FEATURES = {
  'profiles': { module: null, tier: 'free' },
  'day':                  { module: null,        tier: 'free' },
  'day.checklist':        { module: null,        tier: 'free' },
  'day.light':            { module: null,        tier: 'free' },
  'meds.log':             { module: 'meds',      tier: 'free', safety: true },
  'meds.reminders':       { module: 'meds',      tier: 'free', safety: true },
  'meds.prn':             { module: 'meds',      tier: 'free', safety: true },
  'water.log':            { module: 'water',     tier: 'free' },
  'water.reminders':      { module: 'water',     tier: 'free' },
  'food.log':             { module: 'food',      tier: 'free' },
  'food.photo':           { module: 'food',      tier: 'free', ai: 'photo' },
  'food.label':           { module: 'food',      tier: 'free', ai: 'label' },
  'food.check':           { module: 'food',      tier: 'free', safety: true },
  'food.why':             { module: 'food',      tier: 'free', safety: true },
  'food.products':        { module: 'food',      tier: 'free' },
  'food.favorites':       { module: 'food',      tier: 'free' },
  'food.not-found':       { module: 'food',      tier: 'free', ai: 'not-found' },
  'dishes.list':          { module: 'food',      tier: 'free' },
  'dishes.single':        { module: 'food',      tier: 'free', ai: 'dish' },
  'dishes.batch':         { module: 'food',      tier: 'free', ai: 'dishes' },
  'dishes.export':        { module: 'food',      tier: 'free' },
  'menu.ai':              { module: 'menu',      tier: 'free', ai: 'menu' },
  'menu.yesterday':       { module: 'menu',      tier: 'free' },
  'menu.shopping':        { module: 'menu',      tier: 'free' },
  'menu.evening':         { module: 'menu',      tier: 'free' },
  'menu.topup':           { module: 'menu',      tier: 'free' },
  'assistant.chat':       { module: 'assistant', tier: 'free', ai: 'chat' },
  'assistant.log':        { module: 'assistant', tier: 'free' },
  'wellbeing.log':        { module: 'wellbeing', tier: 'free' },
  'wellbeing.weight':     { module: 'wellbeing', tier: 'free' },
  'workout.log':          { module: 'workout',   tier: 'free' },
  'workout.exercises':    { module: 'workout',   tier: 'free' },
  'workout.progression':  { module: 'workout',   tier: 'free' },
  'workout.ai':           { module: 'workout',   tier: 'free', ai: 'workout' },
  'progress':             { module: 'progress',  tier: 'free' },
  'progress.week':        { module: 'progress',  tier: 'free' },
  'progress.patterns':    { module: 'progress',  tier: 'free' },
  'progress.labs':        { module: 'progress',  tier: 'free' },
  'progress.labs-photo':  { module: 'progress',  tier: 'free', ai: 'labs' },
  'plan':                 { module: null,        tier: 'free', safety: true },
  'plan.scan':            { module: null,        tier: 'free', safety: true, ai: 'conclusion' },
  'plan.medbox':          { module: null,        tier: 'free', safety: true, ai: 'medbox' },
  'plan.incomplete':      { module: null,        tier: 'free', safety: true },
  'plan.course-end':      { module: null,        tier: 'free', safety: true },
  'report':               { module: null,        tier: 'free', safety: true },
  'unwell':               { module: null,        tier: 'free', safety: true },
  'danger.cards':         { module: null,        tier: 'free', safety: true },
  'voice':                { module: null,        tier: 'free', safety: true },
  'sync':                 { module: null,        tier: 'free' },
  'backup':               { module: null,        tier: 'free' },
  'pilot':                { module: null,        tier: 'free' },
  'frictions':            { module: null,        tier: 'free' },
  'about':                { module: null,        tier: 'free' },
  'onboarding':           { module: null,        tier: 'free' },
  'more':                 { module: null,        tier: 'free' },
  'modules.settings':     { module: null,        tier: 'free' },
  'reminders.settings':   { module: null,        tier: 'free' },
  'quick.links':          { module: null,        tier: 'free' },
  'quick.action':         { module: null,        tier: 'free' },
} as const satisfies Readonly<Record<string, FeatureDefinition>>;

export type FeatureId = keyof typeof FEATURES;
/** Only weight can be enabled on its own; arbitrary feature overrides must not bypass modules. */
export type FeatureOverrides = Readonly<Partial<Record<'wellbeing.weight', boolean>>>;

export interface FeatureContext {
  readonly modules: ModuleFlags;
  readonly tier: Tier;
  readonly demo?: boolean;
  readonly overrides?: FeatureOverrides;
}

// Compatibility for the preparation release. Do not infer user preferences from these defaults.
export const ALL_MODULES: ModuleFlags = Object.freeze({
  meds: true, water: true, food: true, menu: true, assistant: true, wellbeing: true, workout: true, progress: true,
});
export const LEGACY_FEATURE_CONTEXT: FeatureContext = Object.freeze({ modules: ALL_MODULES, tier: 'free' });

export const isModuleId = (value: unknown): value is ModuleId =>
  typeof value === 'string' && MODULE_IDS.some((id) => id === value);
export const isFeatureId = (value: unknown): value is FeatureId =>
  typeof value === 'string' && Object.hasOwn(FEATURES, value);

/** Visibility only. The example shows every module; this does not grant a paid entitlement. */
export function isFeatureVisible(feature: FeatureId, context: FeatureContext): boolean {
  const { module } = FEATURES[feature];
  if (module === null || context.demo) return true;
  if (feature === 'wellbeing.weight' && context.overrides?.[feature] !== undefined) return context.overrides[feature]!;
  return context.modules[module];
}

export const isEntitled = (featureTier: Tier, plan: Tier): boolean => featureTier === 'free' || plan === 'plus';

/** Does not decide whether a task is due or suppressed for a light day. Voluntary entry stays a separate action. */
export function can(feature: FeatureId, context: FeatureContext): boolean {
  return isFeatureVisible(feature, context) && isEntitled(FEATURES[feature].tier, context.tier);
}
