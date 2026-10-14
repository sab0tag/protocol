import { format, parseISO } from 'date-fns';
import { LabsScan } from '../components/LabsScan';
import { Loading } from '../components/Recovery';
import { saved } from '../components/Toast';
import { AlertTriangle, FileText, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { db } from '../data/db';
import { useAllEntries, useAllWellbeing, useFoods, useLabs, usePlan, useWeights, useWorkouts } from '../data/queries';
import { todayISO } from '../domain/dates';
import { labRows, pace, patterns, tooFastTwoWeeks, weeklyWeights, weightSummary, type WeekWeight } from '../domain/progress';
import { habits, weekSummary, type Habit } from '../domain/habits';
import { t } from '../i18n/uk';

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
  const labs = useLabs();
  const entries = useAllEntries();
  const wellbeing = useAllWellbeing();
  const workouts = useWorkouts();
  const foods = useFoods();
  if (!weights || !labs || !entries || !wellbeing || !workouts || !foods) return <Loading />;

  const max = plan?.targets.maxWeightLossKgPerWeek;
  const weeks = weeklyWeights(weights, max);
  const sum = weightSummary(weights);
  const found = patterns({ entries, wellbeing, workouts, foods, ...(plan ? { plan } : {}) });

  return (
    <section className="space-y-4 pt-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{L.title}</h1>
        <Link to="/report" className="flex min-h-tap items-center gap-2 rounded-xl border border-accent px-3 font-medium text-accent">
          <FileText size={18} aria-hidden />{L.report}</Link>
      </div>

      <WeekCard summary={weekSummary({ plan, entries, workouts, foods, today: todayISO() })} />
      <HabitsCard list={habits({ plan, entries, workouts, foods, today: todayISO() })} />

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

      <Labs rows={labRows(labs)} />

      <section className="rounded-2xl border border-line bg-surface p-3">
        <h2 className="font-semibold">{L.patterns}</h2>
        <p className="mb-2 text-sm text-muted">{L.patternsHint}</p>
        {found.length ? <ul className="list-disc space-y-1 pl-5">{found.map((p) => <li key={p.text}>{p.text}</li>)}</ul>
          : <p className="text-muted">{L.noPatterns}</p>}
      </section>
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

function Labs({ rows }: { rows: ReturnType<typeof labRows> }) {
  const [open, setOpen] = useState(false);
  const [lab, setLab] = useState({ date: todayISO(), name: '', value: '', unit: '', target: '' });
  const save = async () => {
    const value = Number(lab.value.replace(',', '.'));
    if (!lab.name.trim() || Number.isNaN(value)) return;
    await saved(db.labs.put({ date: lab.date, name: lab.name.trim(), value, unit: lab.unit.trim(), ...(lab.target.trim() ? { target: lab.target.trim() } : {}) }), t.toast.lab(lab.name.trim()));
    setLab({ ...lab, value: '', target: '' }); setOpen(false);
  };
  return (
    <section className="rounded-2xl border border-line bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">{L.labs}</h2>
        <button type="button" onClick={() => setOpen(!open)} className="flex min-h-tap items-center gap-1 px-2 text-accent"><Plus size={18} />{L.addLab}</button>
      </div>
      <LabsScan known={rows} />
      {open && (
        <form className="mb-3 grid grid-cols-2 gap-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label className="col-span-2 block"><span className="text-sm text-muted">{L.labName}</span>
            <input required value={lab.name} onChange={(e) => setLab({ ...lab, name: e.target.value })} list="lab-names" className={field} /></label>
          <datalist id="lab-names">{rows.map((r) => <option key={r.name} value={r.name} />)}</datalist>
          <label className="block"><span className="text-sm text-muted">{L.value}</span>
            <input required inputMode="decimal" value={lab.value} onChange={(e) => setLab({ ...lab, value: e.target.value })} className={field} /></label>
          <label className="block"><span className="text-sm text-muted">{L.unit}</span>
            <input value={lab.unit} onChange={(e) => setLab({ ...lab, unit: e.target.value })} className={field} /></label>
          <label className="block"><span className="text-sm text-muted">{L.date}</span>
            <input type="date" value={lab.date} onChange={(e) => setLab({ ...lab, date: e.target.value })} className={field} /></label>
          <label className="block"><span className="text-sm text-muted">{L.target}</span>
            <input value={lab.target} onChange={(e) => setLab({ ...lab, target: e.target.value })} placeholder="< 5,6" className={field} /></label>
          <button type="submit" className="col-span-2 min-h-tap rounded-xl bg-accent font-medium text-surface">{t.plan.save}</button>
        </form>
      )}
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular">
            <thead><tr className="text-left text-muted"><th className="py-1 font-normal">{L.labName}</th><th className="text-right font-normal">{L.was}</th>
              <th className="text-right font-normal">{L.nowCol}</th><th className="text-right font-normal">{L.target}</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.name} className="border-t border-line">
                <td className="py-2">{r.name}{r.unit && <span className="text-muted">, {r.unit}</span>}</td>
                <td className="text-right">{kg(r.was.value)}<span className="block text-xs text-muted">{dm(r.was.date)}</span></td>
                <td className="text-right font-medium">{r.now.date === r.was.date ? '—' : kg(r.now.value)}{r.now.date !== r.was.date && <span className="block text-xs font-normal text-muted">{dm(r.now.date)}</span>}</td>
                <td className="text-right">{r.target ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="text-muted">{L.noLabs}</p>}
    </section>
  );
}

/** D38: gentle — a run when there is one, otherwise how many days of the week; nothing is «lost». */
function HabitsCard({ list }: { list: Habit[] }) {
  if (!list.length) return null;
  return (
    <section className="rounded-2xl border border-line bg-surface p-3">
      <h2 className="font-semibold">{L.habits}</h2>
      <p className="mb-2 text-sm text-muted">{L.habitsHint}</p>
      <ul className="space-y-2">
        {list.map((h) => (
          <li key={h.key} className="flex items-baseline justify-between gap-2">
            <span>{L.habit[h.key]}</span>
            <span className="text-right tabular">
              <span className={h.streak >= 2 ? 'font-semibold text-accent' : ''}>{h.streak >= 2 ? `🌱 ${L.streak(h.streak)}` : L.ofWeek(h.last7, h.days7)}</span>
              {h.best >= 3 && h.best > h.streak && <span className="block text-xs text-muted">{L.best(h.best)}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function WeekCard({ summary: s }: { summary: ReturnType<typeof weekSummary> }) {
  const tiles: [string, string][] = [];
  if (s.carbsOk !== undefined) tiles.push([L.weekCarbs, L.ofDays(s.carbsOk, s.days)]);
  if (s.proteinOk !== undefined) tiles.push([L.weekProtein, L.ofDays(s.proteinOk, s.days)]);
  if (s.waterOk !== undefined) tiles.push([L.weekWater, L.ofDays(s.waterOk, s.days)]);
  tiles.push([L.weekWorkouts, String(s.workouts)]);
  if (s.checklistPct !== undefined) tiles.push([L.weekChecklist, `${s.checklistPct} %`]);
  return (
    <section className="rounded-2xl border border-line bg-surface p-3">
      <h2 className="mb-2 font-semibold">{L.week} <span className="text-sm font-normal text-muted">· {dm(s.from)}–{dm(s.to)}</span></h2>
      {s.days === 0 ? <p className="text-muted">{L.weekNoData}</p> : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 tabular sm:grid-cols-3">
          {tiles.map(([label, value]) => <div key={label}><dt className="text-sm text-muted">{label}</dt><dd className="text-lg font-semibold">{value}</dd></div>)}
        </dl>
      )}
    </section>
  );
}
