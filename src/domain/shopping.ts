// «Що купити» (SPEC.md D37): the planned meals of a few days → one list. Pure. Cooked foods are bought raw or dry,
// so «Гречка варена 600 г» becomes «Гречка (суха) ≈ 220 г»; pieces are counted in pieces; seasonings go apart.
import type { DayEntry, Food, MealItem } from './types';

/** cooked id → what to buy and how much of it makes 1 g cooked */
const RAW: Record<string, [string, number]> = {
  'buckwheat-boiled': ['Гречка (суха)', 0.37], 'brown-rice-boiled': ['Рис бурий (сухий)', 0.4], 'white-rice-boiled': ['Рис білий (сухий)', 0.36],
  'quinoa-boiled': ['Кіноа (суха)', 0.37], 'pasta-boiled': ['Макарони (сухі)', 0.45], 'oatmeal-water': ['Вівсяні пластівці (сухі)', 0.2],
  'potato-boiled': ['Картопля (сира)', 1], 'mashed-potato': ['Картопля (сира)', 0.85], 'beans-boiled': ['Квасоля (суха)', 0.4],
  'lentils-boiled': ['Сочевиця (суха)', 0.4], 'egg-boiled': ['Яйце куряче', 1], 'chicken-breast-cooked': ['Куряче філе (сире)', 1.35],
};

export interface ShoppingRow { key: string; name: string; grams: number; amount: string; pantry: boolean }

const flat = (items: MealItem[] = []): MealItem[] => items.flatMap((it) => (it.components?.length ? flat(it.components) : [it]));

export function shoppingList(entries: DayEntry[], foods: Map<string, Food>, from: string, to: string): ShoppingRow[] {
  const byName = new Map([...foods.values()].map((f) => [f.name, f]));
  const sum = new Map<string, { name: string; grams: number; pantry: boolean }>();
  for (const e of entries) {
    const d = e.at.slice(0, 10);
    if (e.kind !== 'meal' || e.status !== 'planned' || d < from || d > to) continue;
    for (const it of flat(e.items)) {
      const food = it.foodId ? foods.get(it.foodId) : undefined;
      const raw = it.foodId ? RAW[it.foodId] : undefined;
      const name = raw ? raw[0] : food?.name ?? it.name;
      const grams = it.grams * (raw ? raw[1] : 1);
      const pantry = !!food?.tags.some((t) => t === 'condiment' || t === 'fat');
      const row = sum.get(name) ?? { name, grams: 0, pantry };
      row.grams += grams;
      sum.set(name, row);
    }
  }
  return [...sum.values()].map((r) => {
    const piece = byName.get(r.name)?.units?.find((u) => u.name === 'шт');
    const g = Math.ceil(r.grams / 10) * 10;
    const amount = piece ? `${Math.ceil(r.grams / piece.grams)} шт` : g >= 1000 ? `${(g / 1000).toFixed(1).replace('.', ',')} кг` : `${g} г`;
    return { key: r.name, name: r.name, grams: Math.round(r.grams), amount, pantry: r.pantry };
  }).sort((a, b) => Number(a.pantry) - Number(b.pantry) || a.name.localeCompare(b.name, 'uk'));
}

export const shoppingText = (rows: ShoppingRow[], done: ReadonlySet<string>) =>
  rows.filter((r) => !done.has(r.key)).map((r) => `☐ ${r.name} — ${r.amount}`).join('\n');
