// D51: «Мої звичні» — meals the person pinned («Моя вівсянка», «Звичайний сніданок»). More precise than «Як учора»:
// yesterday may have been anything. A favorite keeps its own copy of the lines — editing a past meal never changes it.
import { Star } from 'lucide-react';
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

/** Under the search in «Записати їжу»: a tap adds the favorite's lines; the star unpins it (with «Скасувати»). */
export function FavoritesList({ onAdd }: { onAdd: (items: MealItem[]) => void }) {
  const favorites = useFavorites();
  if (!favorites?.length) return null;
  return (
    <div className="mt-3">
      <p className="mb-1 text-sm text-muted">{t.meal.favorites}</p>
      <ul className="space-y-2">
        {favorites.map((f) => (
          <li key={f.id} className="flex items-stretch gap-1">
            <button type="button" onClick={() => onAdd(copy(f.items))}
              className="flex min-h-tap min-w-0 flex-1 flex-col justify-center rounded-xl border border-line px-3 py-1 text-left">
              <span className="font-medium">{f.title}</span>
              <span className="truncate text-sm text-muted">{f.items.map((x) => `${x.name} ${amountText(x)}`).join(', ')}</span>
            </button>
            <button type="button" aria-label={t.meal.unpin(f.title)}
              onClick={() => void saved(db.favorites.delete(f.id), t.toast.unpinned(f.title), () => db.favorites.put(f))}
              className="flex min-h-tap min-w-tap items-center justify-center text-accent"><Star size={18} fill="currentColor" aria-hidden /></button>
          </li>
        ))}
      </ul>
    </div>
  );
}
