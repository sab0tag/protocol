import { Trash2 } from 'lucide-react';
import { DishBreakdown } from '../components/DishBreakdown';
import { LabelScan } from '../components/LabelScan';
import { useSearchParams } from 'react-router-dom';
import { Loading } from '../components/Recovery';
import { saved } from '../components/Toast';
import { useState } from 'react';
import { db } from '../data/db';
import { useFoods, usePlan, useRecipes } from '../data/queries';
import { harchDishes } from '../data/harchDishes';
import { amountText } from '../domain/foodSearch';
import { mealNutrients, round } from '../domain/nutrition';
import { detachFood, sumGrams } from '../domain/recipes';
import type { Food, Recipe } from '../domain/types';
import { AllergenPicker } from '../components/AllergenPicker';
import { t } from '../i18n/uk';

const L = t.dishes;

/** «Мої страви» (D27): built-in and own dishes; own ones can be renamed and deleted. Meals already written
 *  keep their own copy of the ingredients, so nothing here changes the history. */
export function Dishes() {
  const recipes = useRecipes();
  const foods = useFoods();
  const plan = usePlan();
  const [params] = useSearchParams(); // D110: «#/dishes?describe=…» from «Записати їжу» — a dish not found, described
  if (!recipes || !foods) return <Loading />;
  const diet = plan?.constraints.find((c) => c.tag === 'diet' && c.active)?.diet; // D90
  const mine = [...foods.values()].filter((f) => f.custom).sort((a, b) => a.name.localeCompare(b.name, 'uk'));
  const own = recipes.filter((r) => !r.builtIn), builtIn = recipes.filter((r) => r.builtIn);
  return (
    <section className="space-y-4 pt-4">
      <h1 className="text-2xl font-semibold">{L.title}</h1>
      <p className="text-sm text-muted">{L.hint}</p>
      <DishBreakdown foods={foods} {...(plan ? { plan } : {})} initial={params.get('describe') ?? ''} />
      {own.length === 0 && <p className="text-muted">{L.empty}</p>}
      <ul className="space-y-3">{own.map((r) => <Card key={r.id} recipe={r} foods={foods} />)}</ul>
      <ul className="space-y-3">{builtIn.map((r) => <Card key={r.id} recipe={r} foods={foods} />)}</ul>
      {diet && (() => { const cards = harchDishes(foods).filter((d) => d.diets.includes(diet)); return cards.length > 0 && (
        <details className="rounded-2xl border border-line bg-surface p-3">
          <summary className="min-h-tap cursor-pointer font-medium">{L.harch(diet, cards.length)}</summary>
          <p className="mb-2 text-xs text-warn">{L.harchHint}</p>
          <ul className="divide-y divide-line text-sm">{cards.map((d) => { const n = mealNutrients(d.items, foods); return (
            <li key={d.card} className="py-1.5"><span className="font-medium">{d.name}</span>
              <span className="block text-xs text-muted">{d.category} · {d.outputG} г · {round(n.kcal)} ккал · Б {round(n.protein)} · В {round(n.carbs)}</span></li>); })}</ul>
        </details>); })()}

      <h2 className="pt-2 text-xl font-semibold">{L.foods}</h2>
      <p className="text-sm text-muted">{L.foodsHint}</p>
      <LabelScan />
      {mine.length === 0 ? <p className="text-muted">{L.foodsEmpty}</p>
        : <ul className="space-y-3">{mine.map((f) => <FoodCard key={f.id} food={f} />)}</ul>}
    </section>
  );
}

async function removeFood(food: Food) {
  await db.transaction('rw', db.entries, db.recipes, db.foods, async () => {
    for (const e of await db.entries.filter((e) => !!e.items?.length).toArray()) {
      const r = detachFood(e.items!, food);
      if (r.changed) await db.entries.put({ ...e, items: r.items });
    }
    for (const rec of await db.recipes.toArray()) {
      const r = detachFood(rec.items, food);
      if (r.changed) await db.recipes.put({ ...rec, items: r.items });
    }
    await db.foods.delete(food.id);
  });
}

/** D36: an own food — name and nutrients per 100 g; deleting it turns the lines that used it into free lines
 *  with the same nutrients, so the history does not change. */
function FoodCard({ food }: { food: Food }) {
  const [f, setF] = useState(food);
  const [asking, setAsking] = useState(false);
  const num = (v: string) => Math.max(0, Number(v.replace(',', '.')) || 0);
  const fields: [keyof Food['per100g'], string][] = [['kcal', 'ккал'], ['protein', 'Б'], ['fat', 'Ж'], ['carbs', 'В']];
  const changed = JSON.stringify(f) !== JSON.stringify(food);
  return (
    <li className="space-y-2 rounded-2xl border border-line bg-surface p-3">
      <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label={L.rename}
        className="block min-h-tap w-full rounded-xl border border-line bg-bg px-3 font-semibold" />
      <div className="grid grid-cols-4 gap-2">
        {fields.map(([k, label]) => (
          <label key={k} className="block"><span className="text-xs text-muted">{label} / 100 г</span>
            <input inputMode="decimal" value={String(f.per100g[k] ?? 0)} onChange={(e) => setF({ ...f, per100g: { ...f.per100g, [k]: num(e.target.value) } })}
              className="block min-h-tap w-full rounded-xl border border-line bg-bg px-2" /></label>
        ))}
      </div>
      <AllergenPicker value={f.allergens ?? []} onChange={(v) => setF({ ...f, allergens: v })} />
      <div className="flex gap-2">
        <button type="button" disabled={!changed || !f.name.trim()} onClick={() => void saved(db.foods.put({ ...f, name: f.name.trim() }), t.toast.saved)}
          className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface disabled:opacity-40">{L.save}</button>
        {asking
          ? <button type="button" onClick={() => void saved(removeFood(food), t.toast.deleted(food.name))} className="min-h-tap rounded-xl bg-warn px-3 font-medium text-surface">{L.confirmDelete(food.name)}</button>
          : <button type="button" onClick={() => setAsking(true)} aria-label={`${L.delete}: ${food.name}`}
              className="flex min-h-tap min-w-tap items-center justify-center rounded-xl border border-line text-warn"><Trash2 size={18} /></button>}
      </div>
    </li>
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
            <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name.trim() !== recipe.name && void saved(db.recipes.put({ ...recipe, name: name.trim() }), t.toast.saved)}
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
            <button type="button" onClick={() => void saved(db.recipes.delete(recipe.id), t.toast.deleted(recipe.name), () => db.recipes.put(recipe))} className="min-h-tap rounded-xl bg-warn px-3 font-medium text-surface">{L.delete}</button>
            <button type="button" onClick={() => setAsking(false)} className="min-h-tap rounded-xl border border-line bg-surface px-3 text-ink">{t.backup.no}</button>
          </div>
        </div>
      )}
    </li>
  );
}
