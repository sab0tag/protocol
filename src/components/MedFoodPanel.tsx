// D89 (step 4): a medicine of the plan and a food of this meal that bears on it — from the checked table only, in the
// instruction's words, set apart from the plan's flags: information, not a «no».
import { Info } from 'lucide-react';
import type { MedFoodNote } from '../domain/medFood';
import { t } from '../i18n/uk';

const L = t.medFood;

export function MedFoodPanel({ notes }: { notes: MedFoodNote[] }) {
  if (!notes.length) return null;
  return (
    <section aria-label={L.title} className="rounded-2xl border border-line bg-surface p-3">
      <h2 className="mb-1 flex items-center gap-2 font-semibold"><Info size={18} className="text-accent" aria-hidden />{L.title}</h2>
      <ul className="space-y-2 text-sm">
        {notes.map((n, i) => (
          <li key={i}>
            <p>{L.line(n.food, n.medicine, n.quote)}</p>
            <p className="text-muted">{n.pair.kind === 'avoid' ? L.avoid : n.pair.kind === 'separate' ? L.separate(n.pair.hours ?? 0) : L.steady}
              {n.pair.instruction && <> · <a href={n.pair.instruction} target="_blank" rel="noreferrer" className="text-accent underline">{L.source}</a></>}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
