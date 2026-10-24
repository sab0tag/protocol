import { breakdown, type DishResult } from './dishBreakdown';
import { lineNutrients, normalize } from './nutrition';
import { EST_TAGS, type Food, type Recipe } from './types';

export const MAX_DISHES = 200;
export const MAX_DISH_TEXT = 12000;
export const MAX_DISH_FILE = 2000000;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;

/** Shared portable format: no database ids, per-100-g estimates and provenance survive a round trip. */
export function readDishList(value: unknown): DishResult[] {
  const rows = Array.isArray(value) ? value : object(value) && value.format === 'protocol-dishes' && value.version === 1 ? value.dishes : null;
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_DISHES) throw new Error(`Потрібен список від 1 до ${MAX_DISHES} страв.`);
  return rows.map((row, i) => {
    const fail = () => { throw new Error(`Страва ${i + 1}: перевірте назву, порції, інгредієнти та КБЖУ на 100 г.`); };
    if (!object(row) || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 200 || row.readable !== true ||
      !number(row.portions, 100) || (row.portions as number) < 1 || typeof row.note !== 'string' || row.note.length > 2000 ||
      !Array.isArray(row.items) || !row.items.length || row.items.length > 40) return fail();
    for (const x of row.items) {
      if (!object(x) || typeof x.said !== 'string' || !x.said.trim() || x.said.length > 200 || typeof x.base !== 'string' || x.base.length > 200 ||
        typeof x.amountSaid !== 'boolean' || !number(x.grams, 3000) || !(x.grams as number > 0) ||
        (x.calciumMg !== undefined && !number(x.calciumMg, 10000)) || !number(x.kcal, 900) || !number(x.protein, 100) || !number(x.fat, 100) || !number(x.carbs, 100) ||
        [x.tags, x.allergens].some((a) => a !== undefined && (!Array.isArray(a) || a.length > 20 || a.some((v) => typeof v !== 'string')))) return fail();
    }
    // Rebuild through the checked domain conversion before anything reaches the database.
    return { readable: true, name: row.name.trim(), portions: row.portions as number, note: row.note,
      items: row.items.map((x) => ({ said: x.said, base: x.base, grams: x.grams, amountSaid: x.amountSaid,
        kcal: x.kcal, protein: x.protein, fat: x.fat, carbs: x.carbs, ...(x.calciumMg !== undefined ? { calciumMg: x.calciumMg } : {}),
        ...(x.tags ? { tags: x.tags } : {}), ...(x.allergens ? { allergens: x.allergens } : {}) })) } as DishResult;
  });
}

export function exportDishList(recipes: Recipe[], foods: Map<string, Food>): string {
  const dishes: DishResult[] = recipes.map((r) => ({ readable: true, name: r.name, portions: 1, note: '', items: r.items.map((it) => {
    const n = lineNutrients(it, foods), k = it.grams > 0 ? 100 / it.grams : 0;
    return { said: it.name, base: it.foodId && foods.has(it.foodId) ? foods.get(it.foodId)!.name : '', grams: it.grams,
      amountSaid: true, kcal: n.kcal * k, protein: n.protein * k, fat: n.fat * k, carbs: n.carbs * k,
      calciumMg: n.calciumMg * k,
      tags: it.est?.tags ?? (it.foodId ? foods.get(it.foodId)?.tags.filter((t) => (EST_TAGS as readonly string[]).includes(t)) ?? [] : []),
      allergens: it.est?.allergens ?? (it.foodId ? foods.get(it.foodId)?.allergens ?? [] : []) };
  }) }));
  return JSON.stringify({ format: 'protocol-dishes', version: 1, dishes }, null, 2);
}

export const dishName = (name: string) => normalize(name).trim();
export const dishListLines = (rows: DishResult[], foods: Food[]) => rows.map((r) => ({ name: r.name, portions: r.portions, note: r.note, lines: breakdown(r, foods) }));
