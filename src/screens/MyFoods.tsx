import { SceneHeader } from '../components/SceneHeader';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { AllergenPicker } from '../components/AllergenPicker';
import { LabelScan } from '../components/LabelScan';
import { Loading } from '../components/Recovery';
import { saved } from '../components/Toast';
import { db } from '../data/db';
import { useFoods } from '../data/queries';
import { detachFood } from '../domain/recipes';
import type { Food } from '../domain/types';
import { t } from '../i18n/uk';
import { Link } from 'react-router-dom';

const L = t.dishes;

export function MyFoods() {
  const foods = useFoods();
  if (!foods) return <Loading />;
  const mine = [...foods.values()].filter((food) => food.custom).sort((a, b) => a.name.localeCompare(b.name, 'uk'));

  return (
    <section className="space-y-4 pt-4">
      <Link to="/dishes" className="inline-flex min-h-tap items-center text-sm text-muted">{t.dishes.title}</Link>
      <SceneHeader title={L.foods} />
      <p className="text-sm text-muted">{L.foodsHint}</p>
      <LabelScan />
      {mine.length === 0
        ? <p className="text-muted">{L.foodsEmpty}</p>
        : <ul className="space-y-3">{mine.map((food) => <FoodCard key={food.id} food={food} />)}</ul>}
    </section>
  );
}

async function removeFood(food: Food) {
  await db.transaction('rw', db.entries, db.recipes, db.foods, async () => {
    for (const entry of await db.entries.filter((entry) => !!entry.items?.length).toArray()) {
      const result = detachFood(entry.items!, food);
      if (result.changed) await db.entries.put({ ...entry, items: result.items });
    }
    for (const recipe of await db.recipes.toArray()) {
      const result = detachFood(recipe.items, food);
      if (result.changed) await db.recipes.put({ ...recipe, items: result.items });
    }
    await db.foods.delete(food.id);
  });
}

function FoodCard({ food }: { food: Food }) {
  const [edited, setEdited] = useState(food);
  const [asking, setAsking] = useState(false);
  const num = (value: string) => Math.max(0, Number(value.replace(',', '.')) || 0);
  const fields: [keyof Food['per100g'], string][] = [['kcal', 'ккал'], ['protein', 'Б'], ['fat', 'Ж'], ['carbs', 'В']];
  const changed = JSON.stringify(edited) !== JSON.stringify(food);

  return (
    <li className="space-y-2 protocol-card rounded-2xl border border-line bg-surface p-3">
      <input value={edited.name} onChange={(e) => setEdited({ ...edited, name: e.target.value })} aria-label={L.rename}
        className="block min-h-tap w-full rounded-xl border border-line bg-bg px-3 font-semibold" />
      <div className="grid grid-cols-4 gap-2">
        {fields.map(([key, label]) => (
          <label key={key} className="block"><span className="text-xs text-muted">{label} / 100 г</span>
            <input inputMode="decimal" value={String(edited.per100g[key] ?? 0)}
              onChange={(e) => setEdited({ ...edited, per100g: { ...edited.per100g, [key]: num(e.target.value) } })}
              className="block min-h-tap w-full rounded-xl border border-line bg-bg px-2" /></label>
        ))}
      </div>
      <AllergenPicker value={edited.allergens ?? []} onChange={(allergens) => setEdited({ ...edited, allergens })} />
      <div className="flex gap-2">
        <button type="button" disabled={!changed || !edited.name.trim()}
          onClick={() => void saved(db.foods.put({ ...edited, name: edited.name.trim() }), t.toast.saved)}
          className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface disabled:opacity-40">{L.save}</button>
        {asking
          ? <button type="button" onClick={() => void saved(removeFood(food), t.toast.deleted(food.name))}
              className="min-h-tap rounded-xl bg-warn px-3 font-medium text-surface">{L.confirmDelete(food.name)}</button>
          : <button type="button" onClick={() => setAsking(true)} aria-label={`${L.delete}: ${food.name}`}
              className="flex min-h-tap min-w-tap items-center justify-center rounded-xl border border-line text-warn"><Trash2 size={18} /></button>}
      </div>
    </li>
  );
}
