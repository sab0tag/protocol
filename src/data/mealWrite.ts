// D159, D162: food written into a meal tile — the meal's latest record, or a new one at the meal's time; a snack is always
// its own record (D161). The same rule for a tap in the tile and for food said in the one field on «Сьогодні».
import { saved } from '../components/Toast';
import { atLocal, newId } from '../domain/dates';
import { slotEntries, slotTime, type Slot } from '../domain/mealSlots';
import type { DayEntry, MealItem } from '../domain/types';
import { t } from '../i18n/uk';
import { db } from './db';

/** Writes the lines (with «Скасувати» in the toast); returns the record they went into. */
export async function writeToSlot(args: { date: string; slot: Slot; items: MealItem[]; all: DayEntry[]; via?: DayEntry['via']; now?: Date }): Promise<string | undefined> {
  const { date, slot, items, all, via } = args;
  if (!items.length) return undefined;
  const label = t.tiles.added(items.map((i) => i.name).join(', '));
  const target = slot === 3 ? undefined : slotEntries(all, date, slot).done.at(-1);
  if (target) {
    const next: DayEntry = { ...target, items: [...(target.items ?? []), ...items], ...(via ? { via } : {}) };
    await saved(db.entries.put(next), label, () => db.entries.put(target));
    return target.id;
  }
  const entry: DayEntry = { id: newId(), at: atLocal(date, slotTime({ slot, date, now: args.now ?? new Date(), entries: all })), kind: 'meal', status: 'done',
    title: t.meal.names[slot]!, items, ...(via ? { via } : {}) };
  await saved(db.entries.add(entry), label, () => db.entries.delete(entry.id));
  return entry.id;
}
