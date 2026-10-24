// D57: allergens of the built-in base by TYPICAL composition (a usual recipe, not a particular brand) — the package
// says what this one contains. Gluten: wheat, rye, barley, oats (oats count, as on labels). Milk: any milk protein —
// lactose-free milk and kefir included (lactose is a different matter). Dishes get theirs from their ingredients.
import type { Allergen } from '../domain/types';

const G: Allergen = 'gluten', M: Allergen = 'milk', E: Allergen = 'egg', F: Allergen = 'fish';

export const BASE_ALLERGENS: Record<string, Allergen[]> = {
  // gluten cereals and what is made of them
  oats: [G], 'oatmeal-water': [G], 'oatmeal-milk': [G, M], granola: [G, 'nuts'], 'bread-rye': [G], 'bread-white': [G], 'bread-wholegrain': [G], 'flour-wheat': [G], // D123
  'pasta-boiled': [G], 'pasta-dry': [G], 'barley-boiled': [G], 'bulgur-boiled': [G], 'couscous-boiled': [G], crispbread: [G], lavash: [G],
  'pie-cabbage': [G, E], croissant: [G, M, E], cookies: [G, M, E], wafers: [G, M, E], pancakes: [G, M, E], cheburek: [G],
  'vareniki-potato': [G, E], 'vareniki-cheese': [G, E, M], 'vareniki-cherry': [G, E], pelmeni: [G, E], 'mac-cheese': [G, M],
  cutlet: [G, E], meatballs: [G, E], 'chicken-cutlet-steamed': [G, E], deruny: [G, E], syrnyky: [G, M, E],
  shawarma: [G], pizza: [G, M], burger: [G], beer: [G], 'soy-sauce': ['soy', G],
  // milk
  kefir: [M], 'kefir-1': [M], parmesan: [M], 'yogurt-plain': [M], 'cottage-cheese': [M], 'cottage-cheese-0': [M], 'cottage-cheese-9': [M],
  milk: [M], 'lactose-free-milk': [M], 'sour-cream': [M], 'hard-cheese': [M], brynza: [M], butter: [M], ryazhanka: [M], ayran: [M],
  'greek-yogurt': [M], mozzarella: [M], feta: [M], 'processed-cheese': [M], 'cream-10': [M], 'coffee-milk': [M], 'cocoa-milk': [M],
  'rice-porridge-milk': [M], 'mashed-potato': [M], 'chocolate-milk': [M], candies: [M], 'ice-cream': [M], 'condensed-milk': [M],
  'glazed-curd': [M], pesto: [M, 'nuts'],
  // egg
  egg: [E], 'egg-boiled': [E], 'egg-fried': [E], 'quail-eggs': [E], mayonnaise: [E, 'mustard'],
  // fish and seafood
  sardines: [F], hake: [F], pollock: [F], salmon: [F], 'tuna-can': [F], 'herring-salted': [F], 'hake-baked': [F], 'salmon-baked': [F],
  'mackerel-baked': [F], 'mackerel-smoked': [F], sprats: [F], 'sushi-roll': [F, 'soy'], 'crab-sticks': [F, E, G], shrimp: ['crustaceans'],
  // nuts, peanut, seeds, legumes
  walnut: ['nuts'], almond: ['nuts'], cashew: ['nuts'], hazelnut: ['nuts'], peanut: ['peanut'], 'peanut-butter': ['peanut'],
  sesame: ['sesame'], hummus: ['sesame'],
  // the rest
  celery: ['celery'], mustard: ['mustard'], 'wine-dry': ['sulphites'], 'dried-apricots': ['sulphites'], raisins: ['sulphites'],
  balsamic: ['sulphites'],
};
