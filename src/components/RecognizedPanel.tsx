import { useState, type ReactNode } from 'react';
import { amountText, approxG, needsGrams, type Recognized } from '../domain/foodSearch';
import type { MealItem } from '../domain/types';
import { t } from '../i18n/uk';

/** Lines recognized from a dictated phrase (D30) or a photo (D32), each with a tick; nothing is added until «Додати». */
export function RecognizedPanel({ title, rows: given, note, onAdd, notFound, addLabel }: {
  title: string; addLabel?: (n: number) => string; rows: Recognized[]; note?: string; onAdd: (items: MealItem[], missing: string[]) => void; notFound?: (text: string) => ReactNode;
}) {
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [chosen, setChosen] = useState<Record<number, MealItem>>({}); // D81: another kind picked in one tap
  const rows = given.map((r, k) => (chosen[k] ? { ...r, item: chosen[k], others: [r.item!, ...(r.others ?? [])].filter((o) => o.foodId !== chosen[k]!.foodId) } : r));
  const picked = rows.filter((r, k) => r.item && !skip.has(k)).map((r) => r.item!);
  return (
    <div className="mt-2 rounded-xl border border-accent/40 p-2">
      <p className="mb-1 text-sm font-medium">{title}</p>
      {note && <p className="mb-1 text-sm text-muted">{note}</p>}
      <ul className="space-y-1">
        {rows.map((r, k) => (
          <li key={k}>
            {r.item ? (
              <label data-item={r.item.name} className="flex min-h-tap items-center gap-3">
                <input type="checkbox" checked={!skip.has(k)} className="h-5 w-5 shrink-0"
                  onChange={(e) => setSkip((s) => { const n = new Set(s); if (e.target.checked) n.delete(k); else n.add(k); return n; })} />
                <span className="flex-1">{r.item.name} <span className="text-muted">· {amountText(r.item)}{needsGrams(r.item) ? ` ≈ ${approxG(r.item.grams)} г` : ''}</span>
                  {(r.unsure || r.estimate) && <span className="block text-xs text-warn">{[r.unsure && t.meal.photoUnsure, r.estimate && t.meal.photoEstimate].filter(Boolean).join(' · ')}</span>}
                </span>
              </label>
            ) : <div className="py-2"><p className="text-sm text-muted">«{r.text}» — {t.meal.notFound}</p>{notFound?.(r.text)}</div>}
            {r.item && r.others && r.others.length > 0 && (
              <p className="flex flex-wrap items-center gap-1 pb-1 pl-8 text-sm"><span className="text-muted">{t.meal.orOther}</span>
                {r.others.map((o) => (
                  <button key={o.foodId ?? o.name} type="button" onClick={() => setChosen((c) => ({ ...c, [k]: o }))}
                    className="min-h-[2.25rem] rounded-full border border-line px-2">{o.name}</button>
                ))}</p>
            )}
          </li>
        ))}
      </ul>
      {picked.length > 0 && (
        <button type="button" onClick={() => onAdd(picked, rows.filter((r) => !r.item).map((r) => r.text))}
          className="mt-1 min-h-tap w-full rounded-xl bg-accent px-3 font-medium text-surface">{(addLabel ?? t.meal.addRecognized)(picked.length)}</button>
      )}
    </div>
  );
}
