// D89 (step 4 groundwork): a medicine of the plan and a food that bears on it — only from a table a pharmacist or a doctor
// has checked against the medicine's instruction. A row without `checkedBy` is never shown; the model never adds or
// completes a pair. The note is information beside the plan's flags, not a ban: «запитайте лікаря, якщо їсте його часто».
import { flatItems } from './rules';
import type { Food, MealItem, Prescription } from './types';

export type FoodGroup = 'grapefruit' | 'dairy' | 'calcium' | 'coffee' | 'vitk' | 'tyramine';
export interface MedFoodPair {
  inn: string; // as in the register, Latin («Atorvastatin»)
  food: FoodGroup;
  kind: 'avoid' | 'separate' | 'steady'; // уникати · рознести в часі · тримати рівно
  hours?: number; // for «separate»
  quote: string; // the instruction's own words
  instruction?: string; // where the quote is from
  checkedBy?: string; // who checked it against the instruction — required to be shown
  checkedAt?: string;
}

/** Candidates from the TZ of 18.10.2026 — each waits for a quote and a pharmacist's check; until then they stay hidden. */
export const MED_FOOD: MedFoodPair[] = [
  { inn: 'Atorvastatin', food: 'grapefruit', kind: 'avoid', quote: '' },
  { inn: 'Simvastatin', food: 'grapefruit', kind: 'avoid', quote: '' },
  { inn: 'Warfarin', food: 'vitk', kind: 'steady', quote: '' },
  { inn: 'Levothyroxine sodium', food: 'calcium', kind: 'separate', hours: 4, quote: '' },
  { inn: 'Levothyroxine sodium', food: 'coffee', kind: 'separate', hours: 1, quote: '' },
  { inn: 'Ferrous sulfate', food: 'dairy', kind: 'separate', hours: 2, quote: '' },
  { inn: 'Doxycycline', food: 'dairy', kind: 'separate', hours: 2, quote: '' },
  { inn: 'Ciprofloxacin', food: 'dairy', kind: 'separate', hours: 2, quote: '' },
];

const GROUP: Record<FoodGroup, (name: string, food: Food | undefined) => boolean> = {
  grapefruit: (n) => /грейпфрут/i.test(n),
  dairy: (n, f) => !!f?.allergens?.includes('milk') || /молок|кефір|йогурт|сир\b|сирок|ряжанк/i.test(n),
  calcium: (n, f) => !!f?.tags.includes('calcium') || GROUP.dairy(n, f),
  coffee: (n) => /кав[аиу]|еспресо|капучино|лате/i.test(n),
  vitk: (n) => /шпинат|броколі|капуст|кейл|петрушк|кріп|зелень|руккол|салат листов/i.test(n),
  tyramine: (n) => /витриман|пармезан|ковбас|салямі|квашен|соєв(ий|ого) соус/i.test(n),
};

export interface MedFoodNote { medicine: string; food: string; pair: MedFoodPair; quote: string }

/** Notes for the lines of a meal against the plan's medicines — checked rows only. */
export function medFoodNotes(prescriptions: Prescription[], items: MealItem[], foods: Map<string, Food>, table = MED_FOOD): MedFoodNote[] {
  const out: MedFoodNote[] = [];
  for (const p of prescriptions) {
    const inn = p.med?.inn?.toLowerCase();
    if (!inn) continue;
    for (const pair of table) {
      if (!pair.checkedBy || !pair.quote || pair.inn.toLowerCase() !== inn) continue;
      for (const it of flatItems(items)) {
        if (GROUP[pair.food](it.name, it.foodId ? foods.get(it.foodId) : undefined)) out.push({ medicine: p.title, food: it.name, pair, quote: pair.quote });
      }
    }
  }
  return out;
}
