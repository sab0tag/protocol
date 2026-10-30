import { Beef, ChevronLeft, ChevronRight, Flame, Plus, UtensilsCrossed } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useObservation } from '../app/observation';
import { EntryPreview } from '../components/EntryPreview';
import { ExampleNotice } from '../components/ExampleNotice';
import { FoodArtwork } from '../components/FoodArtwork';
import { ProgressRing } from '../components/ProgressRing';
import { ProgressTrack } from '../components/ProgressTrack';
import { Loading } from '../components/Recovery';
import { SceneHeader } from '../components/SceneHeader';
import { useDayEntries, useFoods, usePlan, useRecentEntries } from '../data/queries';
import { byAt, shownTime, todayISO } from '../domain/dates';
import { evaluate } from '../domain/evaluate';
import { foodPlanStatus } from '../domain/foodPlanStatus';
import { activeMode, dayTotals, effectiveTargets, mealNutrients, round } from '../domain/nutrition';
import { observedTargets } from '../domain/observation';
import { isLocalDate } from '../domain/modulePreferences';
import type { DayEntry, Food, MealItem, Plan } from '../domain/types';
import { t } from '../i18n/uk';
import { useUi } from '../store/ui';

const L = t.nutrition;

/** Read-only daily overview. Existing meal editor owns every record mutation and rule check. */
export function Nutrition() {
  const { date, setDate, shift } = useUi();
  const entries = useDayEntries(date), recent = useRecentEntries(date, 8), foods = useFoods(), plan = usePlan();
  const { observation, ready } = useObservation();
  if (!entries || !recent || !foods || !ready) return <Loading />;
  const meals = entries.filter(e => e.kind === 'meal').sort(byAt);
  const done = meals.filter(e => e.status === 'done');
  const totals = dayTotals(entries, foods), targets = observedTargets(effectiveTargets(plan, date), date, observation);
  const incomplete = done.some(e => !e.items?.length || e.items.some(item => incompleteLine(item, foods)));
  const active = plan?.constraints.filter(c => c.active) ?? [];
  const mode = activeMode(plan, date);
  return <section className="space-y-4 pt-4">
    <SceneHeader title={L.title} description={L.hint} />
    <ExampleNotice plan={plan} />
    <div className="flex items-center gap-2" role="group" aria-label={L.date}>
      <button type="button" aria-label={L.previous} onClick={() => shift(-1)} className="min-h-tap min-w-tap rounded-xl border border-line"><ChevronLeft className="mx-auto" size={20} aria-hidden /></button>
      <label className="min-w-0 flex-1"><span className="sr-only">{L.date}</span><input type="date" value={date} onChange={e => { if (isLocalDate(e.target.value)) setDate(e.target.value); }} className="min-h-tap w-full min-w-0 rounded-xl border border-line bg-surface px-2" /></label>
      <button type="button" aria-label={L.next} onClick={() => shift(1)} className="min-h-tap min-w-tap rounded-xl border border-line"><ChevronRight className="mx-auto" size={20} aria-hidden /></button>
      {date !== todayISO() && <button type="button" onClick={() => setDate(todayISO())} className="min-h-tap px-1 text-sm text-accent">{t.day.today}</button>}
    </div>
    <div className="grid grid-cols-2 gap-2">
      <Link to="/meal/new" className="col-span-2 flex min-h-tap items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-3 font-semibold text-surface"><Plus size={20} aria-hidden />{t.meal.title}</Link>
      <Link to="/dishes" className="flex min-h-tap items-center justify-center rounded-xl border border-line px-2 text-center text-sm">{t.dishes.title}</Link>
      <Link to="/assistant" className="flex min-h-tap items-center justify-center rounded-xl border border-line px-2 text-center text-sm">{L.ask}</Link>
    </div>
    <div className="fold-nutrition-grid"><section className="protocol-card space-y-3" aria-labelledby="nutrition-progress">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="nutrition-progress" className="text-lg font-semibold">{L.progress}</h2><Link to="/plan/goals" className="inline-flex min-h-tap items-center text-sm text-accent">{L.goals}</Link></div>
      <p className="text-sm text-muted">{done.length ? L.partial : L.noRecorded}</p>
      {incomplete && <p className="text-sm text-warn">{L.incomplete}</p>}
      <ul className="grid grid-cols-2 gap-4">
        {[{ label: t.summary.kcal, value: totals.kcal, target: targets.kcal, unit: t.units.kcal, tone: 'energy' as const, Icon: Flame },
          { label: t.summary.protein, value: totals.protein, target: targets.proteinG, unit: t.units.g, tone: 'protein' as const, Icon: Beef }].map(m => {
          const target = m.target && m.target > 0 ? m.target : undefined;
          const text = `${round(m.value)}${target ? ` / ${target}` : ''} ${m.unit}`;
          return <li key={m.label} className="flex min-w-0 flex-col items-center gap-2 text-center">
            <span className="text-sm text-muted">{m.label}</span>
            <ProgressRing label={m.label} valueText={text} ratio={target ? m.value / target : undefined} tone={m.tone}><m.Icon size={24} className="protocol-ring-icon" aria-hidden /></ProgressRing>
            <span className="tabular font-semibold">{text}</span>{!target && <span className="text-xs text-muted">{L.noTarget}</span>}
          </li>;
        })}
      </ul>
      <p className="tabular text-sm text-muted">{t.summary.carbs}: {round(totals.carbs)} {t.units.g} · {L.fat}: {round(totals.fat)} {t.units.g}</p>
      {targets.carbsG?.min != null && <p className="text-sm text-muted">{t.summary.carbs} · {t.summary.atLeast(targets.carbsG.min)}</p>}
      {targets.carbsG?.max != null && targets.carbsG.max > 0 && <div className="space-y-2"><p className="text-sm text-muted">{t.summary.carbs} · {t.summary.limit(targets.carbsG.max)} · {t.summary.limitNote}</p><ProgressTrack ratio={totals.carbs / targets.carbsG.max} label={L.carbLimit} valueText={`${round(totals.carbs)} / ${targets.carbsG.max} ${t.units.g}`} tone={totals.carbs > targets.carbsG.max ? 'warn' : 'carbs'} /></div>}
      {mode && <p className="text-sm text-muted">{L.mode}: {mode.mode.title}</p>}
      {targets.fromDiet && Object.keys(targets.fromDiet).length > 0 && <p className="text-xs text-muted">{L.reference}</p>}
    </section>
    <section className="protocol-card space-y-3" aria-labelledby="nutrition-meals">
      <h2 id="nutrition-meals" className="text-lg font-semibold">{L.meals}</h2>
      {!meals.length ? <div className="space-y-2 py-3"><UtensilsCrossed className="text-accent" aria-hidden /><p className="font-medium">{L.empty}</p><p className="text-sm text-muted">{L.emptyHint}</p></div> : <ul className="space-y-3">{meals.map(entry => <li key={entry.id} className="rounded-2xl border border-line p-3">
        <div className="flex items-start gap-3"><FoodArtwork name={entry.items?.[0]?.name ?? entry.title} /><div className="min-w-0 flex-1"><h3 className="break-words font-semibold">{entry.title}</h3><p className="text-sm text-muted">{shownTime(entry) ?? t.day.timeUnknown} · {t.status[entry.status]}</p>{!!entry.items?.length && <p className="tabular text-sm">{entry.items.some(item => incompleteLine(item, foods)) ? L.incompleteMeal : `${round(mealNutrients(entry.items, foods).kcal)} ${t.units.kcal}`}</p>}</div></div>
        {entry.status !== 'skipped' && <MealCheck entry={entry} foods={foods} plan={plan} recent={recent} date={date} />}
        <details className="mt-2"><summary className="min-h-tap cursor-pointer py-2 text-sm text-accent">{L.details}</summary><EntryPreview entry={entry} foods={foods} /><Link to={`/meal/${encodeURIComponent(entry.id)}`} className="inline-flex min-h-tap items-center text-accent underline">{L.edit}</Link></details>
      </li>)}</ul>}
    </section>
    </div><section className="protocol-card space-y-2" aria-labelledby="nutrition-restrictions">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="nutrition-restrictions" className="text-lg font-semibold">{L.restrictions}</h2><Link to="/plan/constraints" className="inline-flex min-h-tap items-center text-sm text-accent">{L.openPlan}</Link></div>
      {active.length ? <ul className="space-y-2">{active.map(c => <li key={c.id}><p className="font-medium">{c.title}</p>{c.reason && <p className="text-sm text-muted">{c.reason}</p>}</li>)}</ul> : <p className="text-sm text-muted">{L.noRestrictions}</p>}
      <p className="text-xs leading-relaxed text-muted">{t.meal.planLimit}</p>
    </section>
  </section>;
}

function MealCheck({ entry, foods, plan, recent, date }: { entry: DayEntry; foods: Map<string, Food>; plan: Plan | undefined; recent: DayEntry[]; date: string }) {
  if (!plan?.constraints.some(c => c.active)) return null;
  const checks = evaluate({ plan, date, intent: entry.status === 'done' ? 'recorded' : 'proposed', entries: recent, exclude: entry.id, foods, meal: entry.items ?? [] }).checks;
  const status = foodPlanStatus(checks, foods, plan);
  const state = entry.items?.length ? status.state : 'incomplete';
  const label = state === 'allergen' ? t.meal.planAllergen : state === 'clear' ? t.meal.planClear : state === 'incomplete' ? t.meal.planIncomplete : t.meal.planAttention;
  return <div data-plan-status={state} className={`food-plan-check mt-3 rounded-xl border p-3 text-sm ${state === 'clear' ? 'border-accent/40 text-accent' : 'border-warn/30 bg-warn-bg text-warn'}`}>
    <p className="font-medium">{label}</p>{status.reasons.length > 0 && <ul className="mt-1 space-y-1">{status.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
  </div>;
}

function incompleteLine(item: MealItem, foods: Map<string, Food>): boolean {
  if (item.est) return true;
  if (item.components?.length) return item.components.some(part => incompleteLine(part, foods));
  return !item.manual && (!item.foodId || !foods.has(item.foodId));
}
