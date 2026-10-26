// D133: the real router and its navigation use this catalog. Every screen has one feature owner.
import type { FeatureId } from '../domain/features';

export const ROUTES = {
  day:          { path: '/',               feature: 'day' },
  mealNew:      { path: '/meal/new',       feature: 'food.log' },
  mealEdit:     { path: '/meal/:id',       feature: 'food.log' },
  myDay:        { path: '/my-day',         feature: 'day.checklist' },
  wellbeing:    { path: '/wellbeing',      feature: 'wellbeing.log' },
  workout:      { path: '/workout',        feature: 'workout.log' },
  exercises:    { path: '/exercises',      feature: 'workout.exercises' },
  quickAction:  { path: '/do/:action',     feature: 'quick.action' },
  quickLinks:   { path: '/quick',          feature: 'quick.links' },
  frictions:    { path: '/frictions',      feature: 'frictions' },
  pilot:        { path: '/pilot',          feature: 'pilot' },
  week:         { path: '/week',           feature: 'progress.week' },
  plan:         { path: '/plan',           feature: 'plan' },
  onboarding:   { path: '/welcome',        feature: 'onboarding' },
  progress:     { path: '/progress',       feature: 'progress' },
  weight:       { path: '/weight',         feature: 'wellbeing.weight' },
  modules:      { path: '/modules',        feature: 'modules.settings' },
  report:       { path: '/report',         feature: 'report' },
  dishes:       { path: '/dishes',         feature: 'dishes.list' },
  more:         { path: '/more',           feature: 'more' },
  about:        { path: '/about',          feature: 'about' },
  conciergeLog: { path: '/concierge-log',  feature: 'assistant.log' },
  assistant:    { path: '/assistant',      feature: 'assistant.chat' },
  sync:         { path: '/sync',           feature: 'sync' },
  menu:         { path: '/menu',           feature: 'menu.ai' },
  reminders:    { path: '/reminders',      feature: 'reminders.settings' },
  shopping:     { path: '/shopping',       feature: 'menu.shopping' },
  fallback:     { path: '*',               feature: 'day' },
} as const satisfies Readonly<Record<string, { readonly path: string; readonly feature: FeatureId }>>;

export type RouteId = keyof typeof ROUTES;
export type StaticRouteId = { [K in RouteId]: (typeof ROUTES)[K]['path'] extends `${string}:${string}` | '*' ? never : K }[RouteId];

export const TAB_ROUTES = ['day', 'mealNew', 'plan', 'progress', 'more'] as const satisfies readonly StaticRouteId[];
export type TabRouteId = (typeof TAB_ROUTES)[number];

export const MORE_GROUPS = [
  { titleKey: 'food', routes: ['assistant', 'menu', 'shopping', 'dishes'] },
  { titleKey: 'health', routes: ['wellbeing', 'weight', 'workout', 'week', 'report'] },
  { titleKey: 'settings', routes: ['modules', 'reminders', 'sync', 'quickLinks'] },
  { titleKey: 'app', routes: ['frictions', 'pilot', 'onboarding', 'conciergeLog', 'about'] },
] as const satisfies readonly { readonly titleKey: string; readonly routes: readonly StaticRouteId[] }[];
export type MoreRouteId = (typeof MORE_GROUPS)[number]['routes'][number];

/** The generic /do/:action shell stays available; each action has its own module boundary. */
export const QUICK_ACTION_FEATURES = {
  voice: 'voice', water: 'water.log', med: 'meds.log', symptom: 'unwell', meal: 'food.log', friction: 'frictions',
} as const satisfies Readonly<Record<string, FeatureId>>;
