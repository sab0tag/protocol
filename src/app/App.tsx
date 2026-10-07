import type { ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { usePlan } from '../data/queries';
import { useUi } from '../store/ui';
import { AddMeal } from '../screens/AddMeal';
import { Day } from '../screens/Day';
import { Dishes } from '../screens/Dishes';
import { More } from '../screens/More';
import { MyDay } from '../screens/MyDay';
import { Onboarding } from '../screens/Onboarding';
import { Plan } from '../screens/Plan';
import { Progress } from '../screens/Progress';
import { Report } from '../screens/Report';
import { Sync } from '../screens/Sync';
import { Menu } from '../screens/Menu';
import { Reminders } from '../screens/Reminders';
import { Shopping } from '../screens/Shopping';
import { Wellbeing } from '../screens/Wellbeing';
import { Workout } from '../screens/Workout';

/** A fresh form for every meal: /meal/new after editing /meal/:id must not keep the old state. */
function MealRoute() {
  const { id } = useParams();
  return <AddMeal key={id ?? 'new'} />;
}

/** Onboarding opens until it is finished or skipped (SPEC.md §5.9, D17). */
function OnboardingGate({ children }: { children: ReactNode }) {
  const plan = usePlan();
  const onboarded = useUi((s) => s.onboarded);
  const { pathname } = useLocation();
  if (plan && !plan.onboardedAt && !onboarded && pathname !== '/welcome' && pathname !== '/sync') return <Navigate to="/welcome" replace />;
  return <>{children}</>;
}

// Hash routing works on any static host without rewrite rules.
export function App() {
  return (
    <HashRouter>
      <Layout>
        <OnboardingGate>
          <Routes>
            <Route path="/" element={<Day />} />
            <Route path="/meal/new" element={<MealRoute />} />
            <Route path="/meal/:id" element={<MealRoute />} />
            <Route path="/my-day" element={<MyDay />} />
            <Route path="/wellbeing" element={<Wellbeing />} />
            <Route path="/workout" element={<Workout />} />
            <Route path="/plan" element={<Plan />} />
            <Route path="/welcome" element={<Onboarding />} />
            <Route path="/progress" element={<Progress />} />
            <Route path="/report" element={<Report />} />
            <Route path="/dishes" element={<Dishes />} />
            <Route path="/more" element={<More />} />
            <Route path="/sync" element={<Sync />} />
            <Route path="/menu" element={<Menu />} />
            <Route path="/reminders" element={<Reminders />} />
            <Route path="/shopping" element={<Shopping />} />
            <Route path="*" element={<Day />} />
          </Routes>
        </OnboardingGate>
      </Layout>
    </HashRouter>
  );
}
