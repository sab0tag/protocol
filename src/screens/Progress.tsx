import { SceneHeader } from '../components/SceneHeader';
import { format, parseISO } from 'date-fns';
import { ExampleNotice } from '../components/ExampleNotice';
import { Loading } from '../components/Recovery';
import { saved } from '../components/Toast';
import { AlertTriangle, ChevronRight, FileText, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { db } from '../data/db';
import { useAllEntries, useFoods, usePlan, useWeights, useWorkouts } from '../data/queries';
import { todayISO } from '../domain/dates';
import { weekSummary } from '../domain/habits';
import { pace, tooFastTwoWeeks, weeklyWeights, weightSummary, type WeekWeight } from '../domain/progress';
import { t } from '../i18n/uk';
import { useObservation } from '../app/observation';
import { WeekCard } from './Motivation';

const L = t.progress;
const field = 'mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3';
const dm = (d: string) => format(parseISO(d), 'dd.MM');
const kg = (n: number) => n.toLocaleString('uk-UA', { maximumFractionDigits: 1 });
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${kg(Math.abs(n))}`;

/** «Прогрес» (SPEC.md §5.7). The chart shows the weekly change (honest from zero) against the plan's limit;
 *  the current weight and the change since the start are numbers above it (D23). */
export function Progress() {
  const plan = usePlan();
  const weights = useWeights();
  const entries = useAllEntries();
  const workouts = useWorkouts();
  const foods = useFoods();
  const { observation, ready: observationReady } = useObservation();
  if (!weights || !entries || !workouts || !foods || !observationReady) return <Loading />;

  const max = plan?.targets.maxWeightLossKgPerWeek;
  const weeks = weeklyWeights(weights, max);
  const sum = weightSummary(weights);
  const weekly = weekSummary({ plan, entries, workouts, foods, today: todayISO(), observation });

  return (
    <section className="space-y-4 pt-4">
      <SceneHeader title={L.title} description={t.visual.progressHint}>
        <Link to="/report" className="inline-flex min-h-tap items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-3 text-sm font-medium text-white">
          <FileText size={18} aria-hidden />{L.report}</Link>
      </SceneHeader>
      <ExampleNotice plan={plan} />
      <WeekCard summary={weekly} variant="rings" />
      <nav aria-label={L.details} className="grid grid-cols-2 gap-2">
        {[
          { to: '/progress/labs', label: L.labs },
          { to: '/progress/motivation', label: L.motivationTitle },
          { to: '/progress/insights', label: L.insightsTitle },
        ].map(({ to, label }) => (
          <Link key={to} to={to} className="flex min-h-tap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 font-medium">
            <span>{label}</span><ChevronRight size={18} className="shrink-0 text-muted" aria-hidden />
          </Link>
        ))}
      </nav>

      <section className="protocol-card rounded-2xl border border-line bg-surface p-3">
        <h2 className="mb-2 font-semibold">{L.weight}</h2>
        {sum.now ? (
          <dl className="mb-3 grid grid-cols-2 gap-3 tabular">
            <div><dt className="text-sm text-muted">{L.now}</dt><dd className="text-3xl font-semibold">{kg(sum.now.kg)} <span className="text-base font-normal text-muted">{L.kg}</span></dd></div>
            <div><dt className="text-sm text-muted">{L.fromStart} ({dm(sum.start!.date)})</dt><dd className="text-3xl font-semibold">{signed(sum.delta!)} <span className="text-base font-normal text-muted">{L.kg}</span></dd></div>
          </dl>
        ) : <p className="mb-3 text-muted">{L.noWeight}</p>}

        {max != null && tooFastTwoWeeks(weeks) && (
          <p role="alert" className="mb-3 flex items-start gap-2 rounded-xl bg-warn-bg p-2 text-sm text-warn">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />{L.tooFast(max)}</p>
        )}

        {pace(weeks) !== undefined && (
          <p className={`mb-2 text-sm ${max != null && -pace(weeks)! > max ? 'text-warn' : 'text-muted'}`}>
            {L.pace(signed(pace(weeks)!))}{max != null ? L.paceLimit(kg(max)) : ''}</p>
        )}
        {weeks.length > 1 && <WeeklyChart weeks={weeks} max={max} />}
        <AddWeight />
      </section>
    </section>
  );
}

function WeeklyChart({ weeks, max }: { weeks: WeekWeight[]; max?: number }) {
  const data = weeks.map((w) => ({ ...w, label: dm(w.week) }));
  return (
    <figure>
      <figcaption className="mb-1 text-sm text-muted">{L.chartTitle}</figcaption>
      <div role="img" aria-label={L.chartLabel(max)} className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} className="stroke-line" strokeDasharray="0" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ className: 'fill-muted', fontSize: 12 }} />
            <YAxis tickLine={false} axisLine={false} tick={{ className: 'fill-muted', fontSize: 12 }} width={40}
              domain={['dataMin - 1', 'dataMax + 1']} tickFormatter={(v: number) => kg(v)} />
            <Tooltip cursor={{ className: 'fill-line', opacity: 0.4 }}
              content={({ active, payload }) => {
                const w = active && payload?.[0]?.payload as (WeekWeight & { label: string }) | undefined;
                return w ? <div className="rounded-xl border border-line bg-surface px-3 py-2 text-sm shadow">
                  <p className="font-medium">{L.weekOf(w.label)}</p>
                  <p className="tabular">{kg(w.kg)} {L.kg}{w.change !== undefined && ` · ${signed(w.change)} ${L.kg}/${L.weekUnit}`}</p></div> : null;
              }} />
            <Line type="monotone" dataKey="kg" stroke="currentColor" className="text-accent" strokeWidth={3}
              dot={{ r: 4, className: 'fill-accent stroke-surface' }} activeDot={{ r: 6 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-1 text-sm">
        <summary className="min-h-tap cursor-pointer py-2 text-muted">{L.table}</summary>
        <table className="w-full tabular">
          <tbody>{weeks.map((w) => (
            <tr key={w.week} className="border-t border-line"><td className="py-1">{L.weekOf(dm(w.week))}</td>
              <td className="text-right">{kg(w.kg)} {L.kg}</td><td className={`text-right ${w.tooFast ? 'font-semibold text-warn' : ''}`}>{w.change !== undefined ? signed(w.change) : '—'}</td></tr>
          ))}</tbody>
        </table>
      </details>
    </figure>
  );
}

function AddWeight() {
  const [date, setDate] = useState(todayISO());
  const [value, setValue] = useState('');
  const save = async () => {
    const n = Number(value.replace(',', '.'));
    if (n > 0) { const v = Math.round(n * 10) / 10; await saved(db.weights.put({ date, kg: v }), t.toast.weight(kg(v))); setValue(''); }
  };
  return (
    <form className="mt-4 grid grid-cols-2 items-end gap-3 border-t border-line pt-4 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className="block"><span className="text-sm text-muted">{L.date}</span>
        <input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} className={field} /></label>
      <label className="block"><span className="text-sm text-muted">{L.weight}, {L.kg}</span>
        <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className={field} /></label>
      <button type="submit" className="protocol-action col-span-2 sm:col-span-1" aria-label={L.addWeight}><Plus size={18} /></button>
    </form>
  );
}
