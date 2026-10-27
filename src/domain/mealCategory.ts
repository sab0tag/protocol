import { t } from '../i18n/uk';

export type MealCategory = 0 | 1 | 2 | 3;

export function mealCategoryFor(title: string, at: string): MealCategory {
  const normalized = title.trim().toLocaleLowerCase('uk');
  if (normalized.includes('снідан')) return 0;
  if (normalized.includes('обід')) return 1;
  if (normalized.includes('вечер')) return 2;
  if (normalized.includes('перекус')) return 3;

  const hour = new Date(at).getHours();
  return hour < 11 ? 0 : hour < 16 ? 1 : hour < 21 ? 2 : 3;
}

export function mealCategoryName(category: MealCategory): string {
  return t.meal.names[category]!;
}
