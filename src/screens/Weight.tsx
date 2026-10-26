import { format, parseISO } from 'date-fns';
import { AlertTriangle, Plus } from 'lucide-react';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { db } from '../data/db';
import { usePlan, useWeights } from '../data/queries';
import { todayISO } from '../domain/dates';
import { pace, tooFastTwoWeeks, weeklyWeights, weightSummary, type WeekWeight } from '../domain/progress';
import { t } from '../i18n/uk';
import { Loading } from '../components/Recovery';
import { saved } from '../components/Toast';
const L = t.progress;
const field = 'mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3';
const dm = (d: string) => format(parseISO(d), 'dd.MM');
const kg = (n: number) => n.toLocaleString('uk-UA', { maximumFractionDigits: 1 });
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${kg(Math.abs(n))}`;

export function Weight() {
  return <section className="space-y-4 pt-4"><h1 className="text-2xl font-semibold">{L.weight}</h1><WeightCard /></section>;
}

/** Weight can be used independently of the progress/wellbeing modules. */
export function WeightCard() {
  const plan = usePlan();
  const weights = useWeights();
  if (!weights) return <Loading />;
  const max = plan?.targets.maxWeightLossKgPerWeek;
  const weeks = weeklyWeights(weights, max);
  const sum = weightSummary(weights);
  return (
      <section className="rounded-2xl border border-line bg-surface p-3">
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
  );
}

function WeeklyChart({ weeks, max }: { weeks: WeekWeight[]; max?: number }) {
  const data = weeks.filter((w) => w.change !== undefined).map((w) => ({ ...w, label: dm(w.week) }));
  return (
    <figure>
      <figcaption className="mb-1 text-sm text-muted">{L.chartTitle}{max != null && <> · <span className="text-warn">- - -</span> {L.limit(kg(max))}</>}</figcaption>
      <div role="img" aria-label={L.chartLabel(max)} className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 18, right: 4, bottom: 0, left: 0 }} barCategoryGap="30%">
            <CartesianGrid vertical={false} className="stroke-line" strokeDasharray="0" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ className: 'fill-muted', fontSize: 12 }} />
            <YAxis tickLine={false} axisLine={false} tick={{ className: 'fill-muted', fontSize: 12 }} width={40}
              domain={[(min: number) => Math.min(min, -(max ?? 0)) - 0.2, (m: number) => Math.max(m, 0) + 0.2]} tickFormatter={(v: number) => signed(Math.round(v * 10) / 10)} />
            <ReferenceLine y={0} className="stroke-muted" />
            {max != null && <ReferenceLine y={-max} strokeDasharray="4 4" className="stroke-warn" />}
            <Tooltip cursor={{ className: 'fill-line', opacity: 0.4 }}
              content={({ active, payload }) => {
                const w = active && payload?.[0]?.payload as (WeekWeight & { label: string }) | undefined;
                return w ? <div className="rounded-xl border border-line bg-surface px-3 py-2 text-sm shadow">
                  <p className="font-medium">{L.weekOf(w.label)}</p><p className="tabular">{kg(w.kg)} {L.kg} · {signed(w.change ?? 0)}</p></div> : null;
              }} />
            <Bar dataKey="change" radius={4} isAnimationActive={false}>
              {data.map((w) => <Cell key={w.week} className={w.tooFast ? 'fill-warn' : 'fill-accent'} />)}
              <LabelList dataKey="change" position="bottom" fontSize={12} className="fill-warn"
                formatter={(v: unknown) => { const w = data.find((x) => x.change === v); return w?.tooFast ? signed(Number(v)) : ''; }} />
            </Bar>
          </BarChart>
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
    <form className="mt-3 grid grid-cols-[1fr_1fr_auto] items-end gap-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className="block"><span className="text-sm text-muted">{L.date}</span>
        <input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} className={field} /></label>
      <label className="block"><span className="text-sm text-muted">{L.weight}, {L.kg}</span>
        <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className={field} /></label>
      <button type="submit" className="flex min-h-tap items-center gap-1 rounded-xl bg-accent px-3 font-medium text-surface" aria-label={L.addWeight}><Plus size={18} /></button>
    </form>
  );
}

