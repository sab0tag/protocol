import type { DayEntry, Food } from '../domain/types';
import { shownTime } from '../domain/dates';
import { amountText } from '../domain/foodSearch';
import { lineNutrients, mealNutrients, round } from '../domain/nutrition';
import { BEFORE_HOURS, eatenBefore } from '../domain/symptoms';
import { itemAllergens, mealAllergens } from '../domain/allergens';
import { AllergenNote } from './AllergenPicker';
import { t } from '../i18n/uk';

const fmt = (n: number) => String(round(n, 1)).replace('.', ',');

/** D46: what a meal row holds — every line with its amount and calories, dishes opened up, the meal in numbers;
 *  shown above the row's actions. */
export function EntryPreview({ entry, foods, all }: { entry: DayEntry; foods?: Map<string, Food>; all?: DayEntry[] }) {
  if (entry.kind === 'symptom') { // D56: the symptom and, beside it, what was eaten before
    const before = all ? eatenBefore(all, entry.at) : [];
    return (
      <div className="mb-3 space-y-1 text-sm">
        <p className="text-muted">{shownTime(entry)} · {[t.symptom.word, entry.severity ? t.symptom.level(entry.severity) : ''].filter(Boolean).join(' · ')}</p>
        <p className="font-medium">{t.symptom.before(BEFORE_HOURS)}</p>
        {before.length === 0 ? <p className="text-muted">{t.symptom.nothingBefore}</p> : before.map((m) => (
          <p key={m.id}><span className="tabular text-muted">{shownTime(m)}</span> <span className="font-medium">{m.title}</span>: {m.items?.map((x) => `${x.name} ${amountText(x)}`).join(', ')}
            {foods && m.items && <AllergenNote className="block" allergens={mealAllergens(m.items, foods)} unknown={m.items.some((x) => itemAllergens(x, foods).unknown)} />}</p>
        ))}
      </div>
    );
  }
  const head = <p className="text-sm text-muted">{shownTime(entry) ?? t.day.timeUnknown} · {t.status[entry.status]}</p>;
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
      <AllergenNote className="block" allergens={mealAllergens(entry.items, foods)} unknown={entry.items.some((x) => itemAllergens(x, foods).unknown)} />
      {entry.menu?.tips?.length ? (
        <details className="text-sm"><summary className="min-h-tap cursor-pointer py-2 text-accent">{t.menu.tips}</summary>
          <ul className="list-disc space-y-1 pl-5">{entry.menu.tips.map((x) => <li key={x}>{x}</li>)}</ul></details>
      ) : null}
    </div>
  );
}
