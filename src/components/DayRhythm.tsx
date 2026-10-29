import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '../data/db';
import { pendingStatus, rhythmPresentation, type PendingStatus } from '../domain/rhythmPresentation';
import { localSnoozed, SNOOZED } from '../sync/push';
// «Ритм дня» (SPEC.md §14.1, D53, D142): the day as a time line — done is a filled dot with «Записано», ahead is an open
// circle, skipped is quiet. A whole row is the button (the row's sheet, D46); a dose of the plan asks when (D52).
import { Dumbbell, Pill, Plus, Undo2 } from 'lucide-react';
import type { CheckItem } from '../domain/checklist';
import { amountText } from '../domain/foodSearch';
import { mealNutrients, round } from '../domain/nutrition';
import type { Rhythm, RhythmNode } from '../domain/rhythm';
import type { DayEntry, Food } from '../domain/types';
import { t } from '../i18n/uk';

const L = t.day;

export function DayRhythm({ date, rhythm, foods, onEntry, onDose, onAnytime, onAdd, onYesterday, title = L.rhythm, addLabel = L.addOther }: {
  date: string; rhythm: Rhythm; foods?: Map<string, Food>; title?: string;
  onEntry: (e: DayEntry) => void; onDose: (i: CheckItem) => void; onAnytime: (i: CheckItem) => void; onAdd: () => void; onYesterday?: () => void; addLabel?: string;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => setNow(new Date());
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    window.addEventListener(SNOOZED, refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener(SNOOZED, refresh); };
  }, []);
  const synced = useLiveQuery(async () => (await db.meta.get('sync'))?.snoozed ?? {}, [], {});
  const snoozed = { ...localSnoozed, ...synced };
  const phases = rhythmPresentation(rhythm.nodes, date, now);
  const pending = (n: RhythmNode) => pendingStatus(n, date, now, snoozed);
  const empty = rhythm.nodes.length === 0 && rhythm.anytime.length === 0;
  return (
    <section aria-labelledby="rhythm" className="protocol-card mb-4 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="rhythm" className="text-xl font-semibold">{title}</h2>
        {onYesterday && <button type="button" onClick={onYesterday} className="flex min-h-tap shrink-0 items-center gap-1 rounded-xl px-2 text-sm font-medium text-accent">
          <Undo2 size={16} aria-hidden />{L.likeYesterday}
        </button>}
      </div>
      {rhythm.anytime.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">{L.anytime}</span>
          {rhythm.anytime.map((i) => (
            <button key={i.key} type="button" onClick={() => onAnytime(i)}
              className="flex min-h-tap items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-sm font-medium">
              {i.kind === 'workout' ? <Dumbbell size={16} className="text-accent" aria-hidden /> : <Pill size={16} className="text-accent" aria-hidden />}{i.title}</button>
          ))}
        </div>
      )}
      {rhythm.nodes.length === 0
        ? empty && <p className="py-4 text-muted">{L.empty}</p>
        : <ol className="relative space-y-1">{rhythm.nodes.map((n, k) => <Node key={k} phase={phases[k]!} pending={pending(n)} node={n} last={k === rhythm.nodes.length - 1} foods={foods} onEntry={onEntry} onDose={onDose} />)}</ol>}
      {!empty && <button type="button" onClick={onAdd} className="protocol-action-secondary mt-3 w-full"><Plus size={18} aria-hidden />{addLabel}</button>}
    </section>
  );
}

/** D142: the word for what waits — the dose line keeps «за планом» while nothing is said about it. */
const pendingWord = (p: PendingStatus, planned: string) => p.state === 'deferred' ? L.deferredUntil(p.until) : p.state === 'unmarked' ? L.unmarked : planned;

function Node({ node, phase, pending, last, foods, onEntry, onDose }: {
  phase: 'past' | 'current' | 'future' | 'untimed'; pending: PendingStatus; node: RhythmNode; last: boolean; foods?: Map<string, Food>; onEntry: (e: DayEntry) => void; onDose: (i: CheckItem) => void;
}) {
  const line = !last && <span className="absolute left-[4.5rem] top-7 -bottom-1 w-px bg-line" aria-hidden />;
  if (node.kind === 'deadline') return (
    <li className="relative grid min-h-tap grid-cols-[3.5rem_1.5rem_1fr] items-center gap-x-1 text-sm text-muted">
      <span className="tabular">{node.at}</span><span className="mx-auto h-px w-3 bg-muted" aria-hidden /><span>{L.deadline(node.at)}</span>{line}
    </li>
  );
  if (node.kind === 'dose') {
    const i = node.item;
    const note = i.detail?.split(' · ').filter((x) => x !== i.time).join(' · ');
    return (
      <li className="protocol-rhythm-node relative" data-phase={phase} aria-current={phase === 'current' ? 'step' : undefined}>
        <button type="button" onClick={() => onDose(i)} aria-label={`${i.title}, ${pendingWord(pending, t.status.planned)}`}
          className="grid min-h-tap w-full grid-cols-[3.5rem_1.5rem_1fr] items-start gap-x-2 rounded-xl px-2 py-3 text-left transition-colors hover:bg-accent/5 focus-visible:outline-offset-0">
          <span className="tabular text-muted">{node.at}</span><Dot state={pending.state === 'unmarked' ? 'unmarked' : 'ahead'} />
          <span className="min-w-0"><span className="protocol-rhythm-phase">{phase === 'current' ? L.nearest : phase === 'past' ? L.elapsed : null}</span><span className="block font-medium">{i.title}</span><span className="block text-sm text-muted">{[note, pendingWord(pending, L.byPlan)].filter(Boolean).join(' · ')}</span></span>
        </button>{line}
      </li>
    );
  }
  const e = node.entry;
  const detail = e.kind === 'meal' ? e.items?.map((x) => `${x.name} ${amountText(x)}`).join(', ') : undefined;
  const carbs = e.kind === 'meal' && e.items?.length && foods ? round(mealNutrients(e.items, foods).carbs) : null;
  const sym = e.kind === 'symptom'; // D56
  const state = sym ? 'symptom' : e.status === 'done' ? 'done' : e.status === 'skipped' ? 'skipped' : pending.state === 'unmarked' ? 'unmarked' : 'ahead';
  const word = sym ? [t.symptom.word, e.severity ? t.symptom.level(e.severity) : ''].filter(Boolean).join(' · ')
    : e.status === 'done' ? L.recorded : e.status === 'skipped' ? t.status.skipped : pendingWord(pending, t.status.planned);
  return (
    <li className="protocol-rhythm-node relative" data-phase={phase} aria-current={phase === 'current' ? 'step' : undefined}>
      <button type="button" onClick={() => onEntry(e)} aria-label={`${e.title}, ${sym ? t.symptom.word : e.status === 'planned' ? pendingWord(pending, t.status.planned) : t.status[e.status]}${e.timeUnknown ? `, ${L.timeUnknown}` : ''}`}
        className={`grid min-h-tap w-full grid-cols-[3.5rem_1.5rem_1fr_auto] items-start gap-x-2 rounded-xl px-2 py-3 text-left transition-colors hover:bg-accent/5 focus-visible:outline-offset-0 ${state === 'skipped' ? 'opacity-60' : ''}`}>
        <span className="tabular text-muted" title={e.timeUnknown ? L.timeUnknown : undefined}>{e.timeUnknown ? '—' : node.at}</span><Dot state={state} />
        <span className="min-w-0">
          {phase === 'current' && <span className="protocol-rhythm-phase">{L.nearest}</span>}
          <span className={`block font-medium ${state === 'skipped' ? 'line-through' : ''}`}>{e.title}</span>
          {detail && <span className="block truncate text-sm text-muted">{detail}</span>}
          <span className={`block text-sm ${state === 'done' ? 'text-accent' : state === 'symptom' ? 'text-warn' : 'text-muted'}`}>{word}</span>
        </span>
        <span className="tabular pl-2 text-right text-sm text-muted">{carbs !== null ? L.carbsShort(carbs) : ''}</span>
      </button>{line}
    </li>
  );
}

function Dot({ state }: { state: 'done' | 'ahead' | 'unmarked' | 'skipped' | 'symptom' }) {
  const look = state === 'done' ? 'h-3 w-3 bg-accent' : state === 'symptom' ? 'h-3 w-3 bg-warn' : state === 'ahead' ? 'h-3 w-3 border-2 border-muted bg-bg'
    : state === 'unmarked' ? 'h-3 w-3 border-2 border-dashed border-muted bg-bg' : 'h-2 w-2 bg-line'; // D142: unknown, not missed
  return <span className="relative z-10 flex h-6 items-center justify-center" aria-hidden><span className={`rounded-full ${look}`} /></span>;
}
