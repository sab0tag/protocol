// D183 («Очередь агента», task 8): the weight goal helper. The code counts every number — the model never does. Calories:
// Mifflin–St Jeor × an activity multiplier counted from numbers (steps a day, minutes of training a week — not a category),
// minus a deficit of 500–750 kcal, never below 1200 a day. The pace follows from the deficit, the goal date from the pace.
// Protein 1.2–1.6 g per kg; carbohydrates never above the plan's own limit. Stop conditions come first: with any of them no
// deficit is counted at all and the app says «ціль щодо ваги — спершу з лікарем». Everything set here is the person's own
// goal, never a doctor's prescription: a doctor's number always wins and is never overwritten. Pure; numbers are drafts by the
// spec's «Черновики норм» until a doctor (an endocrinologist or a dietitian) approves them.
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import type { GoalInput, ISODate, OwnGoal, Plan, WeightLog } from './types';
export type { GoalInput, OwnGoal } from './types';
import { weeklyWeights } from './progress';
import { NORMS } from './norms';

export const KCAL_FLOOR = NORMS.goal.kcalFloor; // D196: the drafts live in norms.ts
export const KCAL_PER_KG = 7700;
export const DEFICIT_DEFAULT = NORMS.goal.deficitDefault;

/** Mifflin–St Jeor, kcal a day at rest. */
export const bmr = (i: Pick<GoalInput, 'sex' | 'age' | 'heightCm' | 'weightKg'>) =>
  10 * i.weightKg + 6.25 * i.heightCm - 5 * i.age + (i.sex === 'male' ? 5 : -161);

/** The activity multiplier from numbers: 1.2 for sitting; +0.05 per 2500 steps over 3000 a day (up to +0.2); +0.03 per hour
 *  of training a week (up to +0.25). Not known — sitting (×1.2). Always said with why. */
export function multiplier(stepsPerDay?: number, trainingMinPerWeek?: number): { value: number; why: string } {
  const steps = stepsPerDay && stepsPerDay > 3000 ? Math.min(0.2, ((stepsPerDay - 3000) / 2500) * 0.05) : 0;
  const train = trainingMinPerWeek && trainingMinPerWeek > 0 ? Math.min(0.25, (trainingMinPerWeek / 60) * 0.03) : 0;
  const value = Math.round((1.2 + steps + train) * 100) / 100;
  const parts = [stepsPerDay === undefined ? 'кроки не вказано — рахуємо як сидячий день' : `${stepsPerDay} кроків на день`,
    trainingMinPerWeek ? `${trainingMinPerWeek} хв тренувань на тиждень` : 'без тренувань'];
  return { value, why: `×${String(value).replace('.', ',')}: ${parts.join(', ')}` };
}

// --------------------------------------------------------------- stop conditions
export type StopReason = 'glucose-lowering' | 'pregnancy' | 'bmi-low' | 'goal-bmi-low' | 'minor' | 'kidney-heart' | 'eating';
/** Insulin and medicines lowering sugar with a risk of hypoglycaemia (ATC A10A insulins, A10BB sulfonylureas, A10BX glinides),
 *  by the code or by the name/INN as written — a draft list for a doctor to approve. */
const HYPO_ATC = NORMS.stopMeds.glinides ? /^A10A|^A10BB|^A10BX0[23]/ : /^A10A|^A10BB/; // D196: glinides by caution, see norms.ts
const HYPO_NAMES = /інсулін|insulin|інсуман|лантус|туджео|левемір|новорапід|хумалог|апідра|актрапід|протафан|хумулін|тресіба|гліклазид|диабетон|діабетон|глімепірид|амарил|глібенкламід|манініл|гліпізид|гліквідон|репаглінід|натеглінід/iu;
const ORGANS = /нирк|ниркова|хзн|ххн|діаліз|серцев|серце|серцева недостатн|інфаркт|кардіо|почк|сердечн/iu;
const EATING = /переїда\S*.*(?:вин|сором)|(?:вин|сором)\S*.*переїда|блюю\S*\s+після\s+їжі|викликаю\s+блювоту|блювот\S*\s+після\s+їжі|голоду\S*\s+(?:по\s+)?\d+\s+дн|довго\s+голод|не\s+їм\s+(?:по\s+)?\d+\s+дн|компульсив|булімі|анорекс|переедан\S*.*вин|рвот\S*\s+после\s+еды|голодаю/iu;
export const eatingDistress = (text: string) => EATING.test(text);

export function stopReasons(plan: Pick<Plan, 'prescriptions' | 'constraints' | 'targets'> | undefined, i: Partial<GoalInput>, words = ''): StopReason[] {
  const out: StopReason[] = [];
  const meds = (plan?.prescriptions ?? []).filter((p) => p.kind === 'medication' && !(p.until && p.until < new Date().toISOString().slice(0, 10)));
  if (meds.some((p) => (p.med?.atc && HYPO_ATC.test(p.med.atc)) || HYPO_NAMES.test(`${p.title} ${p.med?.inn ?? ''} ${p.med?.name ?? ''}`))) out.push('glucose-lowering');
  if (i.pregnant) out.push('pregnancy');
  if (i.age !== undefined && i.age < 18) out.push('minor');
  const m = i.heightCm ? i.heightCm / 100 : 0;
  if (m && i.weightKg && i.weightKg / (m * m) < 18.5) out.push('bmi-low');
  if (m && i.goalKg && i.goalKg / (m * m) < 18.5) out.push('goal-bmi-low');
  if (plan?.targets.waterMaxMl || (plan?.constraints ?? []).some((c) => c.active && ORGANS.test(`${c.title} ${c.reason}`))) out.push('kidney-heart');
  if (eatingDistress(words)) out.push('eating');
  return out;
}

// --------------------------------------------------------------- the goal
export interface GoalPlan {
  bmr: number; multiplier: number; multiplierWhy: string; tdee: number;
  deficit: number; kcal: number; floored: boolean;
  /** kg a week the deficit gives */
  perWeekKg: number;
  /** weeks to the goal at that pace, and the date */
  weeks: number; goalDate: ISODate;
  proteinG: [number, number];
  /** the plan's own carbohydrate limit, if any — never above it */
  carbsMaxG?: number;
  /** a deficit under 500: the honest price of the pace */
  slow: boolean; firstVisibleWeeks: number;
}

const r10 = (n: number) => Math.round(n / 10) * 10;
export function goalPlan(i: GoalInput, plan: Pick<Plan, 'targets'> | undefined, today: ISODate): GoalPlan {
  const b = bmr(i), m = multiplier(i.stepsPerDay, i.trainingMinPerWeek), tdee = b * m.value;
  const wanted = Math.min(NORMS.goal.deficitKcal[1], Math.max(0, Math.round(i.deficit ?? DEFICIT_DEFAULT)));
  const kcal = Math.max(KCAL_FLOOR, r10(tdee - wanted));
  const deficit = Math.max(0, Math.round(tdee - kcal));
  // the pace never faster than 1 kg a week (750 a day is ≈ 0.7; the floor can only make it slower)
  const perWeekKg = Math.min(1, Math.round(((deficit * 7) / KCAL_PER_KG) * 100) / 100);
  const toLose = Math.max(0, i.weightKg - i.goalKg);
  const weeks = perWeekKg > 0 ? Math.ceil(toLose / perWeekKg) : 0;
  // a loss below the week-to-week swing of the scale (≈ 0.5 kg) is seen only after a few weeks
  const firstVisibleWeeks = perWeekKg > 0 ? Math.max(1, Math.ceil(1.5 / perWeekKg)) : 0;
  return {
    bmr: Math.round(b), multiplier: m.value, multiplierWhy: m.why, tdee: Math.round(tdee), deficit, kcal, floored: kcal === KCAL_FLOOR && tdee - wanted < KCAL_FLOOR,
    perWeekKg, weeks, goalDate: format(addDays(parseISO(today), weeks * 7), 'yyyy-MM-dd'),
    proteinG: [Math.round(NORMS.goal.proteinPerKg[0] * i.weightKg), Math.round(NORMS.goal.proteinPerKg[1] * i.weightKg)],
    ...(plan?.targets.carbsG?.max !== undefined ? { carbsMaxG: plan.targets.carbsG.max } : {}),
    slow: deficit < 500, firstVisibleWeeks,
  };
}

/** «Чому 1850 ккал» — said by the code, with the code's numbers. */
export function explain(g: GoalPlan): string[] {
  const n = (x: number) => String(x).replace('.', ',');
  return [
    `У спокої організм витрачає близько ${g.bmr} ккал на день (формула Міффліна — Сан-Жеора).`,
    `З вашою активністю — ${g.multiplierWhy} — це близько ${g.tdee} ккал.`,
    `Мінус ${g.deficit} ккал на день — ${g.kcal} ккал${g.floored ? ` (не нижче ${KCAL_FLOOR})` : ''}.`,
    `Це близько ${n(g.perWeekKg)} кг на тиждень; до цілі — ${g.weeks} тиж.`,
    ...(g.slow ? [`${n(g.perWeekKg)} кг/тиж — менше, ніж коливання ваги; перший результат побачите через ~${g.firstVisibleWeeks} тижнів.`] : []),
    `Білок — ${g.proteinG[0]}–${g.proteinG[1]} г на день (1,2–1,6 г на кг); діапазон варто підтвердити в лікаря.`,
    ...(g.carbsMaxG !== undefined ? [`Вуглеводи — не більше ${g.carbsMaxG} г, як у вашому плані.`] : []),
  ];
}

// --------------------------------------------------------------- later: recount and plateau

/** Two weeks since it was set and a weighing since — «оновити?», never by itself. */
export function recountDue(g: OwnGoal, weights: WeightLog[], today: ISODate): WeightLog | null {
  if (differenceInCalendarDays(parseISO(today), parseISO(g.setAt)) < 14) return null;
  const last = [...weights].filter((w) => w.date > g.setAt).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  return last && Math.abs(last.kg - g.input.weightKg) >= 0.1 ? last : null;
}

/** The weekly average has not gone down for three weeks: first the record and the activity, then — maybe — the calories. */
export function plateau(weights: WeightLog[]): boolean {
  const weeks = weeklyWeights(weights);
  if (weeks.length < 4) return false;
  const last = weeks.slice(-4);
  return last[3]!.kg >= last[0]!.kg - 0.2;
}
