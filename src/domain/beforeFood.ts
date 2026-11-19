// D192 («Очередь агента», задача 13.2): «Натщесерце → їжа». A medicine taken on an empty stomach, once marked, tells the
// breakfast tile how long to wait: «Сніданок через 25 хв» when the plan or the leaflet gives the minutes (the person types them —
// never filled in by the app), else «натщесерце, до їжі» for two hours. Breakfast written — nothing.
import { mealCategoryFor } from './mealCategory';
import type { DayEntry, Plan } from './types';

export interface BeforeFood { title: string; minutes?: number }
const QUIET_MS = 2 * 3_600_000;

export function beforeFood(plan: Pick<Plan, 'prescriptions'> | undefined, day: readonly DayEntry[], now: Date): BeforeFood | null {
  if (day.some((e) => e.kind === 'meal' && e.status === 'done' && mealCategoryFor(e.title, e.at) === 0)) return null;
  const fasting = new Map((plan?.prescriptions ?? []).filter((p) => (p.kind === 'medication' || p.kind === 'supplement') && p.schedule?.withFood === false && !p.asNeeded)
    .map((p) => [p.id, p]));
  const marks = day.filter((e) => e.kind === 'med' && e.status === 'done' && e.prescriptionId && fasting.has(e.prescriptionId) && !e.timeUnknown)
    .map((e) => ({ e, p: fasting.get(e.prescriptionId!)!, t: Date.parse(e.at) })).filter((x) => x.t <= now.getTime())
    .sort((a, b) => b.t - a.t);
  for (const { p, t } of marks) {
    if (p.beforeFoodMin && p.beforeFoodMin > 0) {
      const left = Math.ceil((t + p.beforeFoodMin * 60_000 - now.getTime()) / 60_000);
      if (left > 0) return { title: p.title, minutes: left };
    } else if (now.getTime() - t < QUIET_MS) return { title: p.title };
  }
  return null;
}
