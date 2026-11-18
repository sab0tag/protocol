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
import { dosesNow, glasses, GLASS_ML, medsState, MOOD_WORDS, openDoses } from '../domain/quickMarks';
import type { CheckItem } from '../domain/checklist';
import type { DayEntry, Wellbeing } from '../domain/types';
import { t } from '../i18n/uk';
import { markMeds, markMeal } from './MarkTime';
import { Sheet } from './Sheet';
import { saved } from './Toast';
import { format } from 'date-fns';

const L = t.marks;

interface Tile { key: string; label: string; state: string; Icon: LucideIcon; tap: () => void; history: string }

export function QuickMarks({ date, isToday, light, items, water, entries, wellbeing, workoutDone, onWorkout, onUnwell, request, onRequestDone }: {
  date: string; isToday: boolean; light: boolean; items: readonly CheckItem[]; water: { ml: number; target?: number };
  entries: readonly DayEntry[]; wellbeing: Wellbeing | undefined; workoutDone: boolean; onWorkout: () => void; onUnwell: () => void;
  /** a shortcut's action (`#/do/meds`, `#/do/mood`): done once, as if the tile was tapped */
  request?: 'meds' | 'mood' | null; onRequestDone?: () => void;
}) {
  const { can } = useFeatures();
  const navigate = useNavigate();
  // the doses the list opened with stay in it, ticked ones too — a tick never makes a row jump away
  const [medsSheet, setMedsSheet] = useState<{ mode: 'now' | 'day'; keys: string[] } | null>(null);
  const [moodSheet, setMoodSheet] = useState(false);
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
  const water$ = glasses(water.ml, water.target);
  const addWater = () => {
    const e: DayEntry = { id: newId(), at: atLocal(date, hm()), kind: 'water', status: 'done', title: t.addKinds.water, waterMl: GLASS_ML };
    void saved(db.entries.add(e), L.waterAdded(GLASS_ML), () => db.entries.delete(e.id));
  };
  const plannedWorkout = entries.find((e) => e.kind === 'workout' && e.status === 'planned');
  const tapWorkout = () => (plannedWorkout ? void markMeal(plannedWorkout, date, 'done', { time: hm() }) : onWorkout());

  const tiles: Tile[] = [
    ...(can('meds.log') && meds.total > 0 ? [{ key: 'meds', label: L.meds, Icon: Pill, history: '/plan/prescriptions', tap: tapMeds,
      state: L.of(meds.done, meds.total) }] : []),
    ...(can('water.log') ? [{ key: 'water', label: L.water, Icon: Droplet, history: '/week', tap: addWater,
      state: water$.target ? L.of(water$.done, water$.target) : water$.done ? L.glasses(water$.done) : notYet }] : []),
    ...(can('wellbeing.log') ? [{ key: 'mood', label: L.mood, Icon: HeartPulse, history: '/wellbeing/journal', tap: () => setMoodSheet(true),
      state: wellbeing?.mood ? MOOD_WORDS[wellbeing.mood - 1]! : notYet }] : []),
    ...(can('workout.log') ? [{ key: 'workout', label: L.workout, Icon: Dumbbell, history: '/workout', tap: tapWorkout,
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
        {tiles.map((tile) => <MarkTile key={tile.key} tile={tile} onHistory={() => navigate(tile.history)} />)}
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
      aria-label={`${tile.label}: ${tile.state || L.notYet}`} aria-description={L.hold}
      className="flex min-h-[3.75rem] min-w-0 flex-col items-center justify-center gap-0.5 rounded-2xl border border-line bg-surface px-0.5 py-2 text-center">
      <Icon size={20} className="text-accent" aria-hidden />
      <span className="max-w-full overflow-hidden whitespace-nowrap text-[13px] font-semibold leading-tight tracking-[-0.035em]">{tile.label}</span>
      <span className="tabular max-w-full truncate text-xs text-muted">{tile.state}</span>
    </button>
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
