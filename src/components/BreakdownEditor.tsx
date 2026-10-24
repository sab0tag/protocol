// D110, D123: a dish's breakdown to check — the name, the portions, each ingredient with its grams (base or the model's
// estimate, marked), what the plan's check says of it, and the totals. Shared by «Розкласти свою страву» and a list's cards.
import { X } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { lineItem, type DishLine } from '../domain/dishBreakdown';
import { todayISO } from '../domain/dates';
import { mealNutrients, round } from '../domain/nutrition';
import { checkMeal } from '../domain/rules';
import type { Food, Plan } from '../domain/types';
import { t } from '../i18n/uk';

const L = t.dishes.breakdown;
const field = 'block min-h-tap w-full rounded-xl border border-line bg-bg px-3';
export const fmt = (n: number) => String(round(n, n < 10 ? 1 : 0)).replace('.', ',');

export function BreakdownEditor({ foods, plan, name, onName, portions, onPortions, lines, onLines, note, children }: {
  foods: Map<string, Food>; plan?: Plan; name: string; onName: (s: string) => void; portions: number; onPortions: (n: number) => void;
  lines: DishLine[]; onLines: (ls: DishLine[]) => void; note?: string; children?: ReactNode;
}) {
  const total = useMemo(() => mealNutrients(lines.map(lineItem), foods), [lines, foods]);
  const weight = lines.reduce((g, l) => g + l.grams, 0);
  // D111: what the plan's check says of each line — the estimated ones too, by what the model marked them as
  const hits = useMemo(() => (plan ? checkMeal({ plan, date: todayISO(), foods, dayEntries: [], recentEntries: [], meal: lines.map(lineItem) }) : [])
    .map((c) => [...new Set(c.hits.map((h) => h.message))]), [plan, foods, lines]);
  const set = (key: string, grams: number) => onLines(lines.map((l) => (l.key === key ? { ...l, grams } : l)));
  return (
    <div className="space-y-3">
      <label className="block"><span className="text-sm text-muted">{L.name}</span>
        <input value={name} onChange={(e) => onName(e.target.value)} className={field} /></label>
      <label className="block w-40"><span className="text-sm text-muted">{L.portions}</span>
        <input type="number" inputMode="decimal" min={1} step={1} value={portions} onChange={(e) => onPortions(Math.max(1, Number(e.target.value) || 1))} className={field} /></label>
      {note && <p className="text-sm text-warn">{note}</p>}
      <p className="text-xs text-muted">{L.check}</p>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {lines.map((l, i) => { const n = mealNutrients([lineItem(l)], foods); return (
          <li key={l.key} data-ingredient={l.food?.name ?? l.said} className="flex items-start gap-2 px-2 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{l.food?.name ?? l.said}</span>
              <span className={`block text-xs ${l.food ? 'text-muted' : 'text-warn'}`}>{l.food ? L.fromBase : L.estimate}{l.amountSaid ? '' : ` · ${L.amountGuessed}`}</span>
              <span className="tabular block text-xs text-muted">{L.line(fmt(n.kcal), fmt(n.protein), fmt(n.fat), fmt(n.carbs))}</span>
              {l.est && (l.est.tags.length > 0 || l.est.allergens.length > 0) && <span className="block text-xs text-muted">{[...l.est.tags.map((x) => L.tags[x]),
                ...(l.est.allergens.length ? [L.allergens(l.est.allergens.map((a) => t.allergen.name[a]).join(', '))] : [])].join(' · ')}</span>}
              {(hits[i]?.length ?? 0) > 0 && <span className="block text-xs text-warn">{hits[i]!.join(' · ')}</span>}
            </span>
            <label className="w-20 shrink-0"><span className="sr-only">{L.grams(l.food?.name ?? l.said)}</span>
              <input type="number" inputMode="decimal" min={0} step={1} value={l.grams} onChange={(e) => set(l.key, Math.max(0, Number(e.target.value) || 0))}
                className="min-h-[2.25rem] w-full rounded-lg border border-line bg-bg px-2 text-right" /></label>
            <span className="pt-2 text-xs text-muted">г</span>
            <button type="button" onClick={() => onLines(lines.filter((x) => x.key !== l.key))} aria-label={`${t.meal.remove}: ${l.food?.name ?? l.said}`}
              className="flex h-9 w-8 items-center justify-center text-muted"><X size={16} aria-hidden /></button>
          </li>); })}
      </ul>
      <div className="tabular rounded-xl bg-bg p-2 text-sm">
        <p>{L.total(fmt(weight), fmt(total.kcal), fmt(total.protein), fmt(total.fat), fmt(total.carbs))}</p>
        {portions > 1 && <p className="font-medium">{L.perPortion(fmt(weight / portions), fmt(total.kcal / portions), fmt(total.protein / portions), fmt(total.fat / portions), fmt(total.carbs / portions))}</p>}
      </div>
      {children}
    </div>
  );
}
