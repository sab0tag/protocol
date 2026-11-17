// D51: «Мої звичні» — meals the person pinned («Моя вівсянка», «Звичайний сніданок»). More precise than «Як учора»:
// yesterday may have been anything. A favorite keeps its own copy of the lines — editing a past meal never changes it.
import { db } from '../data/db';
import { newId } from '../domain/dates';
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
