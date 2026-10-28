import { SceneHeader } from '../components/SceneHeader';
import { Download, FileText, Heart, ListPlus, MoreVertical, Search, Share2, Trash2 } from 'lucide-react';
import { DishBreakdown } from '../components/DishBreakdown';
import { DishList } from '../components/DishList';
import { toggleMealFavorite } from '../components/Favorites';
import { kept } from '../data/kept';
import { toCsv, toFile } from '../domain/dishList';
import { Link, useSearchParams } from 'react-router-dom';
import { Loading } from '../components/Recovery';
import { saved } from '../components/Toast';
import { useEffect, useMemo, useState } from 'react';
import { db } from '../data/db';
import { useAllRecipes, useFavorites, useFoods, usePlan } from '../data/queries';
import { harchDishes } from '../data/harchDishes';
import { amountText } from '../domain/foodSearch';
import { FoodArtwork } from '../components/FoodArtwork';
import { ExampleNotice } from '../components/ExampleNotice';
import { mealNutrients, round } from '../domain/nutrition';
import { sumGrams } from '../domain/recipes';
import type { Food, Recipe } from '../domain/types';
import { t } from '../i18n/uk';
import { stable } from '../sync/engine';

const L = t.dishes;
type MealFilter = 'breakfast' | 'lunch' | 'dinner' | 'snack';
type CatalogFilter = 'all' | 'favorites' | MealFilter;

// These are browse categories for the app's built-in recipes, not dietary or clinical recommendations.
const mealFilters: Partial<Record<string, MealFilter[]>> = {
  'dish-omelet': ['breakfast'], 'dish-syrnyky': ['breakfast', 'snack'], 'dish-curd-bake': ['breakfast'],
  'dish-oats-berries': ['breakfast', 'snack'], 'dish-omelet-veg': ['breakfast'],
  'dish-yogurt-bowl': ['breakfast', 'snack'],
  'dish-salad-veg': ['lunch', 'dinner'], 'dish-salad-cabbage': ['lunch', 'dinner'], 'dish-vinegret': ['lunch', 'dinner'],
  'dish-buckwheat-chicken': ['lunch', 'dinner'], 'dish-borscht': ['lunch'], 'dish-chicken-soup': ['lunch'],
  'dish-plov': ['lunch', 'dinner'], 'dish-ragout': ['lunch', 'dinner'], 'dish-buckwheat-mushrooms': ['lunch', 'dinner'],
  'dish-greek-salad': ['lunch', 'dinner'], 'dish-chicken-veg-airfryer': ['dinner'],
  'dish-fish-rice': ['dinner'], 'dish-cabbage-meat': ['dinner'],
};

/** «Мої страви» (D27): built-in and own dishes; own ones can be renamed and deleted. Meals already written
 *  keep their own copy of the ingredients, so nothing here changes the history. */
export function Dishes() {
  const recipes = useAllRecipes();
  const foods = useFoods();
  const plan = usePlan();
  const favorites = useFavorites();
  const [params] = useSearchParams(); // D110: «#/dishes?describe=…» from «Записати їжу» — a dish not found, described
  // D123: a list at once, or the own dishes out to a file; an unsaved list (kept for a week) opens again
  const [panel, setPanel] = useState<'list' | 'export' | null>(() => (kept('dishlist', 7 * 86_400_000) ? 'list' : null));
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<CatalogFilter>('all');
  const [breakdownOpen, setBreakdownOpen] = useState(() => params.has('describe') || params.has('replace'));
  const favoriteItems = useMemo(() => new Set((favorites ?? []).map((favorite) => stable(favorite.items))), [favorites]);
  useEffect(() => {
    if (params.has('describe') || params.has('replace')) setBreakdownOpen(true);
  }, [params]);
  if (!recipes || !foods) return <Loading />;
  const diet = plan?.constraints.find((c) => c.tag === 'diet' && c.active)?.diet; // D90
  const own = recipes.filter((r) => !r.builtIn);
  const search = query.trim().toLocaleLowerCase('uk');
  const catalog = recipes
    .filter((recipe) => {
      const isFavorite = favoriteItems.has(stable(recipe.items));
      const inCategory = filter === 'all' || filter === 'favorites' || mealFilters[recipe.id]?.includes(filter) === true;
      const matchesFilter = filter !== 'favorites' || isFavorite;
      const searchable = [recipe.name, ...(recipe.aliases ?? []), ...recipe.items.map((item) => item.name)].join(' ').toLocaleLowerCase('uk');
      return inCategory && matchesFilter && (!search || searchable.includes(search));
    })
    .sort((a, b) => Number(favoriteItems.has(stable(b.items))) - Number(favoriteItems.has(stable(a.items))) || a.name.localeCompare(b.name, 'uk'));
  const filters: CatalogFilter[] = ['all', 'favorites', 'breakfast', 'lunch', 'dinner', 'snack'];
  const filterLabel = (value: CatalogFilter) => value === 'all' ? L.catalog.all
    : value === 'favorites' ? L.catalog.favorites
      : t.meal.names[(['breakfast', 'lunch', 'dinner', 'snack'] as MealFilter[]).indexOf(value)]!;
  return (
    <section className="space-y-4 pt-4">
      <SceneHeader title={L.title} />
      <ExampleNotice plan={plan} />
      <label className="relative block">
        <Search size={18} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <span className="sr-only">{L.catalog.search}</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={L.catalog.search}
          className="min-h-tap w-full rounded-xl border border-line bg-surface pl-10 pr-3" />
      </label>
      <div role="group" aria-label={L.catalog.filters} className="flex min-w-0 gap-2 overflow-x-auto pb-1">
        {filters.map((value) => (
          <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}
            className={`min-h-tap shrink-0 rounded-full px-3 text-sm font-medium ${filter === value ? 'bg-accent text-surface' : 'border border-line bg-surface text-muted'}`}>
            {filterLabel(value)}
          </button>
        ))}
      </div>
      {catalog.length ? <ul className="space-y-2">{catalog.map((recipe) => (
        <Card key={recipe.id} recipe={recipe} foods={foods} favorite={favoriteItems.has(stable(recipe.items))}
          onToggleFavorite={() => void toggleMealFavorite(recipe.name, recipe.items)} />
      ))}</ul> : <p role="status" className="py-3 text-sm text-muted">{L.catalog.empty}</p>}
      <p className="text-sm text-muted">{L.hint}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={panel === 'list'} onClick={() => setPanel(panel === 'list' ? null : 'list')}
          className="flex min-h-tap items-center gap-2 rounded-xl border border-accent px-3 font-medium text-accent"><ListPlus size={18} aria-hidden />{L.list.add}</button>
        <button type="button" aria-pressed={panel === 'export'} onClick={() => setPanel(panel === 'export' ? null : 'export')}
          className="flex min-h-tap items-center gap-2 rounded-xl border border-line px-3"><Download size={18} aria-hidden />{L.list.export}</button>
        <button type="button" aria-expanded={breakdownOpen} onClick={() => setBreakdownOpen((open) => !open)}
          className="min-h-tap rounded-xl border border-line px-3">{breakdownOpen ? L.catalog.hideBreakdown : L.catalog.addDish}</button>
        <Link to="/foods" className="flex min-h-tap items-center rounded-xl border border-line px-3 font-medium">{L.foods}</Link>
      </div>
      {panel === 'list' && <DishList foods={foods} recipes={recipes} {...(plan ? { plan } : {})} onClose={() => setPanel(null)} />}
      {panel === 'export' && <ExportPanel recipes={recipes} foods={foods} />}
      <div hidden={!breakdownOpen}>
        <DishBreakdown key={params.get('replace') ?? 'new'} foods={foods} {...(plan ? { plan } : {})} initial={params.get('describe') ?? ''}
          {...(params.get('replace') ? { replace: params.get('replace')! } : {})} />
      </div>
      {own.length === 0 && <p className="text-sm text-muted">{L.empty}</p>}
      {diet && (() => { const cards = harchDishes(foods).filter((d) => d.diets.includes(diet)); return cards.length > 0 && (
        <details className="protocol-card rounded-2xl border border-line bg-surface p-3">
          <summary className="min-h-tap cursor-pointer font-medium">{L.harch(diet, cards.length)}</summary>
          <p className="mb-2 text-xs text-warn">{L.harchHint}</p>
          <ul className="divide-y divide-line text-sm">{cards.map((d) => { const n = mealNutrients(d.items, foods); return (
            <li key={d.card} className="py-1.5"><span className="font-medium">{d.name}</span>
              <span className="block text-xs text-muted">{d.category} · {d.outputG} г · {round(n.kcal)} ккал · Б {round(n.protein)} · В {round(n.carbs)}</span></li>); })}</ul>
        </details>); })()}

    </section>
  );
}

/** D123: the own dishes to a file — .json back into «Додати списком» on another phone (the same numbers, no AI), .csv to read.
 *  Only dishes: no plan, no diary. */
function ExportPanel({ recipes, foods }: { recipes: Recipe[]; foods: Map<string, Food> }) {
  const own = recipes.filter((r) => !r.builtIn);
  if (!own.length) return <p className="text-sm text-muted">{L.list.nothing}</p>;
  const day = new Date().toISOString().slice(0, 10);
  const json = () => new File([JSON.stringify(toFile(own, foods), null, 1)], `moi-stravy-${day}.json`, { type: 'application/json' });
  const csv = () => new File([`\uFEFF${toCsv(own)}`], `moi-stravy-${day}.csv`, { type: 'text/csv' }); // BOM: Excel reads it as UTF-8
  const download = (f: File) => { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10_000); };
  const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [json()] });
  return (
    <section aria-label={L.list.export} className="space-y-2 protocol-card rounded-2xl border border-line bg-surface p-3">
      <p className="text-sm text-muted">{L.list.exportHint}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => download(json())} className="flex min-h-tap items-center gap-2 rounded-xl bg-accent px-3 font-medium text-surface"><Download size={18} aria-hidden />{L.list.saveFile}</button>
        <button type="button" onClick={() => download(csv())} className="flex min-h-tap items-center gap-2 rounded-xl border border-line px-3"><FileText size={18} aria-hidden />{L.list.saveCsv}</button>
        {canShare && <button type="button" onClick={() => void navigator.share({ files: [json()], title: json().name }).catch(() => undefined)}
          className="flex min-h-tap items-center gap-2 rounded-xl border border-accent px-3 font-medium text-accent"><Share2 size={18} aria-hidden />{L.list.share}</button>}
      </div>
    </section>
  );
}

function Card({ recipe, foods, favorite, onToggleFavorite }: {
  recipe: Recipe; foods: Parameters<typeof mealNutrients>[1]; favorite: boolean; onToggleFavorite: () => void;
}) {
  const [name, setName] = useState(recipe.name);
  const [asking, setAsking] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const n = mealNutrients(recipe.items, foods);
  return (
    <li data-catalog-dish={recipe.name} className="protocol-card rounded-2xl border border-line bg-surface p-2">
      <div className="flex min-w-0 items-center gap-3">
        <FoodArtwork name={recipe.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{recipe.name}</p>
          {recipe.needsMake
            ? <p className="mt-0.5 text-xs text-warn">{L.list.draftMark}</p>
            : <p className="mt-0.5 text-sm text-muted">{sumGrams(recipe.items)} г · {round(n.kcal)} ккал</p>}
        </div>
        {!recipe.needsMake && <button type="button" aria-label={favorite ? t.meal.removeFavorite(recipe.name) : t.meal.addFavorite(recipe.name)}
          aria-pressed={favorite} onClick={onToggleFavorite} className={`flex min-h-tap min-w-tap shrink-0 items-center justify-center ${favorite ? 'text-red-500' : 'text-muted'}`}>
          <Heart size={20} fill={favorite ? 'currentColor' : 'none'} aria-hidden />
        </button>}
        <button type="button" aria-label={`${expanded ? L.catalog.hide : L.catalog.more}: ${recipe.name}`} aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)} className="flex min-h-tap min-w-tap shrink-0 items-center justify-center text-muted">
          <MoreVertical size={20} aria-hidden />
        </button>
      </div>
      {expanded && <div className="mt-2 space-y-2 border-t border-line pt-2">
        {recipe.builtIn && <span className="inline-block rounded-full bg-bg px-2 py-1 text-xs text-muted">{L.builtIn}</span>}
        {recipe.needsMake ? (
          <Link to={`/dishes?describe=${encodeURIComponent(`${recipe.name} — `)}&replace=${recipe.id}`} className="inline-flex min-h-tap items-center rounded-xl border border-accent px-3 text-accent">{L.list.addMake}</Link>
        ) : <>
          <p className="tabular text-sm text-muted">{L.perPortion}: ≈ {sumGrams(recipe.items)} г · {round(n.kcal)} ккал · Б {round(n.protein)} · Ж {round(n.fat)} · В {round(n.carbs)}</p>
          <p className="text-sm">{recipe.items.map((item) => `${item.name} ${amountText(item)}`).join(', ')}</p>
          {!recipe.builtIn && <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1"><span className="text-sm text-muted">{L.rename}</span>
              <input value={name} onChange={(event) => setName(event.target.value)} onBlur={() => name.trim() && name.trim() !== recipe.name && void saved(db.recipes.put({ ...recipe, name: name.trim() }), t.toast.saved)}
                className="mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3 font-semibold" /></label>
            <button type="button" onClick={() => setAsking(true)} aria-label={`${L.delete}: ${recipe.name}`}
              className="flex min-h-tap min-w-tap items-center justify-center text-warn"><Trash2 size={18} aria-hidden /></button>
          </div>
          }
        </>}
        {asking && (
          <div role="alertdialog" className="rounded-xl bg-warn-bg p-2 text-sm text-warn">
            <p className="mb-2">{L.confirmDelete(recipe.name)}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => void saved(db.recipes.delete(recipe.id), t.toast.deleted(recipe.name), () => db.recipes.put(recipe))} className="min-h-tap rounded-xl bg-warn px-3 font-medium text-surface">{L.delete}</button>
              <button type="button" onClick={() => setAsking(false)} className="min-h-tap rounded-xl border border-line bg-surface px-3 text-ink">{t.backup.no}</button>
            </div>
          </div>
        )}
      </div>}
    </li>
  );
}
