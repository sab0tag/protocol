// D51: «Мої звичні» — meals the person pinned («Моя вівсянка», «Звичайний сніданок»). More precise than «Як учора»:
// yesterday may have been anything. A favorite keeps its own copy of the lines — editing a past meal never changes it.
import { Star } from 'lucide-react';
import { useState } from 'react';
import { FoodArtwork } from './FoodArtwork';
import { db } from '../data/db';
import { useFavorites } from '../data/queries';
import { newId } from '../domain/dates';
import { amountText } from '../domain/foodSearch';
import type { Favorite, MealItem } from '../domain/types';
import { t } from '../i18n/uk';
import { stable } from '../sync/engine';
import { saved, toast } from './Toast';

const copy = (items: MealItem[]): MealItem[] => JSON.parse(JSON.stringify(items)) as MealItem[];

/** Pin these lines under `title`; the same lines pinned already are only named. */
export async function pinMeal(title: string, items: MealItem[]) {
  const same = (await db.favorites.toArray()).find((f) => stable(f.items) === stable(items));
  if (same) { toast(t.toast.alreadyPinned(same.title)); return; }
  const f: Favorite = { id: newId(), title: title.trim(), items: copy(items) };
  await saved(db.favorites.put(f), t.toast.pinned(f.title), () => db.favorites.delete(f.id));
}

export async function toggleMealFavorite(title: string, items: MealItem[]): Promise<void> {
  const same = (await db.favorites.toArray()).find((f) => stable(f.items) === stable(items));
  if (same) {
    await saved(db.favorites.delete(same.id), t.toast.unpinned(same.title), () => db.favorites.put(same));
    return;
  }
  const favorite: Favorite = { id: newId(), title: title.trim(), items: copy(items) };
  await saved(db.favorites.put(favorite), t.toast.pinned(favorite.title), () => db.favorites.delete(favorite.id));
}

/** Under the search in «Записати їжу»: a tap adds the favorite's lines; the star unpins it (with «Скасувати»). */
export function FavoritesList({ onAdd, limit }: { onAdd: (items: MealItem[]) => void; limit?: number }) {
  const favorites = useFavorites();
  const [expanded, setExpanded] = useState(false);
  if (!favorites?.length) return null;
  const shown = expanded || limit == null ? favorites : favorites.slice(0, limit);
  return (
    <section aria-label={t.meal.favorites} className="mt-4 border-t border-line pt-4">
      <h2 className="mb-2 font-semibold">{t.meal.favorites}</h2>
      <ul className="space-y-2">
        {shown.map((f) => (
          <li key={f.id} className="flex items-stretch gap-1">
            <button type="button" onClick={() => onAdd(copy(f.items))}
              className="flex min-h-tap min-w-0 flex-1 items-center gap-3 rounded-xl border border-line px-3 py-1 text-left">
              <FoodArtwork name={f.items[0]?.name ?? f.title} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{f.title}</span>
                <span className="block truncate text-sm text-muted">{f.items.map((x) => `${x.name} ${amountText(x)}`).join(', ')}</span>
              </span>
            </button>
            <button type="button" aria-label={t.meal.unpin(f.title)}
              onClick={() => void saved(db.favorites.delete(f.id), t.toast.unpinned(f.title), () => db.favorites.put(f))}
              className="flex min-h-tap min-w-tap items-center justify-center text-accent"><Star size={18} fill="currentColor" aria-hidden /></button>
          </li>
        ))}
      </ul>
      {limit != null && favorites.length > limit && <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}
        className="mt-2 min-h-tap text-sm font-medium text-accent">{expanded ? t.meal.fewerFavorites : t.meal.allFavorites(favorites.length)}</button>}
    </section>
  );
}
