import { WeightReview } from '../components/WeightReview';
import { weightQuality } from '../domain/weightQuality';
import { SceneHeader } from '../components/SceneHeader';
import { format, parseISO } from 'date-fns';
import { Loading } from '../components/Recovery';
import { AlertTriangle } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { usePlan, useWeights } from '../data/queries';
import { pace, tooFastTwoWeeks, weeklyWeights, weightSummary, type WeekWeight } from '../domain/progress';
import type { WeightLog } from '../domain/types';
import { t } from '../i18n/uk';

const L = t.progress;
const dm = (d: string) => format(parseISO(d), 'dd.MM');
const kg = (n: number) => n.toLocaleString('uk-UA', { maximumFractionDigits: 1 });
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${kg(Math.abs(n))}`;

/** D137: weight on its own route, for a profile with the progress module off. */
export function Weight() {
  return <section className="space-y-4 pt-4"><SceneHeader title={L.weight} /><WeightCard /></section>;
}

/** The weight card of «Прогрес»: accepted measurements, weekly averages against the plan's limit, entry with review (D23).
 *  Used independently of the progress and wellbeing modules. */
export function WeightCard() {
  const plan = usePlan();
  const weights = useWeights();
  if (!weights) return <Loading />;
  const max = plan?.targets.maxWeightLossKgPerWeek;
  const weeks = weeklyWeights(weights, max);
  const sum = weightSummary(weights);
  const quality = weightQuality(weights);
  return (
      <section className="protocol-card rounded-2xl border border-line bg-surface p-3">
        <h2 className="mb-2 font-semibold">{L.weight}</h2>
        {quality.pending.length > 0 && <p className="mb-3 rounded-xl bg-warn-bg p-3 text-sm text-warn">{t.weightQuality.needsReview(quality.pending.length)}</p>}
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
        {quality.accepted.length > 1 && <WeightChart weights={quality.accepted} />}
        {weeks.length > 1 && <details className="mt-3"><summary className="min-h-tap cursor-pointer py-2 text-sm text-muted">{t.weightQuality.weekly}</summary><WeeklyChart weeks={weeks} max={max} /></details>}
        <WeightReview weights={weights} />
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

/** Actual accepted measurements on a continuous time axis; no generated points or quarantined values. */
function WeightChart({ weights }: { weights: WeightLog[] }) {
  const data = weights.map(row => ({ ...row, at: new Date(`${row.date}T12:00:00`).getTime() }));
  const label = (at: number) => format(new Date(at), 'd.MM');
  return <figure aria-label={t.weightQuality.chart}>
    <figcaption className="mb-2 text-sm text-muted">{t.weightQuality.chart}</figcaption>
    <div className="h-44 w-full min-w-0 text-xs">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="rgb(var(--line))" vertical={false} />
          <XAxis dataKey="at" type="number" domain={['dataMin', 'dataMax']} tickFormatter={label} minTickGap={30} stroke="rgb(var(--muted))" />
          <YAxis domain={['auto', 'auto']} width={42} tickFormatter={kg} stroke="rgb(var(--muted))" />
          <Tooltip labelFormatter={at => label(Number(at))} formatter={value => [`${kg(Number(value))} ${L.kg}`, L.weight]} contentStyle={{ background: 'rgb(var(--surface))', borderColor: 'rgb(var(--line))', borderRadius: 12 }} />
          <Line dataKey="kg" type="linear" stroke="rgb(var(--accent))" strokeWidth={2} dot={{ r: 3, fill: 'rgb(var(--accent))' }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  </figure>;
}
