// D90: Харчоблок's dish cards and substitutions from the shared snapshot — kept as reference, flagged unverified. They
// are not in the meal search (a card is a canteen portion: «Каша вівсяна на молоці» has 10 g of sugar and milk, which a
// home porridge may not) and never check a plan; «Мої страви» lists them by the plan's diet, marked «не перевірено».
import dishes from './harch/dishes.json';
import products from './harch/products.json';
import subs from './harch/substitutions.json';
import { HARCH_PRODUCT } from './harch/productMap';
import type { Food, MealItem } from '../domain/types';

export interface HarchDish { card: number; name: string; category: string; diets: string[]; outputG: number; items: MealItem[]; verified: false }
export interface HarchSubstitution { basis: 'protein' | 'carbs'; product: string; grams: number; substitute: string; substituteGrams: number; verified: false }

type RawDish = { card_no: number; name: string; category: string; diets: string[]; ingredients: { product: string; brutto_g: number; netto_g: number }[]; output_g: number };
const k = (per100: number | undefined, g: number) => Math.round(((per100 ?? 0) * g) / 10) / 10;
const HP = new Map((products as { name: string; protein: number; fat: number; carbs: number; kcal: number }[]).map((p) => [p.name, p]));

/** A card's ingredients as meal lines (net weight): this base's food where mapped, else Харчоблок's own numbers. */
export function harchDishes(foods: Map<string, Food>): HarchDish[] {
  return (dishes as RawDish[]).map((d) => ({
    card: d.card_no, name: d.name, category: d.category, diets: d.diets, outputG: d.output_g, verified: false,
    items: d.ingredients.filter((i) => i.netto_g > 0).map((i): MealItem => {
      const id = HARCH_PRODUCT[i.product], f = id ? foods.get(id) : undefined, p = HP.get(i.product);
      return f ? { foodId: f.id, name: f.name, grams: i.netto_g }
        : { name: i.product, grams: i.netto_g, manual: { kcal: k(p?.kcal, i.netto_g), protein: k(p?.protein, i.netto_g), fat: k(p?.fat, i.netto_g),
          carbs: k(p?.carbs, i.netto_g), calciumMg: 0 } }; // Харчоблок has no calcium — 0, not a guess
    }),
  }));
}

export const HARCH_SUBSTITUTIONS: HarchSubstitution[] = (subs as { basis: string; product: string; qty_g: number; substitute: string; substitute_qty_g: number }[])
  .map((s) => ({ basis: s.basis === 'carbs' ? 'carbs' : 'protein', product: s.product, grams: s.qty_g, substitute: s.substitute, substituteGrams: s.substitute_qty_g, verified: false }));
