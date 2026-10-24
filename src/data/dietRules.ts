// D90: what each diet of Наказ МОЗ №931 excludes or limits, in the form the meal check reads — written and checked by a
// dietitian, never by the model. A rule without `checkedBy` is kept here but never used to check food (like an unchecked
// diet). Харчоблок can read the same rules to see whether a fried dish got into a ЩД menu.
//
// A rule (R02, docs/diet-rules.md): { id (stable), version, kind: 'exclude' | 'limit' | 'note', title (what the person sees,
//   «без смаженого»), match: { cooking?, words?, tags? }, limit? ({ value, unit: 'g', per: 'day' } — a limit in words only is not
//   run), quote (the source's words), source (the order's clause), checkedBy, checkedAt }
//   cooking — Cooking values of a meal line («fried»); words — stems in the food's name («копчен»); tags — food tags («sweet»)
import type { DietRule } from '../domain/diets';

export const DIET_RULES: Record<string, DietRule[]> = {
  ОВД: [], ЩД: [], ВБД: [], НБД: [], НКД: [], '№9': [], '№1а': [], '№4': [],
};
