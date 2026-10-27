import { format, parseISO } from 'date-fns';
import { uk } from 'date-fns/locale';
import { Clock3, RotateCcw } from 'lucide-react';
import { FoodArtwork } from './FoodArtwork';
import { dateOf } from '../domain/dates';
import { amountText } from '../domain/foodSearch';
import type { DayEntry, MealItem } from '../domain/types';
import { t } from '../i18n/uk';
import { stable } from '../sync/engine';

/** A short list of actual meals; a repeat copies composition into the current draft only. */
export function RecentMeals({ entries, date, onAdd }: {
  entries: DayEntry[]; date: string; onAdd: (items: MealItem[]) => void;
}) {
  const seen = new Set<string>();
  const meals = entries.filter((e) => e.kind === 'meal' && e.status === 'done' && e.items?.length
    && dateOf(e.at) <= date && Number.isFinite(Date.parse(e.at)) && Date.parse(e.at) <= Date.now())
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id))
    .filter((e) => {
      // Keep amounts, cooking, units, nutrients and recipe snapshots in the identity.
      const key = stable(e.items!.map((item) => stable(item)).sort());
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(0, 3);
  if (!meals.length) return null;
  return (
    <section aria-label={t.meal.recent} className="protocol-card p-4 sm:p-5">
      <h2 className="flex items-center gap-2 font-semibold"><Clock3 size={18} className="text-accent" aria-hidden />{t.meal.recent}</h2>
      <p className="mt-1 text-sm text-muted">{t.meal.repeatHint}</p>
      <ul className="mt-3 space-y-2">
        {meals.map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => onAdd(JSON.parse(JSON.stringify(e.items)) as MealItem[])}
              className="flex min-h-tap w-full items-start gap-3 rounded-2xl border border-line bg-bg/50 p-3 text-left motion-safe:transition-colors motion-safe:duration-150 hover:border-accent/50">
              <FoodArtwork name={e.items![0]!.name} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{e.title}</span>
                <span className="mt-0.5 block line-clamp-2 text-sm text-muted">{e.items!.map((item) => `${item.name} ${amountText(item)}`).join(', ')}</span>
                <span className="mt-1 block text-xs text-muted">{format(parseISO(dateOf(e.at)), 'd MMMM', { locale: uk })}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-accent"><RotateCcw size={16} aria-hidden /><span className="hidden min-[380px]:inline">{t.meal.repeat}</span><span className="sr-only min-[380px]:hidden">{t.meal.repeat}</span></span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
