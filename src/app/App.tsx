import type { ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { ErrorBoundary } from '../components/Recovery';
import { usePlan } from '../data/queries';
import { useUi } from '../store/ui';
import { t } from '../i18n/uk';
import { AddMeal } from '../screens/AddMeal';
import { Day } from '../screens/Day';
import { Dishes } from '../screens/Dishes';
import { More } from '../screens/More';
import { MyDay } from '../screens/MyDay';
import { Onboarding } from '../screens/Onboarding';
import { About } from '../screens/About';
import { ConciergeLog } from '../screens/ConciergeLog';
import { Assistant } from '../screens/Assistant';
import { Plan } from '../screens/Plan';
import { Progress } from '../screens/Progress';
import { Report } from '../screens/Report';
import { Sync } from '../screens/Sync';
import { Menu } from '../screens/Menu';
import { Reminders } from '../screens/Reminders';
import { Shopping } from '../screens/Shopping';
import { Wellbeing } from '../screens/Wellbeing';
import { Workout } from '../screens/Workout';
import { Exercises } from '../screens/Exercises';
import { QuickAction } from '../screens/QuickAction';
import { QuickLinks } from '../screens/QuickLinks';
import { Frictions } from '../screens/Frictions';
import { Week } from '../screens/Week';
import { Pilot } from '../screens/Pilot';
import { ROUTES, type RouteId } from './navigation';
import { FeaturesProvider, useFeatures } from './features';
import { FeatureUnavailable } from '../components/FeatureUnavailable';
import { Modules } from '../screens/Modules';
import { Weight } from '../screens/Weight';
import type { FeatureId } from '../domain/features';

/** A fresh form for every meal: /meal/new after editing /meal/:id must not keep the old state. */
function MealRoute() {
  const { id } = useParams();
  return <AddMeal key={id ?? 'new'} />;
}

// Exhaustive against ROUTES: adding a screen also requires choosing its feature owner in navigation.ts.
const SCREENS = {
  day: <Day />, mealNew: <MealRoute />, mealEdit: <MealRoute />, myDay: <MyDay />,
  wellbeing: <Wellbeing />, workout: <Workout />, exercises: <Exercises />, quickAction: <QuickAction />,
  quickLinks: <QuickLinks />, frictions: <Frictions />, pilot: <Pilot />, week: <Week />, plan: <Plan />,
  onboarding: <Onboarding />, progress: <Progress />, report: <Report />, dishes: <Dishes />, more: <More />,
  about: <About />, conciergeLog: <ConciergeLog />, assistant: <Assistant />, sync: <Sync />, menu: <Menu />,
  reminders: <Reminders />, shopping: <Shopping />, modules: <Modules />, weight: <Weight />, fallback: <Day />,
} satisfies Record<RouteId, ReactNode>;

function FeatureGate({ feature, children }: { feature: FeatureId; children: ReactNode }) {
  const { can } = useFeatures();
  return can(feature) ? <>{children}</> : <FeatureUnavailable feature={feature} />;
}

/** Onboarding opens until it is finished or skipped (SPEC.md §5.9, D17). */
function OnboardingGate({ children }: { children: ReactNode }) {
  const plan = usePlan();
  const onboarded = useUi((s) => s.onboarded);
  const { pathname } = useLocation();
  if (plan && !plan.onboardedAt && !onboarded && pathname !== '/welcome' && pathname !== '/sync') return <Navigate to="/welcome" replace />;
  return <>{children}</>;
}

/** D42: a new screen gets a fresh error boundary — leaving a broken screen clears its error. */
function ScreenBoundary({ children }: { children: ReactNode }) {
  return <ErrorBoundary key={useLocation().pathname}>{children}</ErrorBoundary>;
}

/** D106: a new version is downloading; the page reloads itself when it is in. */
function UpdateBar() {
  const on = useUi((s) => s.updating);
  return on ? <p role="status" className="fixed inset-x-0 top-0 z-50 bg-accent px-4 py-1 text-center text-sm text-surface">{t.update.coming}</p> : null;
}

// Hash routing works on any static host without rewrite rules.
export function App() {
  return (
    <HashRouter>
      <FeaturesProvider>
      <UpdateBar />
      <Layout>
        <OnboardingGate>
          <ScreenBoundary>
          <Routes>
            {(Object.keys(ROUTES) as RouteId[]).map((id) => (
              <Route key={id} path={ROUTES[id].path} element={<FeatureGate feature={ROUTES[id].feature}>{SCREENS[id]}</FeatureGate>} />
            ))}
          </Routes>
          </ScreenBoundary>
        </OnboardingGate>
      </Layout>
      </FeaturesProvider>
    </HashRouter>
  );
}
