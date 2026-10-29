import { format, parseISO } from 'date-fns';
import { uk } from 'date-fns/locale';
import { Clock3, Heart, RotateCcw } from 'lucide-react';
import { useRef, useState } from 'react';
import { FoodArtwork } from './FoodArtwork';
import { dateOf, todayISO } from '../domain/dates';
import { amountText } from '../domain/foodSearch';
import { mealCategoryFor, mealCategoryName, type MealCategory } from '../domain/mealCategory';
import type { DayEntry, MealItem } from '../domain/types';
import { t } from '../i18n/uk';
import { stable } from '../sync/engine';
import { useFavorites } from '../data/queries';
import { toggleMealFavorite } from './Favorites';

/** A short list of actual meals; a repeat copies composition into the current draft only. */
export function RecentMeals({ entries, date, initialTitle, onAdd }: {
  entries: DayEntry[]; date: string; initialTitle: string; onAdd: (items: MealItem[], title: string, targetDate: string) => void;
}) {
  const favorites = useFavorites();
  const [targetDate, setTargetDate] = useState(() => date < todayISO() ? todayISO() : date);
  const [selected, setSelected] = useState<MealCategory>(() => mealCategoryFor(initialTitle, new Date().toISOString()));
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const seen = new Set<string>();
  const meals = entries.filter((e) => e.kind === 'meal' && e.status === 'done' && e.items?.length
    && dateOf(e.at) <= date && Number.isFinite(Date.parse(e.at)) && Date.parse(e.at) <= Date.now())
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id))
    .filter((e) => {
      // Keep amounts, cooking, units, nutrients and recipe snapshots in the identity.
      // Deduplicate within a meal tab; the same food can belong to breakfast and a snack.
      const key = stable([mealCategoryFor(e.title, e.at), e.items!.map((item) => stable(item)).sort()]);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  if (!meals.length) return null;
  const categorized = meals.reduce<Record<MealCategory, DayEntry[]>>((groups, meal) => {
    const category = mealCategoryFor(meal.title, meal.at);
    if (groups[category].length < 3) groups[category].push(meal);
    return groups;
  }, { 0: [], 1: [], 2: [], 3: [] });
  const selectedMeals = categorized[selected];
  return (
    <section aria-label={t.meal.recent} className="protocol-card p-4 sm:p-5">
      <h2 className="flex items-center gap-2 font-semibold"><Clock3 size={18} className="text-accent" aria-hidden />{t.meal.recent}</h2>
      <p className="mt-1 text-sm text-muted">{t.meal.repeatHint}</p>
      <label className="mt-3 block text-sm font-medium" htmlFor="repeat-target-date">Дата нового прийому</label>
      <input id="repeat-target-date" type="date" value={targetDate} min="2000-01-01" max="2100-12-31" onChange={(event) => setTargetDate(event.target.value)} className="mt-1 min-h-tap w-full rounded-xl border border-line bg-bg px-3 text-base" />
      <p className="mt-1 text-xs text-muted">Повторення створює чернетку на вибрану дату. Записи минулих днів не змінюються.</p>
      <div role="tablist" aria-label={t.meal.recentTabs} className="mt-3 flex gap-1 overflow-x-auto rounded-xl bg-bg p-1">
        {t.meal.names.map((name, index) => (
          <button key={name} ref={(element) => { tabs.current[index] = element; }} type="button" role="tab" aria-selected={selected === index}
            tabIndex={selected === index ? 0 : -1}
            onClick={() => setSelected(index as MealCategory)}
            onKeyDown={(event) => {
              const next = event.key === 'ArrowRight' ? (index + 1) % t.meal.names.length
                : event.key === 'ArrowLeft' ? (index + t.meal.names.length - 1) % t.meal.names.length
                  : event.key === 'Home' ? 0 : event.key === 'End' ? t.meal.names.length - 1 : -1;
              if (next >= 0) {
                event.preventDefault();
                setSelected(next as MealCategory);
                tabs.current[next]?.focus();
              }
            }}
            className={`min-h-tap shrink-0 rounded-lg px-3 text-sm font-medium ${selected === index ? 'bg-surface text-accent shadow-sm' : 'text-muted'}`}>
            {name}
          </button>
        ))}
      </div>
      {selectedMeals.length ? <ul className="mt-3 space-y-2">
        {selectedMeals.map((e) => {
          const favorite = favorites?.some((item) => stable(item.items) === stable(e.items));
          return (
          <li key={e.id}>
            <div className="flex min-w-0 items-start gap-2">
              <button type="button" data-testid="recent-meal-add" onClick={() => onAdd(
                JSON.parse(JSON.stringify(e.items)) as MealItem[], mealCategoryName(selected), targetDate,
              )}
                className="flex min-h-tap min-w-0 flex-1 items-start gap-2 rounded-2xl border border-line bg-bg/50 p-3 text-left motion-safe:transition-colors motion-safe:duration-150 hover:border-accent/50">
                <span className="shrink-0"><FoodArtwork name={e.items![0]!.name} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{e.title}</span>
                  <span className="mt-0.5 block line-clamp-2 text-sm text-muted">{e.items!.map((item) => `${item.name} ${amountText(item)}`).join(', ')}</span>
                  <span className="mt-1 block text-xs text-muted">{format(parseISO(dateOf(e.at)), 'd MMMM', { locale: uk })}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-accent"><RotateCcw size={16} aria-hidden /><span className="sr-only">{t.meal.repeat}</span></span>
              </button>
              <button type="button" aria-label={favorite ? t.meal.removeFavorite(e.title) : t.meal.addFavorite(e.title)}
                aria-pressed={favorite ?? false} onClick={() => void toggleMealFavorite(e.title, e.items!)}
                className={`flex min-h-tap min-w-tap shrink-0 items-center justify-center rounded-xl ${favorite ? 'text-red-600' : 'text-muted'}`}>
                <Heart size={20} fill={favorite ? 'currentColor' : 'none'} aria-hidden />
              </button>
            </div>
          </li>
          );
        })}
      </ul> : <p role="status" className="mt-3 text-sm text-muted">{t.meal.noRecentForType(mealCategoryName(selected))}</p>}
    </section>
  );
}
