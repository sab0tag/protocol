// D48: the two things most often forgotten — the next medicine and a glass of water — float over «День»,
// one tap each, wherever the list is scrolled. The ring around each shows how much of the day is done.
// D50: the answer comes right beside the button, not at the bottom of the screen: «+500 мл · 1,5 л · Скасувати».
// Taps on water within those seconds add up (and one «Скасувати» takes them all back) instead of hitting the undo.
import { Check, Droplet, Pill } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { t } from '../i18n/uk';
import { toast } from './Toast';

const L = t.dock;
const R = 26, C = 2 * Math.PI * R;
const STROKE = { accent: 'stroke-accent', warn: 'stroke-warn', water: 'stroke-water' } as const;
const SHOW_MS = 5000;

type Undo = () => unknown;
interface Note { kind: 'med' | 'water'; n: number; text: string; undos: Undo[]; id: number }

interface Props {
  med?: { title: string; time?: string; missed: boolean };
  meds: { done: number; total: number };
  water: { ml: number; target?: number };
  onMed: () => Promise<Undo | undefined>;
  onWater: () => Promise<Undo | undefined>;
  /** D82: the quick tiles are on screen — the medicine is marked in «Ритм дня» right below, and its button would cover a
   *  tile; water stays, it has no other button up there */
  hideMed?: boolean;
  hideWater?: boolean;
}

/** D82: whether an element is on screen now (for the dock — hidden while the quick tiles are in view). */
export function useOnScreen<T extends Element>(): [(el: T | null) => void, boolean] {
  const [el, setEl] = useState<T | null>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setOn(!!e?.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [el]);
  return [setEl, on];
}

let seq = 0;

export function QuickDock({ med, meds, water, onMed, onWater, hideMed, hideWater }: Props) {
  const [note, setNote] = useState<Note | null>(null);
  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote((x) => (x?.id === note.id ? null : x)), SHOW_MS);
    return () => clearTimeout(id);
  }, [note]);

  const run = async (kind: Note['kind'], work: () => Promise<Undo | undefined>, text: string) => {
    let undo: Undo | undefined;
    try { undo = await work(); } catch (e) { console.error(e); toast(t.toast.failed, { tone: 'warn' }); return; }
    if (!undo) return;
    const u = undo;
    setNote((x) => (x && x.kind === kind && kind === 'water' ? { ...x, n: x.n + 1, undos: [...x.undos, u], id: ++seq }
      : { kind, n: 1, text, undos: [u], id: ++seq }));
  };
  const undoAll = () => { const x = note; setNote(null); x?.undos.forEach((u) => void u()); };
  const bubble = (kind: Note['kind']) => note?.kind === kind && (
    <div role="status" aria-live="polite"
      className="absolute right-full top-1/2 mr-3 flex -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-2xl bg-ink py-1 pl-3 pr-1 text-sm text-bg shadow-lg motion-safe:animate-[toast-in_160ms_ease-out]">
      <Check size={16} aria-hidden className="shrink-0" />
      <span className="font-medium">{kind === 'water' ? L.waterAdded(note.n * 250, water.ml) : note.text}</span>
      <button type="button" onClick={undoAll} className="min-h-tap px-2 font-semibold underline underline-offset-2">{t.toast.undo}</button>
    </div>
  );

  if (hideWater && (hideMed || !meds.total)) return null;
  return (
    <div role="group" aria-label={L.label}
      className="fixed bottom-[calc(8.75rem+env(safe-area-inset-bottom))] right-4 z-20 flex flex-col gap-3 print:hidden md:bottom-8 md:right-8">
      {meds.total > 0 && !hideMed && (
        <div className="relative">
          {bubble('med')}
          <Round progress={meds.done / meds.total} tone={med?.missed ? 'warn' : 'accent'} done={!med}
            onClick={() => med && void run('med', onMed, t.toast.med(med.title))} label={med ? L.med(med.title, med.time) : L.medsDone}>
            <Pill size={22} className={!med ? '' : med.missed ? 'text-warn' : 'text-accent'} aria-hidden />
            {med?.missed && <span className="absolute right-0.5 top-0.5 h-3 w-3 rounded-full border-2 border-surface bg-warn" aria-hidden />}
            {!med && <span className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-accent bg-surface text-accent" aria-hidden>
              <Check size={12} strokeWidth={3} /></span>}
          </Round>
        </div>
      )}
      {!hideWater && <div className="relative">
        {bubble('water')}
        <Round progress={water.target ? water.ml / water.target : 0} tone="water" onClick={() => void run('water', onWater, '')} label={L.water(water.ml, water.target)}>
          <Droplet size={22} className="text-water" aria-hidden />
        </Round>
      </div>}
    </div>
  );
}

function Round({ progress, tone, done, label, onClick, children }:
  { progress: number; tone: keyof typeof STROKE; done?: boolean; label: string; onClick: () => void; children: ReactNode }) {
  const p = Math.min(1, Math.max(0, progress));
  return (
    <button type="button" onClick={onClick} disabled={done} aria-label={label} title={label}
      className={`relative flex h-14 w-14 items-center justify-center rounded-full border shadow-lg shadow-ink/15 transition-transform active:scale-95
        ${done ? 'border-accent bg-accent text-surface' : 'border-line bg-surface'}`}>
      {!done && (
        <svg viewBox="0 0 56 56" className="pointer-events-none absolute inset-0 -rotate-90" aria-hidden>
          <circle cx="28" cy="28" r={R} fill="none" strokeWidth="3" className="stroke-line" />
          {p > 0 && <circle cx="28" cy="28" r={R} fill="none" strokeWidth="3" strokeLinecap="round" className={`${STROKE[tone]} transition-[stroke-dashoffset] duration-500`}
            strokeDasharray={C} strokeDashoffset={C * (1 - p)} />}
        </svg>
      )}
      {children}
    </button>
  );
}
