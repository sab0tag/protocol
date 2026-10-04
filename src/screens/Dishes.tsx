import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { db } from '../data/db';
import { useFoods, useRecipes } from '../data/queries';
import { amountText } from '../domain/foodSearch';
import { mealNutrients, round } from '../domain/nutrition';
import { sumGrams } from '../domain/recipes';
import type { Recipe } from '../domain/types';
import { t } from '../i18n/uk';

const L = t.dishes;

/** «Мої страви» (D27): built-in and own dishes; own ones can be renamed and deleted. Meals already written
 *  keep their own copy of the ingredients, so nothing here changes the history. */
export function Dishes() {
  const recipes = useRecipes();
  const foods = useFoods();
  if (!recipes || !foods) return null;
  const own = recipes.filter((r) => !r.builtIn), builtIn = recipes.filter((r) => r.builtIn);
  return (
    <section className="space-y-4 pt-4">
      <h1 className="text-2xl font-semibold">{L.title}</h1>
      <p className="text-sm text-muted">{L.hint}</p>
      {own.length === 0 && <p className="text-muted">{L.empty}</p>}
      <ul className="space-y-3">{own.map((r) => <Card key={r.id} recipe={r} foods={foods} />)}</ul>
      <ul className="space-y-3">{builtIn.map((r) => <Card key={r.id} recipe={r} foods={foods} />)}</ul>
    </section>
  );
}

function Card({ recipe, foods }: { recipe: Recipe; foods: Parameters<typeof mealNutrients>[1] }) {
  const [name, setName] = useState(recipe.name);
  const [asking, setAsking] = useState(false);
  const n = mealNutrients(recipe.items, foods);
  return (
    <li className="rounded-2xl border border-line bg-surface p-3">
      {recipe.builtIn ? (
        <p className="font-semibold">{recipe.name} <span className="ml-1 rounded-full bg-bg px-2 text-xs font-normal text-muted">{L.builtIn}</span></p>
      ) : (
        <div className="flex items-end gap-2">
          <label className="flex-1"><span className="text-sm text-muted">{L.rename}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && void db.recipes.put({ ...recipe, name: name.trim() })}
              className="mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3 font-semibold" /></label>
          <button type="button" onClick={() => setAsking(true)} aria-label={`${L.delete}: ${recipe.name}`}
            className="flex min-h-tap min-w-tap items-center justify-center text-warn"><Trash2 size={18} /></button>
        </div>
      )}
      <p className="mt-1 tabular text-sm text-muted">{L.perPortion}: ≈ {sumGrams(recipe.items)} г · {round(n.kcal)} ккал · Б {round(n.protein)} · Ж {round(n.fat)} · В {round(n.carbs)}</p>
      <p className="mt-1 text-sm">{recipe.items.map((i) => `${i.name} ${amountText(i)}`).join(', ')}</p>
      {asking && (
        <div role="alertdialog" className="mt-2 rounded-xl bg-warn-bg p-2 text-sm text-warn">
          <p className="mb-2">{L.confirmDelete(recipe.name)}</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => void db.recipes.delete(recipe.id)} className="min-h-tap rounded-xl bg-warn px-3 font-medium text-surface">{L.delete}</button>
            <button type="button" onClick={() => setAsking(false)} className="min-h-tap rounded-xl border border-line bg-surface px-3 text-ink">{t.backup.no}</button>
          </div>
        </div>
      )}
    </li>
  );
}
