import { HashRouter, Route, Routes, useParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Soon } from '../components/Soon';
import { t } from '../i18n/uk';
import { AddMeal } from '../screens/AddMeal';
import { Day } from '../screens/Day';
import { Plan } from '../screens/Plan';
import { More } from '../screens/More';

/** A fresh form for every meal: /meal/new after editing /meal/:id must not keep the old state. */
function MealRoute() {
  const { id } = useParams();
  return <AddMeal key={id ?? 'new'} />;
}

// Hash routing works on any static host without rewrite rules.
export function App() {
  return (
    <HashRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Day />} />
          <Route path="/meal/new" element={<MealRoute />} />
          <Route path="/meal/:id" element={<MealRoute />} />
          <Route path="/plan" element={<Plan />} />
          <Route path="/progress" element={<Soon title={t.nav.progress} />} />
          <Route path="/more" element={<More />} />
          <Route path="*" element={<Day />} />
        </Routes>
      </Layout>
    </HashRouter>
  );
}
