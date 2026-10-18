// D90: picking a diet of Наказ МОЗ №931 — by its code, its name or an old table number («стіл №5» → ЩД, to confirm).
// Its norms are shown for reference; they fill a target only if the person ticks it, and only an empty one.
import { useState } from 'react';
import { DIET_SOURCE, findDiets, type DietPreset } from '../domain/diets';
import { t } from '../i18n/uk';

const L = t.diet;
const range = (r?: [number, number]) => (r ? `${r[0]}–${r[1]}` : '—');

export function DietNorms({ d }: { d: DietPreset }) {
  return (
    <p className="text-xs text-muted">{L.norms(range(d.norms.kcal), range(d.norms.proteinG), range(d.norms.fatG), range(d.norms.carbsG))}</p>
  );
}

export function DietPicker({ value, onPick, fill, onFill }: {
  value?: string; onPick: (d: DietPreset) => void; fill: boolean; onFill: (v: boolean) => void;
}) {
  const [q, setQ] = useState('');
  const found = findDiets(q);
  const picked = found.find((x) => x.diet.code === value)?.diet ?? findDiets('').find((x) => x.diet.code === value)?.diet;
  return (
    <div className="space-y-2">
      <label className="block"><span className="text-sm text-muted">{L.search}</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L.searchPh}
          className="mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3" /></label>
      <ul className="space-y-1" aria-label={L.list}>
        {found.map(({ diet: d, byTable }) => (
          <li key={d.code}>
            <button type="button" aria-pressed={value === d.code} onClick={() => onPick(d)}
              className={`block min-h-tap w-full rounded-xl border px-3 py-1.5 text-left ${value === d.code ? 'border-accent bg-accent/10' : 'border-line'}`}>
              <span className="block font-medium">{d.code} — {d.name}</span>
              {byTable && <span className="block text-sm text-warn">{L.byTable(byTable, d.code)}</span>}
              <span className="block text-xs text-muted">{d.indications}</span>
            </button>
          </li>
        ))}
        {!found.length && <li className="text-sm text-muted">{L.none}</li>}
      </ul>
      {picked && (
        <div className="space-y-1 rounded-xl border border-line p-2">
          <DietNorms d={picked} />
          {!picked.rules.some((r) => r.checkedBy) && <p className="text-xs text-warn">{L.noRules}</p>}
          {(picked.norms.kcal || picked.norms.proteinG) && (
            <label className="flex min-h-tap items-center gap-3 text-sm">
              <input type="checkbox" checked={fill} onChange={(e) => onFill(e.target.checked)} className="h-5 w-5 accent-[rgb(var(--accent))]" />
              <span>{L.fill}</span></label>
          )}
          <p className="text-xs text-muted">{DIET_SOURCE}</p>
        </div>
      )}
    </div>
  );
}
