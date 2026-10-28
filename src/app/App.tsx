import type { ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { ErrorBoundary } from '../components/Recovery';
import { usePlan } from '../data/queries';
import { useUi } from '../store/ui';
import { t } from '../i18n/uk';
import { Nutrition } from '../screens/Nutrition';
import { AddMeal } from '../screens/AddMeal';
import { Profiles } from '../screens/Profiles';
import { Day } from '../screens/Day';
import { Dishes } from '../screens/Dishes';
import { More } from '../screens/More';
import { MoreCategory } from '../screens/MoreCategory';
import { MyDay } from '../screens/MyDay';
import { Onboarding } from '../screens/Onboarding';
import { About } from '../screens/About';
import { ConciergeLog } from '../screens/ConciergeLog';
import { Assistant } from '../screens/Assistant';
import { Plan } from '../screens/Plan';
import { PlanScanScreen } from '../screens/PlanScanScreen';
import { ClinicPortalScreen } from '../screens/ClinicPortalScreen';
import { PlanImportScreen } from '../screens/PlanImportScreen';
import { PlanHistory } from '../screens/PlanHistory';
import { Progress } from '../screens/Progress';
import { Insights } from '../screens/Insights';
import { Motivation } from '../screens/Motivation';
import { Labs } from '../screens/Labs';
import { MyFoods } from '../screens/MyFoods';
import { WellbeingJournal } from '../screens/WellbeingJournal';
import { Data } from '../screens/Data';
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

/** A fresh form for every meal: /meal/new after editing /meal/:id must not keep the old state. */
function MealRoute() {
  const { id } = useParams();
  return <AddMeal key={id ?? 'new'} />;
}

// Exhaustive against ROUTES: adding a screen also requires choosing its feature owner in navigation.ts.
const SCREENS = {
  food: <Nutrition />, profiles: <Profiles />, day: <Day />, mealNew: <MealRoute />, mealEdit: <MealRoute />, myDay: <MyDay />,
  wellbeing: <Wellbeing />, wellbeingJournal: <WellbeingJournal />, workout: <Workout />, exercises: <Exercises />, quickAction: <QuickAction />,
  quickLinks: <QuickLinks />, frictions: <Frictions />, pilot: <Pilot />, week: <Week />, plan: <Plan />,
  planPrescriptions: <Plan section="prescriptions" />, planConstraints: <Plan section="constraints" />,
  planGoals: <Plan section="goals" />, planCheckup: <Plan section="checkup" />,
  planScan: <PlanScanScreen />, planHistory: <PlanHistory />, planImport: <PlanImportScreen />, clinicPortal: <ClinicPortalScreen />,
  onboarding: <Onboarding />, progress: <Progress />, progressInsights: <Insights />, progressMotivation: <Motivation />,
  progressLabs: <Labs />, report: <Report />, dishes: <Dishes />, foods: <MyFoods />, data: <Data />,
  more: <More />, moreCategory: <MoreCategory />, about: <About />, conciergeLog: <ConciergeLog />,
  assistant: <Assistant />, sync: <Sync />, menu: <Menu />, reminders: <Reminders />, shopping: <Shopping />, fallback: <Day />,
} satisfies Record<RouteId, ReactNode>;

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
      <UpdateBar />
      <Layout>
        <OnboardingGate>
          <ScreenBoundary>
          <Routes>
            {(Object.keys(ROUTES) as RouteId[]).map((id) => (
              <Route key={id} path={ROUTES[id].path} element={SCREENS[id]} />
            ))}
          </Routes>
          </ScreenBoundary>
        </OnboardingGate>
      </Layout>
    </HashRouter>
  );
}
