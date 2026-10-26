// «Уже сьогодні» (SPEC.md §14.1, D53): two or three main numbers chosen by the person (R5: water, medicines, carbs),
// each with its target or limit from the plan, units and progress; the rest behind «Усі показники». A ring is
// something to reach; a bar with «межа» is a limit — «межу не потрібно заповнювати». No overall score of the day.
import { Beef, Check, Droplet, Flame, MessageCircle, Milk, Pill, Wheat } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
import type { DayTotals } from '../domain/nutrition';
import { round } from '../domain/nutrition';
import type { Targets } from '../domain/types';
import type { FoodState } from '../domain/habits';
import { t } from '../i18n/uk';

const L = t.summary;
export type MetricKey = 'water' | 'meds' | 'carbs' | 'protein' | 'calcium' | 'kcal';
const ALL: MetricKey[] = ['water', 'meds', 'carbs', 'protein', 'calcium', 'kcal'];
const DEFAULT: MetricKey[] = ['water', 'meds', 'carbs'];
const MIN_MAIN = 2;
const MAX_MAIN = 3;
const STORE = 'protocol.mainMetrics'; // this device's choice — a view setting, not data

function loadMain(): MetricKey[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? 'null') as unknown;
    if (Array.isArray(v) && v.length >= MIN_MAIN && v.length <= MAX_MAIN
      && v.every((k) => ALL.includes(k as MetricKey)) && new Set(v).size === v.length) return v as MetricKey[];
  } catch { /* private mode */ }
  return DEFAULT;
}

interface Metric { label: string; value: string; target?: string; progress: number; progressTarget?: number; shape: 'ring' | 'limit' | 'min'; over?: boolean; note?: string; Icon: typeof Pill; tone: string }

const litres = (ml: number) => (ml / 1000).toLocaleString('uk-UA', { maximumFractionDigits: 2 });
const percent = (progress: number) => Math.min(100, Math.max(0, Math.round(progress * 100)));

function metric(key: MetricKey, totals: DayTotals, targets: Targets, meds: { done: number; total: number }): Metric | null {
  switch (key) {
    case 'water': return { label: L.water, value: `${litres(totals.waterMl)}${targets.waterMl ? ` / ${litres(targets.waterMl)}` : ''} л`,
      progress: targets.waterMl ? totals.waterMl / targets.waterMl : 0, ...(targets.waterMl ? { progressTarget: targets.waterMl } : {}),
      shape: 'ring', Icon: Droplet, tone: 'water' };
    case 'meds': return meds.total ? { label: L.meds, value: L.ofTotal(meds.done, meds.total), progress: meds.done / meds.total, progressTarget: meds.total,
      shape: 'ring', Icon: Pill, tone: 'accent' } : null;
    case 'protein': return { label: L.protein, value: `${round(totals.protein)}${targets.proteinG ? ` / ${targets.proteinG}` : ''} г`,
      progress: targets.proteinG ? totals.protein / targets.proteinG : 0, ...(targets.proteinG ? { progressTarget: targets.proteinG } : {}),
      shape: 'ring', Icon: Beef, tone: 'accent' };
    case 'calcium': return { label: L.calcium, value: `${round(totals.calciumMg)}${targets.calciumMg ? ` / ${targets.calciumMg}` : ''} мг`,
      progress: targets.calciumMg ? totals.calciumMg / targets.calciumMg : 0, ...(targets.calciumMg ? { progressTarget: targets.calciumMg } : {}),
      shape: 'ring', Icon: Milk, tone: 'accent' };
    case 'kcal': return { label: L.kcal, value: `${round(totals.kcal)}${targets.kcal ? ` / ${targets.kcal}` : ''} ккал`,
      progress: targets.kcal ? totals.kcal / targets.kcal : 0, ...(targets.kcal ? { progressTarget: targets.kcal } : {}),
      shape: 'ring', Icon: Flame, tone: 'accent' };
    case 'carbs': {
      const c = round(totals.carbs), min = targets.carbsG?.min, max = targets.carbsG?.max;
      if (min != null) return { label: L.carbs, value: `${c} г`, target: L.atLeast(min), progress: c / min, shape: 'min', Icon: Wheat, tone: 'accent',
        note: c < min ? L.toGo(min - c) : L.reached };
      if (max != null) return { label: L.carbs, value: `${c} г`, target: L.limit(max), progress: c / max, shape: 'limit', Icon: Wheat, tone: 'accent',
        over: c > max, note: c > max ? L.over(c - max) : L.limitNote };
      return { label: L.carbs, value: `${c} г`, progress: 0, shape: 'limit', Icon: Wheat, tone: 'accent' };
    }
  }
}

export function DaySummary({ totals, targets, meds, streak, food, onComplete }: { totals: DayTotals; targets: Targets; meds: { done: number; total: number }; streak?: string;
  food?: FoodState; onComplete?: (on: boolean) => void }) {
  const [main, setMain] = useState<MetricKey[]>(loadMain);
  const [all, setAll] = useState(false);
  const [setup, setSetup] = useState(false);
  const shown = (keys: MetricKey[]) => keys.map((k) => [k, metric(k, totals, targets, meds)] as const).filter((x): x is [MetricKey, Metric] => x[1] !== null);
  const toggle = (k: MetricKey, on: boolean) => {
    if ((on && main.length >= MAX_MAIN) || (!on && main.length <= MIN_MAIN)) return;
    const next = on ? [...main, k] : main.filter((x) => x !== k);
    setMain(next);
    try { localStorage.setItem(STORE, JSON.stringify(next)); } catch { /* private mode */ }
  };
  const rest = ALL.filter((k) => !main.includes(k));

  return (
    <section aria-labelledby="summary" className="mb-4 rounded-2xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 id="summary" className="text-lg font-semibold">{L.title}</h2>
        <button type="button" onClick={() => setSetup((v) => !v)} aria-expanded={setup} className="min-h-tap px-1 text-sm text-accent">{setup ? L.done : L.setup}</button>
      </div>
      {setup ? (
        <fieldset>
          <legend className="mb-2 text-sm text-muted">{L.setupHint(MAX_MAIN)}</legend>
          {ALL.map((k) => (
            <label key={k} className="flex min-h-tap items-center gap-3">
              <input type="checkbox" checked={main.includes(k)} disabled={
                (main.length >= MAX_MAIN && !main.includes(k)) || (main.length <= MIN_MAIN && main.includes(k))
              } onChange={(e) => toggle(k, e.target.checked)} className="h-5 w-5 accent-[rgb(var(--accent))]" />
              <span>{L[k]}</span>
            </label>
          ))}
        </fieldset>
      ) : (
        <>
          <Metrics list={shown(main)} />
          {all && <div className="mt-3 border-t border-line pt-3"><Metrics list={shown(rest)} /></div>}
          <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className="mt-2 min-h-tap text-sm text-accent">{all ? L.less : L.all}</button>
        </>
      )}
      {food && ( /* R06: the numbers are «за записами»; only the person can say the day's food is all written */
        <div className="mt-2 flex flex-wrap items-center gap-x-2 text-sm" data-food={food}>
          <span className="text-muted">{food === 'none' ? L.foodNone : food === 'partial' ? L.foodPartial : L.foodComplete}</span>
          {onComplete && food !== 'none' && (
            <button type="button" aria-pressed={food === 'complete'} onClick={() => onComplete(food !== 'complete')} className="min-h-tap px-1 text-accent underline">
              {food === 'complete' ? L.undoComplete : L.markComplete}</button>
          )}
        </div>
      )}
      {streak && <p className="mt-1 text-sm text-accent">{streak}</p>}
      <Link to="/assistant" className="mt-1 inline-flex min-h-tap items-center gap-2 text-sm text-accent underline"> {/* D117 */}
        <MessageCircle size={16} aria-hidden />{t.assistant.link}</Link>
    </section>
  );
}

function Metrics({ list }: { list: [MetricKey, Metric][] }) {
  const rings = list.filter(([, m]) => m.shape === 'ring'), bars = list.filter(([, m]) => m.shape !== 'ring');
  return (
    <div className="space-y-4">
      {rings.length > 0 && (
        <ul className="grid grid-cols-2 gap-x-3 gap-y-4">
          {rings.map(([k, m]) => (
            <li key={k} className="flex items-center gap-3">
              <Ring progress={m.progress} tone={m.tone}
                {...(m.progressTarget ? { label: m.label, value: m.progress, valueText: m.value } : {})}>
                <m.Icon size={20} className={m.tone === 'water' ? 'text-water' : 'text-accent'} aria-hidden />
              </Ring>
              <span className="min-w-0" aria-hidden={Boolean(m.progressTarget)}>
                <span className="block text-sm text-muted">{m.label}</span><span className="tabular block font-medium">{m.value}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {bars.map(([k, m]) => (
        <div key={k}>
          <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
            <span><span className="text-muted">{m.label} · </span><span className={`tabular font-medium ${m.over ? 'text-warn' : 'text-ink'}`}>{m.value}</span></span>
            {m.target && <span className="text-muted">{m.target}</span>}
          </p>
          {m.target && (
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-label={m.label}
              aria-valuetext={`${m.value} · ${m.target}`} aria-valuenow={percent(m.progress)} aria-valuemin={0} aria-valuemax={100}>
              <div className={`h-full rounded-full ${m.over ? 'bg-warn' : m.shape === 'limit' ? 'bg-muted' : 'bg-accent'}`}
                style={{ width: `${Math.min(100, Math.max(0, m.progress * 100))}%` }} />
            </div>
          )}
          {m.note && <p className={`mt-1 flex items-center gap-1 text-sm ${m.over ? 'text-warn' : 'text-muted'}`}>
            {m.shape === 'min' && m.progress >= 1 && <Check size={14} className="text-accent" aria-hidden />}{m.note}</p>}
        </div>
      ))}
    </div>
  );
}

const R = 21, C = 2 * Math.PI * R;
function Ring({ progress, tone, label, value, valueText, children }: {
  progress: number; tone: string; label?: string; value?: number; valueText?: string; children: ReactNode;
}) {
  const p = Math.min(1, Math.max(0, progress));
  return (
    <span className="relative flex h-12 w-12 shrink-0 items-center justify-center" aria-hidden={!label}
      {...(label ? {
        role: 'progressbar', 'aria-label': label, 'aria-valuetext': valueText,
        'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent(value ?? 0),
      } : {})}>
      <svg viewBox="0 0 48 48" className="absolute inset-0 -rotate-90">
        <circle cx="24" cy="24" r={R} fill="none" strokeWidth="4" className="stroke-line" />
        {p > 0 && <circle cx="24" cy="24" r={R} fill="none" strokeWidth="4" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - p)}
          className={tone === 'water' ? 'stroke-water' : 'stroke-accent'} />}
      </svg>
      {children}
    </span>
  );
}
