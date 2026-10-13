// D54: «+ Додати» inside one meal of a menu draft — the same search as «Записати їжу» (a food, a dish, or a phrase
// «2 яйця, кава» → several lines), and «Часто» before anything is typed. Stays open for a second line; «Готово» closes.
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { frequentItems } from '../domain/habits';
import { amountText, itemFor, parseQuery, recognize, searchFoods, splitPhrase } from '../domain/foodSearch';
import { dishItem } from '../domain/recipes';
import { todayISO } from '../domain/dates';
import type { Allergen, DayEntry, Food, MealItem, Recipe } from '../domain/types';
import { allergyHits } from '../domain/allergens';
import { t } from '../i18n/uk';

const L = t.picker;

export function ItemPicker({ foods, recipes, all, allergies = new Set(), onAdd, onClose }: {
  foods: Map<string, Food>; recipes: Recipe[]; all: DayEntry[]; allergies?: Set<Allergen>; onAdd: (items: MealItem[]) => void; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const freq = useMemo(() => frequentItems(all, todayISO()), [all]);
  const usual = useMemo(() => new Set(frequentItems(all, todayISO(), 60, 50).map((f) => f.item.recipe?.id ?? f.item.foodId ?? '')), [all]);
  const parsed = parseQuery(q);
  const list = [...foods.values()];
  const phrase = splitPhrase(q).length > 1 ? recognize(q, list, recipes, dishItem, usual).filter((r) => r.item) : null;
  const dishes = q.trim() && !phrase ? searchFoods(recipes, parsed.text, 3) : [];
  const matches = q.trim() && !phrase ? searchFoods(list, parsed.text, 6, usual) : [];
  const add = (items: MealItem[]) => { onAdd(items); setQ(''); };
  const row = 'flex min-h-tap w-full items-center justify-between gap-2 px-3 text-left';

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-accent/40 p-2">
      <label className="block"><span className="sr-only">{L.search}</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L.search} autoFocus autoComplete="off"
          className="block min-h-tap w-full rounded-xl border border-line bg-bg px-3" /></label>
      {phrase && phrase.length > 0 && (
        <button type="button" onClick={() => add(phrase.map((r) => r.item!))} className="min-h-tap w-full rounded-xl bg-accent px-3 text-left font-medium text-surface">
          {L.addAll(phrase.map((r) => `${r.item!.name} ${amountText(r.item!)}`).join(', '))}</button>
      )}
      {(dishes.length > 0 || matches.length > 0) && (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {dishes.map((r) => { const it = dishItem(r, parsed.qty ?? 1); return (
            <li key={r.id}><button type="button" className={row} onClick={() => add([it])}>
              <span>{r.name}</span><span className="tabular shrink-0 text-sm text-muted">{amountText(it)}</span></button></li>); })}
          {matches.map((f) => { const it = itemFor(f, parsed); return (
            <li key={f.id}><button type="button" className={row} onClick={() => add([it])}>
              <span>{f.name}{allergyHits(f, allergies).length > 0 && <span className="ml-2 text-sm font-medium text-warn">
                {t.allergen.badge(allergyHits(f, allergies).map((a) => t.allergen.name[a]).join(', '))}</span>}</span>
              <span className="tabular shrink-0 text-sm text-muted">{amountText(it)}</span></button></li>); })}
        </ul>
      )}
      {!q.trim() && freq.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {freq.slice(0, 8).map((f) => (
            <button key={f.item.name} type="button" onClick={() => add([f.item])} className="flex min-h-tap items-center gap-1 rounded-full border border-line px-3 text-sm">
              <Plus size={14} aria-hidden />{f.item.name} <span className="text-muted">· {amountText(f.item)}</span></button>
          ))}
        </div>
      )}
      <button type="button" onClick={onClose} className="min-h-tap px-1 text-accent">{L.done}</button>
    </div>
  );
}
