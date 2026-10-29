// D133: the real router and its navigation use this catalog. Every screen has one feature owner.
import type { FeatureId } from '../domain/features';

export const ROUTES = {
  profiles: { path: '/profiles', feature: 'profiles' },
  day:          { path: '/',               feature: 'day' },
  food: { path: '/food', feature: 'food.log' },
  mealNew:      { path: '/meal/new',       feature: 'food.log' },
  mealEdit:     { path: '/meal/:id',       feature: 'food.log' },
  myDay:        { path: '/my-day',         feature: 'day.checklist' },
  wellbeing:    { path: '/wellbeing',      feature: 'wellbeing.log' },
  wellbeingJournal: { path: '/wellbeing/journal', feature: 'wellbeing.log' },
  workout:      { path: '/workout',         feature: 'workout.log' },
  exercises:    { path: '/exercises',       feature: 'workout.exercises' },
  quickAction:  { path: '/do/:action',      feature: 'quick.action' },
  quickLinks:   { path: '/quick',           feature: 'quick.links' },
  frictions:    { path: '/frictions',       feature: 'frictions' },
  pilot:        { path: '/pilot',           feature: 'pilot' },
  week:         { path: '/week',            feature: 'progress.week' },
  plan:         { path: '/plan',            feature: 'plan' },
  planPrescriptions: { path: '/plan/prescriptions', feature: 'plan' },
  planConstraints: { path: '/plan/constraints', feature: 'plan' },
  planGoals:    { path: '/plan/goals',       feature: 'plan' },
  planCheckup:  { path: '/plan/checkup',     feature: 'plan' },
  planScan:     { path: '/plan/scan',        feature: 'plan.scan' },
  planHistory:  { path: '/plan/history',     feature: 'plan' },
  clinicInvite: { path: '/clinic/invite', feature: 'clinic.portal' },
  clinicPortal: { path: '/clinic',          feature: 'clinic.portal' },
  planImport:   { path: '/plan/import',      feature: 'plan' },
  onboarding:   { path: '/welcome',         feature: 'onboarding' },
  progress:     { path: '/progress',        feature: 'progress' },
  weight:       { path: '/weight',          feature: 'wellbeing.weight' },
  modules:      { path: '/modules',         feature: 'modules.settings' },
  progressInsights: { path: '/progress/insights', feature: 'progress.patterns' },
  progressMotivation: { path: '/progress/motivation', feature: 'progress.patterns' },
  progressLabs: { path: '/progress/labs',    feature: 'progress.labs' },
  report:       { path: '/report',          feature: 'report' },
  dishes:       { path: '/dishes',          feature: 'dishes.list' },
  foods:        { path: '/foods',           feature: 'food.products' },
  data:         { path: '/data',            feature: 'backup' },
  more:         { path: '/more',            feature: 'more' },
  moreCategory: { path: '/more/:category',  feature: 'more' },
  about:        { path: '/about',           feature: 'about' },
  conciergeLog: { path: '/concierge-log',   feature: 'assistant.log' },
  assistant:    { path: '/assistant',       feature: 'assistant.chat' },
  sync:         { path: '/sync',           feature: 'sync' },
  menu:         { path: '/menu',           feature: 'menu.ai' },
  reminders:    { path: '/reminders',      feature: 'reminders.settings' },
  shopping:     { path: '/shopping',       feature: 'menu.shopping' },
  fallback:     { path: '*',               feature: 'day' },
} as const satisfies Readonly<Record<string, { readonly path: string; readonly feature: FeatureId }>>;

export type RouteId = keyof typeof ROUTES;
export type StaticRouteId = { [K in RouteId]: (typeof ROUTES)[K]['path'] extends `${string}:${string}` | '*' ? never : K }[RouteId];

export const TAB_ROUTES = ['day', 'food', 'plan', 'progress', 'more'] as const satisfies readonly StaticRouteId[];
export type TabRouteId = (typeof TAB_ROUTES)[number];

export const MORE_ROUTE_GROUPS = [
  { id: 'food', routes: ['assistant', 'menu', 'shopping', 'dishes', 'foods'] },
  { id: 'health', routes: ['wellbeing', 'wellbeingJournal', 'weight', 'progressLabs', 'progressMotivation', 'progressInsights', 'workout', 'week', 'report'] },
  { id: 'settings', routes: ['profiles', 'modules', 'reminders', 'sync', 'quickLinks', 'data'] },
  { id: 'app', routes: ['frictions', 'pilot', 'onboarding', 'conciergeLog', 'about'] },
] as const satisfies readonly { readonly id: string; readonly routes: readonly StaticRouteId[] }[];
export type MoreGroupId = (typeof MORE_ROUTE_GROUPS)[number]['id'];
export type MoreRouteId = (typeof MORE_ROUTE_GROUPS)[number]['routes'][number];

/** The generic /do/:action shell stays available; each action has its own module boundary. */
export const QUICK_ACTION_FEATURES = {
  voice: 'voice', water: 'water.log', med: 'meds.log', symptom: 'unwell', meal: 'food.log', friction: 'frictions',
} as const satisfies Readonly<Record<string, FeatureId>>;
