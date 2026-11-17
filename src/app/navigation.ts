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

/** ТЗ «упрощение» 17.11, step 2: three tabs; «Ще» is a header button, not a tab. */
export const TAB_ROUTES = ['day', 'plan', 'progress'] as const satisfies readonly StaticRouteId[];
export type TabRouteId = (typeof TAB_ROUTES)[number];

/** Only the three section screens carry the tab bar; every other screen opens over them with «Назад» and no tabs,
 *  so the highlighted tab always is the section on screen. */
export function tabForPath(pathname: string): TabRouteId | null {
  return TAB_ROUTES.find((id) => ROUTES[id].path === pathname) ?? null;
}

/** «Ще»: one flat list, filtered by modules. Service settings live one level down, in «Налаштування». */
export const MORE_ROUTES = ['assistant', 'menu', 'wellbeing', 'workout', 'dishes', 'foods', 'profiles', 'frictions', 'pilot', 'conciergeLog', 'about'] as const satisfies readonly StaticRouteId[];
export type MoreRouteId = (typeof MORE_ROUTES)[number];
export const SETTINGS_PATH = '/more/settings';
export const SETTINGS_ROUTES = ['reminders', 'sync', 'data', 'modules', 'quickLinks', 'onboarding'] as const satisfies readonly StaticRouteId[];
export type SettingsRouteId = (typeof SETTINGS_ROUTES)[number];

const isOneOf = (pathname: string, ids: readonly StaticRouteId[]) => ids.some((id) => ROUTES[id].path === pathname);

/** Where «Назад» leads when a screen was opened directly (a link, a reload) and there is no in-app history. */
export function parentPath(pathname: string): string {
  if (pathname.startsWith('/plan/') || pathname === '/clinic/invite') return '/plan';
  if (pathname.startsWith('/progress/') || ['/week', '/report', '/weight'].includes(pathname)) return '/progress';
  if (isOneOf(pathname, SETTINGS_ROUTES)) return SETTINGS_PATH;
  if (pathname === '/wellbeing/journal') return '/wellbeing';
  if (pathname === '/shopping') return '/menu';
  if (pathname === '/exercises') return '/workout';
  if (pathname.startsWith('/more/') || isOneOf(pathname, MORE_ROUTES)) return '/more';
  return '/';
}

/** The generic /do/:action shell stays available; each action has its own module boundary. */
export const QUICK_ACTION_FEATURES = {
  voice: 'voice', water: 'water.log', med: 'meds.log', symptom: 'unwell', meal: 'food.log', friction: 'frictions',
} as const satisfies Readonly<Record<string, FeatureId>>;
