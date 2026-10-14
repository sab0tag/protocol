// «Тиждень» (D72): the last 7 days in one screen — the numbers, what went well (habits met on most days, workouts,
// records), and one goal for the next week that the person picks (a suggestion from the weakest habit, or own words).
// No score of the week, nothing to feel bad about: days without records are not counted as misses.
import { format, parseISO } from 'date-fns';
import { uk } from 'date-fns/locale';
import { useState } from 'react';
import { Loading } from '../components/Recovery';
import { saved } from '../components/Toast';
import { db } from '../data/db';
import { useAllEntries, useFoods, usePlan, useWorkouts } from '../data/queries';
import { todayISO } from '../domain/dates';
import { habits, weekSummary, type HabitKey } from '../domain/habits';
import { motivation } from '../domain/progression';
import { t } from '../i18n/uk';
import { HabitsCard, WeekCard } from './Progress';

const L = t.week;

export function Week() {
  const plan = usePlan();
  const entries = useAllEntries();
  const workouts = useWorkouts();
  const foods = useFoods();
  const [goal, setGoal] = useState<string | null>(null);
  if (!entries || !workouts || !foods) return <Loading />;
  const today = todayISO();
  const summary = weekSummary({ plan, entries, workouts, foods, today });
  const list = habits({ plan, entries, workouts, foods, today });
  const good = list.filter((h) => h.days7 > 0 && h.last7 >= Math.max(1, Math.ceil(h.days7 * 0.7)));
  const weakest = [...list].filter((h) => h.days7 > 0).sort((a, b) => a.last7 / a.days7 - b.last7 / b.days7)[0];
  const m = motivation(workouts, today);
  const suggestions = [...new Set([...(weakest ? [L.goals[weakest.key as HabitKey]] : []), L.goalWorkouts, ...Object.values(L.goals)])].slice(0, 4);
  const current = plan?.weekGoal;
  const saveGoal = async (text: string) => {
    if (!plan) return;
    const before = plan.weekGoal;
    await saved(db.plan.update('main', { weekGoal: text.trim() ? { text: text.trim(), set: today } : undefined }), L.goalSaved,
      () => db.plan.update('main', { weekGoal: before }));
    setGoal(null);
  };

  return (
    <section className="space-y-4 pt-4">
      <h1 className="text-2xl font-semibold">{L.title}</h1>
      <WeekCard summary={summary} />

      <section aria-label={L.went} className="rounded-2xl border border-accent/30 bg-accent/10 p-3">
        <h2 className="mb-1 font-semibold">{L.went}</h2>
        {good.length || m.week || m.records.length ? (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {good.map((h) => <li key={h.key}>{L.habitLine(t.progress.habit[h.key], h.last7, h.days7)}</li>)}
            {m.week > 0 && <li>{t.workout.weekNumbers(m.week, String(m.tonnesWeek).replace('.', ','))}</li>}
            {m.records.map((r) => <li key={r.exercise.id}>{t.workout.record(r.exercise.name, r.value, r.exercise.timed)}</li>)}
          </ul>
        ) : <p className="text-sm text-muted">{L.nothingYet}</p>}
      </section>

      <HabitsCard list={list} />

      <section aria-label={L.goal} className="space-y-2 rounded-2xl border border-line bg-surface p-3">
        <h2 className="font-semibold">{L.goal}</h2>
        {current && goal === null && (
          <p className="text-sm">{current.text} <span className="text-muted">· {L.since(format(parseISO(current.set), 'd MMMM', { locale: uk }))}</span></p>
        )}
        {goal === null ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setGoal(current?.text ?? '')} className="min-h-tap rounded-xl border border-accent px-3 font-medium text-accent">
              {current ? L.change : L.pick}</button>
            {current && <button type="button" onClick={() => void saveGoal('')} className="min-h-tap px-2 text-sm text-muted">{L.clear}</button>}
          </div>
        ) : (
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void saveGoal(goal); }}>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button key={s} type="button" aria-pressed={goal === s} onClick={() => setGoal(s)}
                  className={`min-h-tap rounded-full border px-3 text-sm ${goal === s ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-line'}`}>{s}</button>
              ))}
            </div>
            <label className="block"><span className="text-sm text-muted">{L.own}</span>
              <input value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={120} className="mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3" /></label>
            <button type="submit" disabled={!goal.trim()} className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface disabled:opacity-40">{L.save}</button>
          </form>
        )}
      </section>
    </section>
  );
}
