// ТЗ «упрощение» 17.11, step 3 (D164): what a person marks every day — one tap from «Сьогодні». A tile is there only for
// a module that is on (from the doctor's plan or switched on by the person); at most four. A mark is written at once,
// with «Скасувати» for 5 s, into the same records the full screens write. A long press opens the history.
import { Activity, Dumbbell, Droplet, HeartPulse, Pill, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFeatures } from '../app/features';
import { useMarkOrder } from '../data/markOrder';
import { db } from '../data/db';
import { atLocal, newId } from '../domain/dates';
import { dosesNow, GLASS_ML, medsState, MOOD_WORDS, openDoses } from '../domain/quickMarks';
import { litres, waterState, withWater, type DayFluid, type WaterState } from '../domain/fluid';
import { NORMS } from '../domain/norms';
import type { CheckItem } from '../domain/checklist';
import type { DayEntry, Targets, Wellbeing } from '../domain/types';
import { t } from '../i18n/uk';
import { markMeds, markMeal } from './MarkTime';
import { Sheet } from './Sheet';
import { saved } from './Toast';
import { format } from 'date-fns';

const L = t.marks;

interface Tile { key: string; label: string; state: string; full?: string; Icon: LucideIcon; tap: () => void; history: () => void }

export function QuickMarks({ date, isToday, light, items, fluid, targets, entries, wellbeing, workoutDone, rehab, onWorkout, onUnwell, request, onRequestDone }: {
  date: string; isToday: boolean; light: boolean; items: readonly CheckItem[];
  /** D169: what was drunk today (water, drinks, soups) and the plan's norm or limit */
  fluid: DayFluid; targets: Pick<Targets, 'waterMl' | 'waterMaxMl' | 'waterFrom'>;
  entries: readonly DayEntry[]; wellbeing: Wellbeing | undefined; workoutDone: boolean; onWorkout: () => void; onUnwell: () => void;
  /** D179: a rehab complex in the plan — the tile is «ЛФК N з M» and opens the complex */
  rehab?: { done: number; perDay: number };
  /** a shortcut's action (`#/do/meds`, `#/do/mood`): done once, as if the tile was tapped */
  request?: 'meds' | 'mood' | null; onRequestDone?: () => void;
}) {
  const { can } = useFeatures();
  const navigate = useNavigate();
  // the doses the list opened with stay in it, ticked ones too — a tick never makes a row jump away
  const [medsSheet, setMedsSheet] = useState<{ mode: 'now' | 'day'; keys: string[] } | null>(null);
  const [moodSheet, setMoodSheet] = useState(false);
  const [waterSheet, setWaterSheet] = useState(false);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set()); // shown at once, before the record comes back
  const order = useMarkOrder();
  const notYet = light ? '' : L.notYet; // D139: a light day keeps the tiles, without «ще ні»
  const hm = () => (isToday ? format(new Date(), 'HH:mm') : '12:00');

  const meds = medsState(items);
  const tapMeds = () => {
    const now = isToday ? dosesNow(items, new Date()) : [];
    if (now.length === 1) { const d = now[0]!; void markMeds([medMark(d)], date, d.time, 'done', { time: hm() }); }
    else setMedsSheet(now.length > 1 ? { mode: 'now', keys: now.map((d) => d.key) } : { mode: 'day', keys: items.filter((i) => i.kind === 'med').map((d) => d.key) });
  };
  const water = waterState(fluid, targets);
  const addWater = () => {
    const e: DayEntry = { id: newId(), at: atLocal(date, hm()), kind: 'water', status: 'done', title: t.addKinds.water, waterMl: GLASS_ML };
    void saved(db.entries.add(e), waterAdded(GLASS_ML, waterState(withWater(fluid, GLASS_ML), targets)), () => db.entries.delete(e.id));
  };
  const go = (to: string) => () => navigate(to);
  const plannedWorkout = entries.find((e) => e.kind === 'workout' && e.status === 'planned');
  const tapWorkout = () => (plannedWorkout ? void markMeal(plannedWorkout, date, 'done', { time: hm() }) : onWorkout());

  const tiles: Tile[] = [
    ...(can('meds.log') && meds.total > 0 ? [{ key: 'meds', label: L.meds, Icon: Pill, history: go('/plan/prescriptions'), tap: tapMeds,
      state: L.of(meds.done, meds.total) }] : []),
    ...(can('water.log') ? [{ key: 'water', label: water.kind === 'limit' ? W.tileLimit : W.tile, Icon: Droplet, history: () => setWaterSheet(true), tap: addWater,
      ...waterTile(water, notYet) }] : []),
    ...(can('wellbeing.log') ? [{ key: 'mood', label: L.mood, Icon: HeartPulse, history: go('/wellbeing/journal'), tap: () => setMoodSheet(true),
      state: wellbeing?.mood ? MOOD_WORDS[wellbeing.mood - 1]! : notYet }] : []),
    ...(can('workout.log') ? [rehab ? { key: 'workout', label: t.rehab.tile, Icon: Dumbbell, history: go('/workout'), tap: go('/workout'), state: L.of(rehab.done, rehab.perDay) }
      : { key: 'workout', label: L.workout, Icon: Dumbbell, history: go('/workout'), tap: tapWorkout,
      state: workoutDone ? L.done : plannedWorkout ? L.planned : notYet }] : []),
  ].sort((a, b) => order.indexOf(a.key as never) - order.indexOf(b.key as never)).slice(0, 4);
  useEffect(() => {
    if (!request) return;
    if (request === 'meds' && tiles.some((x) => x.key === 'meds')) tapMeds();
    if (request === 'mood' && tiles.some((x) => x.key === 'mood')) setMoodSheet(true);
    onRequestDone?.();
  }, [request]); // eslint-disable-line react-hooks/exhaustive-deps -- once per request; the parent clears it
  if (!tiles.length) return null;

  return (
    <>
      <nav aria-label={L.title} className="-mx-1 mb-3 grid gap-1" style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }} data-testid="quick-marks">
        {tiles.map((tile) => <MarkTile key={tile.key} tile={tile} onHistory={tile.history} />)}
      </nav>
      {medsSheet && <Sheet title={medsSheet.mode === 'now' ? L.medsNow : L.medsDay} onClose={() => setMedsSheet(null)}>
        <ul className="divide-y divide-line">
          {items.filter((i) => medsSheet.keys.includes(i.key)).map((d) => {
            const open = openDoses([d]).length > 0;
            return <li key={d.key}><label className="flex min-h-tap items-center gap-3 py-2">
              <input type="checkbox" checked={d.done || ticked.has(d.key)} disabled={!open || ticked.has(d.key)}
                onChange={() => { setTicked((s) => new Set(s).add(d.key)); void markMeds([medMark(d)], date, d.time, 'done', { time: hm() }); }}
                className="h-6 w-6 shrink-0 accent-[rgb(var(--accent))]" />
              <span className="min-w-0 flex-1"><span className={`block font-medium ${d.done ? 'line-through' : ''}`}>{d.title}</span>
                <span className="block text-sm text-muted">{[d.detail || d.time /* a dose's detail starts with its time */, d.done ? L.doneAt(d.doneAt) : d.skipped ? t.status.skipped : ''].filter(Boolean).join(' · ')}</span></span>
            </label></li>;
          })}
        </ul>
      </Sheet>}
      {waterSheet && <WaterSheet fluid={fluid} targets={targets} state={water} entries={entries} onClose={() => setWaterSheet(false)} />}
      {moodSheet && <MoodSheet date={date} wellbeing={wellbeing} onClose={() => setMoodSheet(false)} onUnwell={() => { setMoodSheet(false); onUnwell(); }} />}
    </>
  );
}

const medMark = (d: CheckItem) => ({ key: d.key, title: d.title, ...(d.prescriptionId ? { prescriptionId: d.prescriptionId } : {}) });

function MarkTile({ tile, onHistory }: { tile: Tile; onHistory: () => void }) {
  const timer = useRef<number | undefined>(undefined);
  const held = useRef(false);
  const start = () => { held.current = false; timer.current = window.setTimeout(() => { held.current = true; onHistory(); }, 550); };
  const stop = () => window.clearTimeout(timer.current);
  const { Icon } = tile;
  return (
    <button type="button" onClick={() => { if (!held.current) tile.tap(); held.current = false; }}
      onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      onContextMenu={(e) => { e.preventDefault(); stop(); onHistory(); }}
      aria-label={`${tile.label}: ${tile.full ?? (tile.state || L.notYet)}`} aria-description={L.hold}
      className="flex min-h-[3.75rem] min-w-0 flex-col items-center justify-center gap-0.5 rounded-2xl border border-line bg-surface px-0.5 py-2 text-center">
      <Icon size={20} className="text-accent" aria-hidden />
      <span className="max-w-full overflow-hidden whitespace-nowrap text-[13px] font-semibold leading-tight tracking-[-0.035em]">{tile.label}</span>
      <span className="tabular max-w-full truncate text-xs text-muted">{tile.state}</span>
    </button>
  );
}

const W = t.water;

/** D169: the tile says it short — «1,0 з 2,5 л», «2,5 л ✓», «+0,5 л понад»; the full words go to the screen reader and the sheet. */
function waterTile(s: WaterState, notYet: string): { state: string; full: string } {
  const total = litres(s.totalMl);
  if (s.kind === 'limit') return s.overMl > 0 ? { state: W.over(litres(s.overMl)), full: `${W.limitLine(total, litres(s.maxMl))}, ${W.overLimit(s.overMl)}` }
    : { state: W.of(total, litres(s.maxMl)), full: `${W.limitLine(total, litres(s.maxMl))}. ${W.left(s.leftMl)}` };
  if (s.kind === 'norm') return !s.met ? { state: W.of(total, litres(s.normMl)), full: W.of(total, litres(s.normMl)) }
    : s.overMl >= 50 ? { state: W.over(litres(s.overMl)), full: `${W.normMet(litres(s.normMl))}, ${W.normOver(litres(s.overMl))}` }
      : { state: W.met(litres(s.normMl)), full: W.normMet(litres(s.normMl)) };
  return s.totalMl ? { state: W.today(total), full: W.todayLong(total) } : { state: notYet, full: notYet || W.none };
}

/** «+250 мл», and under a limit how much is left (or how far over), with a norm when it is reached. */
export function waterAdded(ml: number, after: WaterState, said = L.waterAdded(ml)): string {
  const more = after.kind === 'limit' ? (after.overMl > 0 ? W.overLimit(after.overMl) : W.left(after.leftMl).toLowerCase())
    : after.kind === 'norm' && after.met ? W.normMet(litres(after.normMl)) : '';
  return [said, more].filter(Boolean).join(' · ');
}

/** D169: the day's water — its records, what counts toward the limit, and where the doctor gave nothing, the EFSA reference
 *  (never under a limit). A long press on the tile opens it. */
function WaterSheet({ fluid, targets, state, entries, onClose }: { fluid: DayFluid; targets: Pick<Targets, 'waterMl' | 'waterMaxMl' | 'waterFrom'>;
  state: WaterState; entries: readonly DayEntry[]; onClose: () => void }) {
  const navigate = useNavigate();
  const records = entries.filter((e) => e.kind === 'water' && e.status === 'done').sort((a, b) => a.at.localeCompare(b.at));
  const parts = W.parts(litres(fluid.waterMl), fluid.drinks);
  const setGuide = (ml: number) => void saved(db.plan.get('main').then((p) => p && db.plan.update('main', { targets: { ...p.targets, waterMl: ml, waterFrom: 'efsa' } })),
    W.guideSaved(litres(ml)));
  const remove = (e: DayEntry) => void saved(db.entries.delete(e.id), W.removed, () => db.entries.put(e));
  return (
    <Sheet title={state.kind === 'limit' ? W.titleLimit : W.title} onClose={onClose}>
      <div className="space-y-3">
        {state.kind === 'limit' ? <>
          <p className="text-lg font-semibold" data-testid="water-summary">{W.fluid(litres(state.totalMl), litres(state.maxMl), parts)}</p>
          <p className={state.overMl ? 'font-semibold' : 'text-muted'}>{state.overMl ? `${W.overLimit(state.overMl).replace(/^./u, (c) => c.toUpperCase())}. ${W.overLimitReport}` : W.left(state.leftMl)}</p>
        </> : <>
          <p className="text-lg font-semibold" data-testid="water-summary">{state.kind === 'norm'
            ? state.met ? `${W.normMet(litres(state.normMl))}${state.overMl >= 50 ? `, ${W.normOver(litres(state.overMl))}` : ''}` : W.of(litres(state.totalMl), litres(state.normMl))
            : W.todayLong(litres(state.totalMl))}</p>
          {fluid.drinks.length > 0 && <p className="text-sm text-muted">{W.drinksLine(fluid.drinks, litres(fluid.drinksMl))}</p>}
          {state.kind === 'norm' && targets.waterFrom === 'efsa' && <p className="text-sm text-muted">{W.guideIsSet}{NORMS.reviewedBy ? '' : ` ${W.draft}`}</p>}
          {state.kind === 'free' && <div className="space-y-2 rounded-2xl border border-line p-3" data-testid="water-guide">
            <p className="text-sm">{W.guide}</p>
            <div className="flex flex-wrap gap-2">
              {([[NORMS.water.drinksMl.female, W.guideWomen], [NORMS.water.drinksMl.male, W.guideMen]] as const).map(([ml, who]) => (
                <button key={ml} type="button" onClick={() => setGuide(ml)} className="min-h-tap rounded-full border-2 border-line px-4 font-semibold">{W.guideSet(litres(ml), who)}</button>))}
            </div>
            <p className="text-xs text-muted">{W.guideNote}{NORMS.reviewedBy ? '' : ` ${W.draft}`}</p>
          </div>}
        </>}
        <section aria-label={W.records}>
          {records.length ? <ul className="divide-y divide-line">{records.map((e) => { const hm = e.at.slice(11, 16); return (
            <li key={e.id} className="flex min-h-tap items-center justify-between gap-2 py-1">
              <span className="tabular">{hm} · {e.waterMl ?? 0} {t.units.ml}</span>
              <button type="button" onClick={() => remove(e)} aria-label={W.remove(e.waterMl ?? 0, hm)} className="min-h-tap px-2 text-sm text-muted underline">{W.removeShort}</button>
            </li>); })}</ul> : <p className="text-sm text-muted">{W.none}</p>}
        </section>
        <button type="button" onClick={() => { onClose(); navigate('/week'); }} className="min-h-tap text-accent underline">{W.week}</button>
      </div>
    </Sheet>
  );
}

/** The scale in words; a choice is the record. «Дуже погано» points to «Мені погано» — the same flow — but never opens 103 itself. */
function MoodSheet({ date, wellbeing, onClose, onUnwell }: { date: string; wellbeing: Wellbeing | undefined; onClose: () => void; onUnwell: () => void }) {
  const [picked, setPicked] = useState<number | undefined>(wellbeing?.mood);
  const choose = (level: 1 | 2 | 3 | 4 | 5) => {
    setPicked(level);
    const was = wellbeing;
    const next: Wellbeing = { ...(was ?? { date, symptoms: [] }), date, mood: level };
    void saved(db.wellbeing.put(next), L.moodSaved(MOOD_WORDS[level - 1]!), () => (was ? db.wellbeing.put(was) : db.wellbeing.delete(date)));
    if (level !== 1) onClose();
  };
  return (
    <Sheet title={L.moodTitle} onClose={onClose}>
      <div role="group" aria-label={L.moodTitle} className="grid gap-2">
        {MOOD_WORDS.map((word, i) => <button key={word} type="button" aria-pressed={picked === i + 1} onClick={() => choose((i + 1) as 1 | 2 | 3 | 4 | 5)}
          className="min-h-tap rounded-full border-2 border-line bg-surface px-4 font-semibold aria-[pressed=true]:border-accent aria-[pressed=true]:text-accent">{word}</button>)}
      </div>
      {picked === 1 && <button type="button" onClick={onUnwell} className="mt-3 flex min-h-tap w-full items-center justify-center gap-2 rounded-full border-2 border-line px-4 font-semibold">
        <Activity size={18} aria-hidden />{L.unwellLink}</button>}
    </Sheet>
  );
}
