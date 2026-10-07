import type { DayEntry, Food } from '../domain/types';
import { timeOf } from '../domain/dates';
import { amountText } from '../domain/foodSearch';
import { lineNutrients, mealNutrients, round } from '../domain/nutrition';
import { t } from '../i18n/uk';

const fmt = (n: number) => String(round(n, 1)).replace('.', ',');

/** D46: what a meal row holds — every line with its amount and calories, dishes opened up, the meal in numbers;
 *  shown above the row's actions. */
export function EntryPreview({ entry, foods }: { entry: DayEntry; foods?: Map<string, Food> }) {
  const head = <p className="text-sm text-muted">{timeOf(entry.at)} · {t.status[entry.status]}</p>;
  if (entry.kind !== 'meal' || !entry.items?.length || !foods) {
    return <div className="mb-3">{head}{entry.kind === 'water' && <p>{entry.waterMl ?? 0} {t.units.ml}</p>}</div>;
  }
  const total = mealNutrients(entry.items, foods);
  return (
    <div className="mb-3 space-y-2">
      {head}
      <ul className="divide-y divide-line rounded-xl border border-line">
        {entry.items.map((it, i) => (
          <li key={i} className="px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span>{it.name} <span className="whitespace-nowrap text-muted">· {amountText(it)}{it.unit || it.recipe ? ` ≈ ${it.grams}\u00a0г` : ''}</span></span>
              <span className="tabular shrink-0 text-sm text-muted">{round(lineNutrients(it, foods).kcal)} {t.units.kcal}</span>
            </div>
            {it.components?.length ? (
              <p className="mt-0.5 text-xs text-muted">{it.components.map((c) => `${c.name} ${amountText(c)}`).join(', ')}</p>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="tabular text-sm">
        <span className="font-semibold">{round(total.kcal)} {t.units.kcal}</span>
        <span className="text-muted"> · Б {fmt(total.protein)} · Ж {fmt(total.fat)} · В {fmt(total.carbs)} · Ca {round(total.calciumMg)} {t.units.mg}</span>
      </p>
      {entry.menu?.tips?.length ? (
        <details className="text-sm"><summary className="min-h-tap cursor-pointer py-2 text-accent">{t.menu.tips}</summary>
          <ul className="list-disc space-y-1 pl-5">{entry.menu.tips.map((x) => <li key={x}>{x}</li>)}</ul></details>
      ) : null}
    </div>
  );
}
