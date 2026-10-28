import { SceneHeader } from '../components/SceneHeader';
import { Download, FileText, ListPlus, Share2, Trash2 } from 'lucide-react';
import { DishBreakdown } from '../components/DishBreakdown';
import { DishList } from '../components/DishList';
import { kept } from '../data/kept';
import { toCsv, toFile } from '../domain/dishList';
import { Link, useSearchParams } from 'react-router-dom';
import { Loading } from '../components/Recovery';
import { saved } from '../components/Toast';
import { useState } from 'react';
import { db } from '../data/db';
import { useAllRecipes, useFoods, usePlan } from '../data/queries';
import { harchDishes } from '../data/harchDishes';
import { amountText } from '../domain/foodSearch';
import { FoodArtwork } from '../components/FoodArtwork';
import { ExampleNotice } from '../components/ExampleNotice';
import { mealNutrients, round } from '../domain/nutrition';
import { sumGrams } from '../domain/recipes';
import type { Food, Recipe } from '../domain/types';
import { t } from '../i18n/uk';

const L = t.dishes;

/** «Мої страви» (D27): built-in and own dishes; own ones can be renamed and deleted. Meals already written
 *  keep their own copy of the ingredients, so nothing here changes the history. */
export function Dishes() {
  const recipes = useAllRecipes();
  const foods = useFoods();
  const plan = usePlan();
  const [params] = useSearchParams(); // D110: «#/dishes?describe=…» from «Записати їжу» — a dish not found, described
  // D123: a list at once, or the own dishes out to a file; an unsaved list (kept for a week) opens again
  const [panel, setPanel] = useState<'list' | 'export' | null>(() => (kept('dishlist', 7 * 86_400_000) ? 'list' : null));
  if (!recipes || !foods) return <Loading />;
  const diet = plan?.constraints.find((c) => c.tag === 'diet' && c.active)?.diet; // D90
  const own = recipes.filter((r) => !r.builtIn), builtIn = recipes.filter((r) => r.builtIn);
  return (
    <section className="space-y-4 pt-4">
      <SceneHeader title={L.title} />
      <ExampleNotice plan={plan} />
      <p className="text-sm text-muted">{L.hint}</p>
      <Link to="/foods" className="flex min-h-tap items-center justify-between protocol-card rounded-2xl border border-line bg-surface px-3 font-medium">
        <span>{L.foods}</span><span aria-hidden className="text-muted">›</span>
      </Link>
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={panel === 'list'} onClick={() => setPanel(panel === 'list' ? null : 'list')}
          className="flex min-h-tap items-center gap-2 rounded-xl border border-accent px-3 font-medium text-accent"><ListPlus size={18} aria-hidden />{L.list.add}</button>
        <button type="button" aria-pressed={panel === 'export'} onClick={() => setPanel(panel === 'export' ? null : 'export')}
          className="flex min-h-tap items-center gap-2 rounded-xl border border-line px-3"><Download size={18} aria-hidden />{L.list.export}</button>
      </div>
      {panel === 'list' && <DishList foods={foods} recipes={recipes} {...(plan ? { plan } : {})} onClose={() => setPanel(null)} />}
      {panel === 'export' && <ExportPanel recipes={recipes} foods={foods} />}
      <DishBreakdown key={params.get('replace') ?? 'new'} foods={foods} {...(plan ? { plan } : {})} initial={params.get('describe') ?? ''}
        {...(params.get('replace') ? { replace: params.get('replace')! } : {})} />
      {own.length === 0 && <p className="text-muted">{L.empty}</p>}
      <ul className="space-y-3">{own.map((r) => <Card key={r.id} recipe={r} foods={foods} />)}</ul>
      <ul className="space-y-3">{builtIn.map((r) => <Card key={r.id} recipe={r} foods={foods} />)}</ul>
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

function Card({ recipe, foods }: { recipe: Recipe; foods: Parameters<typeof mealNutrients>[1] }) {
  const [name, setName] = useState(recipe.name);
  const [asking, setAsking] = useState(false);
  const n = mealNutrients(recipe.items, foods);
  return (
    <li className="protocol-card rounded-2xl border border-line bg-surface p-3">
      <div className="flex items-start gap-3">
        <FoodArtwork name={recipe.items[0]?.name ?? recipe.name} />
        <div className="min-w-0 flex-1">
          {recipe.builtIn ? (
            <p className="font-semibold">{recipe.name} <span className="ml-1 rounded-full bg-bg px-2 text-xs font-normal text-muted">{L.builtIn}</span></p>
          ) : (
            <div className="flex items-end gap-2">
              <label className="min-w-0 flex-1"><span className="text-sm text-muted">{L.rename}</span>
                <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name.trim() !== recipe.name && void saved(db.recipes.put({ ...recipe, name: name.trim() }), t.toast.saved)}
                  className="mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3 font-semibold" /></label>
              <button type="button" onClick={() => setAsking(true)} aria-label={`${L.delete}: ${recipe.name}`}
                className="flex min-h-tap min-w-tap items-center justify-center text-warn"><Trash2 size={18} /></button>
            </div>
          )}
        </div>
      </div>
      {recipe.needsMake ? ( /* D123: a draft — a name only, no numbers; its make-up through «Розкласти свою страву» */
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-warn">{L.list.draftMark}</span>
          <Link to={`/dishes?describe=${encodeURIComponent(`${recipe.name} — `)}&replace=${recipe.id}`} className="min-h-tap rounded-xl border border-accent px-3 py-2 text-accent">{L.list.addMake}</Link>
        </div>
      ) : (<>
        <p className="mt-1 tabular text-sm text-muted">{L.perPortion}: ≈ {sumGrams(recipe.items)} г · {round(n.kcal)} ккал · Б {round(n.protein)} · Ж {round(n.fat)} · В {round(n.carbs)}</p>
        <p className="mt-1 text-sm">{recipe.items.map((i) => `${i.name} ${amountText(i)}`).join(', ')}</p>
      </>)}
      {asking && (
        <div role="alertdialog" className="mt-2 rounded-xl bg-warn-bg p-2 text-sm text-warn">
          <p className="mb-2">{L.confirmDelete(recipe.name)}</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => void saved(db.recipes.delete(recipe.id), t.toast.deleted(recipe.name), () => db.recipes.put(recipe))} className="min-h-tap rounded-xl bg-warn px-3 font-medium text-surface">{L.delete}</button>
            <button type="button" onClick={() => setAsking(false)} className="min-h-tap rounded-xl border border-line bg-surface px-3 text-ink">{t.backup.no}</button>
          </div>
        </div>
      )}
    </li>
  );
}
