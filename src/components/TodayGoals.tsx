// ТЗ «упрощение» 17.11, step 3 (D164): «Цілі на сьогодні» left «Сьогодні» — the goals live in «Результати». The same
// numbers and the same choice of the main two or three (D53); the plan's targets as the observation counts them (D135).
import { useFeatures } from '../app/features';
import { useObservation } from '../app/observation';
import { useDayEntries, useFoods, usePlan, useWorkouts } from '../data/queries';
import { todayISO } from '../domain/dates';
import { presentDay } from '../domain/dayPresentation';
import { foodState } from '../domain/habits';
import { lightDayOnDate } from '../domain/lightDay';
import { dayTotals, effectiveTargets, saltLimit } from '../domain/nutrition';
import { observedTargets, scoredDay } from '../domain/observation';
import { t } from '../i18n/uk';
import { DaySummary, type MetricKey } from './DaySummary';

export function TodayGoals() {
  const date = todayISO();
  const { can, context, enabled } = useFeatures();
  const { observation, ready } = useObservation();
  const entries = useDayEntries(date);
  const foods = useFoods();
  const plan = usePlan();
  const workouts = useWorkouts();
  if (!ready || !entries || !foods || !workouts) return null;
  const light = enabled && !context.demo && lightDayOnDate(observation?.events ?? [], date, observation?.now ?? new Date());
  const targets = observedTargets(effectiveTargets(plan, date), date, observation);
  const checklist = presentDay({ plan, date, entries, workouts, foods, context, now: new Date(), observation, light, lastMealBy: targets.lastMealBy }).checklist;
  const meds = checklist.items.filter((i) => i.kind === 'med');
  const allowed: MetricKey[] | undefined = observation ? [
    ...(can('meds.log') && meds.length ? ['meds' as const] : []), ...(can('water.log') && scoredDay(observation, 'water', date) ? ['water' as const] : []),
    ...(can('food.log') && scoredDay(observation, 'food', date) ? ['carbs', 'protein', 'calcium', 'kcal'] as const : []),
  ] : undefined;
  return (
    <div className="protocol-card p-0">
      <p aria-hidden className="px-4 pt-4 font-semibold">{t.summary.title}</p>{/* the region's own name is sr-only in the compact look */}
      <DaySummary compact quiet={light} title={t.summary.title} totals={dayTotals(entries, foods)} targets={targets} allowed={allowed}
        salt={allowed && !allowed.includes('kcal') ? null : saltLimit(plan)}
        meds={{ done: meds.filter((i) => i.done).length, total: meds.length }} {...(!light ? { food: foodState(entries) } : {})} />
    </div>
  );
}
