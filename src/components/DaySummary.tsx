import { ProgressTrack, type ProgressTone } from './ProgressTrack';
import { ProgressRing } from './ProgressRing';
// «Уже сьогодні» (SPEC.md §14.1, D53): two or three main numbers chosen by the person (R5: water, medicines, carbs),
// each with its target or limit from the plan, units and progress; the rest behind «Усі показники». A ring is
// something to reach; a bar with «межа» is a limit — «межу не потрібно заповнювати». No overall score of the day.
import { Beef, Check, Droplet, Flame, MessageCircle, Milk, Pill, Wheat } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useState } from 'react';
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

interface Metric { label: string; value: string; target?: string; progress: number; progressTarget?: number; shape: 'ring' | 'limit' | 'min'; over?: boolean; note?: string; Icon: typeof Pill; tone: ProgressTone }

const litres = (ml: number) => (ml / 1000).toLocaleString('uk-UA', { maximumFractionDigits: 2 });

function metric(key: MetricKey, totals: DayTotals, targets: Targets, meds: { done: number; total: number }): Metric | null {
  switch (key) {
    case 'water': return { label: L.water, value: `${litres(totals.waterMl)}${targets.waterMl ? ` / ${litres(targets.waterMl)}` : ''} л`,
      progress: targets.waterMl ? totals.waterMl / targets.waterMl : 0, ...(targets.waterMl ? { progressTarget: targets.waterMl } : {}),
      shape: 'ring', Icon: Droplet, tone: 'water' };
    case 'meds': return meds.total ? { label: L.meds, value: L.ofTotal(meds.done, meds.total), progress: meds.done / meds.total, progressTarget: meds.total,
      shape: 'ring', Icon: Pill, tone: 'meds' } : null;
    case 'protein': return { label: L.protein, value: `${round(totals.protein)}${targets.proteinG ? ` / ${targets.proteinG}` : ''} г`,
      progress: targets.proteinG ? totals.protein / targets.proteinG : 0, ...(targets.proteinG ? { progressTarget: targets.proteinG } : {}),
      shape: 'ring', Icon: Beef, tone: 'protein' };
    case 'calcium': return { label: L.calcium, value: `${round(totals.calciumMg)}${targets.calciumMg ? ` / ${targets.calciumMg}` : ''} мг`,
      progress: targets.calciumMg ? totals.calciumMg / targets.calciumMg : 0, ...(targets.calciumMg ? { progressTarget: targets.calciumMg } : {}),
      shape: 'ring', Icon: Milk, tone: 'calcium' };
    case 'kcal': return { label: L.kcal, value: `${round(totals.kcal)}${targets.kcal ? ` / ${targets.kcal}` : ''} ккал`,
      progress: targets.kcal ? totals.kcal / targets.kcal : 0, ...(targets.kcal ? { progressTarget: targets.kcal } : {}),
      shape: 'ring', Icon: Flame, tone: 'energy' };
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

export function DaySummary({ totals, targets, meds, streak, food, onComplete, allowed, title = L.title }: { totals: DayTotals; targets: Targets; meds: { done: number; total: number }; streak?: string; title?: string;
  food?: FoodState; onComplete?: (on: boolean) => void; allowed?: readonly MetricKey[] }) {
  const [main, setMain] = useState<MetricKey[]>(loadMain);
  const [all, setAll] = useState(false);
  const [setup, setSetup] = useState(false);
  const visible = ALL.filter((key) => !allowed || allowed.includes(key));
  const selected = main.filter((key) => visible.includes(key));
  const minVisible = Math.min(MIN_MAIN, visible.length);
  const maxVisible = Math.min(MAX_MAIN, visible.length);
  const effectiveMain = selected.length ? selected : visible.slice(0, maxVisible);
  const shown = (keys: MetricKey[]) => keys.filter((k) => visible.includes(k)).map((k) => [k, metric(k, totals, targets, meds)] as const).filter((x): x is [MetricKey, Metric] => x[1] !== null);
  const toggle = (k: MetricKey, on: boolean) => {
    if ((on && effectiveMain.length >= maxVisible) || (!on && effectiveMain.length <= minVisible)) return;
    const nextVisible = on ? [...effectiveMain, k] : effectiveMain.filter((x) => x !== k);
    const hidden = main.filter((x) => !visible.includes(x)).slice(0, MAX_MAIN - nextVisible.length);
    const next = [...hidden, ...nextVisible];
    setMain(next);
    try { localStorage.setItem(STORE, JSON.stringify(next)); } catch { /* private mode */ }
  };
  const rest = visible.filter((k) => !effectiveMain.includes(k));
  if (!visible.length) return null;

  return (
    <section aria-labelledby="summary" className="protocol-card mb-4 p-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 id="summary" className="text-lg font-semibold">{title}</h2>
        <button type="button" onClick={() => setSetup((v) => !v)} aria-expanded={setup} className="min-h-tap px-1 text-sm text-accent">{setup ? L.done : L.setup}</button>
      </div>
      {setup ? (
        <fieldset>
          <legend className="mb-2 text-sm text-muted">{L.setupHint(minVisible, maxVisible)}</legend>
          {visible.map((k) => (
            <label key={k} className="protocol-toggle-row min-h-tap">
              <input type="checkbox" checked={effectiveMain.includes(k)} disabled={
                (effectiveMain.length >= maxVisible && !effectiveMain.includes(k)) || (effectiveMain.length <= minVisible && effectiveMain.includes(k))
              } onChange={(e) => toggle(k, e.target.checked)} className="protocol-switch" />
              <span>{L[k]}</span>
            </label>
          ))}
        </fieldset>
      ) : (
        <>
          <Metrics list={shown(effectiveMain)} />
          {all && <div className="mt-3 border-t border-line pt-3"><Metrics list={shown(rest)} /></div>}
          <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className="mt-2 min-h-tap text-sm text-accent">{all ? L.less : L.all}</button>
        </>
      )}
      {food && visible.some((k) => k !== 'water' && k !== 'meds') && ( /* R06: only the person can say all food is written */
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
        <ul className="protocol-metric-rings" data-count={rings.length}>
          {rings.map(([k, m]) => (
            <li key={k} className={`protocol-progress-${m.tone} flex min-w-0 flex-col items-center gap-2 text-center`}>
              <span className="flex w-full min-w-0 items-center gap-2 text-left text-sm font-medium">
                <m.Icon size={18} className="protocol-ring-icon shrink-0" aria-hidden />
                <span className="truncate text-muted">{m.label}</span>
              </span>
              <ProgressRing ratio={m.progressTarget ? m.progress : undefined} tone={m.tone} label={m.label} valueText={m.value}>
                <span className="tabular text-lg font-bold">{m.progressTarget ? `${Math.round(m.progress * 100)}%` : '—'}</span>
              </ProgressRing>
              <span className="protocol-ring-value tabular">{m.value}</span>
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
            <div className="mt-2"><ProgressTrack ratio={m.progress} label={m.label} valueText={[m.value, m.target, m.note].filter(Boolean).join(' · ')}
              tone={m.over ? 'warn' : m.shape === 'limit' ? 'carbs' : 'protein'} /></div>
          )}
          {m.note && <p className={`mt-1 flex items-center gap-1 text-sm ${m.over ? 'text-warn' : 'text-muted'}`}>
            {m.shape === 'min' && m.progress >= 1 && <Check size={14} className="text-accent" aria-hidden />}{m.note}</p>}
        </div>
      ))}
    </div>
  );
}
