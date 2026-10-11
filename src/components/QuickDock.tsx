// D48: the two things most often forgotten — the next medicine and a glass of water — float over «День»,
// one tap each, wherever the list is scrolled. The ring around each shows how much of the day is done.
import { Check, Droplet, Pill } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '../i18n/uk';

const L = t.dock;
const R = 26, C = 2 * Math.PI * R;
const STROKE = { accent: 'stroke-accent', warn: 'stroke-warn', water: 'stroke-water' } as const;

interface Props {
  med?: { title: string; time?: string; overdue: boolean };
  meds: { done: number; total: number };
  water: { ml: number; target?: number };
  onMed: () => void;
  onWater: () => void;
}

export function QuickDock({ med, meds, water, onMed, onWater }: Props) {
  return (
    <div role="group" aria-label={L.label}
      className="fixed bottom-[calc(8.75rem+env(safe-area-inset-bottom))] right-4 z-20 flex flex-col gap-3 print:hidden md:bottom-8 md:right-8">
      {meds.total > 0 && (
        <Round progress={meds.done / meds.total} tone={med?.overdue ? 'warn' : 'accent'} done={!med} onClick={onMed}
          label={med ? L.med(med.title, med.time) : L.medsDone}>
          <Pill size={22} className={!med ? '' : med.overdue ? 'text-warn' : 'text-accent'} aria-hidden />
          {med?.overdue && <span className="absolute right-0.5 top-0.5 h-3 w-3 rounded-full border-2 border-surface bg-warn" aria-hidden />}
          {!med && <span className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-accent bg-surface text-accent" aria-hidden>
            <Check size={12} strokeWidth={3} /></span>}
        </Round>
      )}
      <Round progress={water.target ? water.ml / water.target : 0} tone="water" onClick={onWater} label={L.water(water.ml, water.target)}>
        <Droplet size={22} className="text-water" aria-hidden />
      </Round>
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
