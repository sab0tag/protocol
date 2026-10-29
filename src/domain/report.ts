// «Звіт для лікаря» (SPEC.md §5.8). Pure: everything comes in, numbers come out.
import { weightQuality } from './weightQuality';
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import { buildChecklist } from './checklist';
import { dateOf, isPast } from './dates';
import { dayFlags, type HabitKey } from './habits';
import { dietConflicts } from './diets';
import { medFoodNotes } from './medFood';
import { t } from '../i18n/uk';
import { prnReport, type PrnLine } from './prn';
import { evaluate } from './evaluate';
import { coincidenceText } from './symptoms';
import { observedCoincidences, pace, weeklyWeights, wellbeingCoincidences } from './progress';
import type { DailyLimit, DayEntry, Food, ISODate, LabResult, Plan, WeightLog, Wellbeing, Workout } from './types';
import { neutralDay, observedPlannedEntry, observedToday, trackingInfo, type Observation, type TrackingInfo, type TrackingKey } from './observation';
import { lightDayHistory, type LightDayHistory } from './lightDay';

export interface Report {
  from: ISODate;
  to: ISODate;
  days: number;
  checklistPct?: number; // ticks done / due over the days that had a checklist
  weightPending?: number;
  weightStart?: number;
  weightNow?: number;
  workouts: number;
  avgEnergy?: number;
  symptoms: { name: string; count: number }[];
  /** D59: symptom and food coincidences, as counted — not a conclusion */
  coincidences: string[];
  questions: string[];
  /** D40: the pace of the weight over the period, kg a week, and the plan's limit */
  weightPace?: number;
  maxLossPerWeek?: number;
  /** D40: of the days with entries, how many met each target */
  habits: { key: HabitKey; met: number; of: number }[];
  /** D40: meals from «Меню на завтра» in the period that are past: eaten, skipped, not marked */
  menu?: { done: number; skipped: number; open: number };
  /** D79 «Головне»: doses due on days with records; absence of a mark is never an explicit skip. */
  meds?: { taken: number; due: number; missed: { title: string; count: number }[]; unmarked?: number;
    /** D89: each medicine — the trade name, its INN from the register, the dose as prescribed, doses taken of due */
    list: { title: string; inn?: string; dose?: string; taken: number; due: number }[] };
  /** D79: eaten meals the plan's check would have changed («замінити» / «прибрати»), by the doctor's limit */
  deviations?: { meals: number; of: number; by: { title: string; count: number }[] };
  /** D79: lab results in the period, the latest first */
  labs: LabResult[];
  /** D90: a doctor's target outside the chosen diet's norm — a question for the visit, never settled silently */
  dietQuestions: string[];
  /** D89 step 4: meals that met a medicine of the plan, by the checked table */
  medFood: number;
  /** D118: medicines «за потреби» — how often, and the days over the doctor's daily limit */
  prn: PrnLine[];
  tracking?: TrackingInfo;
  observed?: { workout: boolean; weight: boolean; wellbeing: boolean };
  unscoredMedMarks?: number;
  lightDays?: LightDayHistory;
  lightDayWorkouts?: number;
}

export function buildReport(args: {
  from: ISODate; to: ISODate; plan: Plan | undefined; entries: DayEntry[]; workouts: Workout[]; wellbeing: Wellbeing[];
  weights: WeightLog[]; foods: Map<string, Food>; labs?: LabResult[]; now?: Date;
  observation?: Observation;
}): Report {
  const { from, plan, entries, workouts, wellbeing, weights, foods, labs = [], observation, now = observation?.now ?? new Date() } = args;
  const to = observation && args.to > observedToday(observation) ? observedToday(observation) : args.to;
  const today = format(now, 'yyyy-MM-dd'), hm = format(now, 'HH:mm');
  let taken = 0, due = 0, unmarked = 0;
  const missed = new Map<string, number>();
  const perMed = new Map<string, { taken: number; due: number }>();
  const countedMarks = new Set<string>();
  let devMeals = 0, eatenMeals = 0;
  const devBy = new Map<string, number>();
  const inside = (d: ISODate) => d >= from && d <= to;
  const days = Math.max(0, differenceInCalendarDays(parseISO(to), parseISO(from)) + 1);

  let done = 0, total = 0;
  const hab = new Map<HabitKey, { met: number; of: number }>();
  for (let i = 0; i < days; i++) {
    const d = format(addDays(parseISO(from), i), 'yyyy-MM-dd');
    const day = entries.filter((e) => dateOf(e.at) === d);
    const c = buildChecklist({ plan, date: d, entries: day, workouts, foods, now: new Date(`${d}T23:59:00`), observation });
    done += c.done; total += c.total;
    if (!day.length) continue;
    for (const i of c.items) { // D79: doses — days without records are not counted as missed
      if (i.kind !== 'med' || (d === today && !i.done && (!i.time || i.time > hm))) continue;
      due += 1;
      if (i.done) taken += 1;
      else if (i.skipped) missed.set(i.title, (missed.get(i.title) ?? 0) + 1);
      else unmarked += 1;
      if (i.done) for (const e of day) if (e.kind === 'med' && e.status === 'done' && e.checkKey === i.key) countedMarks.add(e.id);
      const m = perMed.get(i.prescriptionId ?? i.title) ?? { taken: 0, due: 0 };
      m.due += 1; if (i.done) m.taken += 1;
      perMed.set(i.prescriptionId ?? i.title, m);
    }
    if (plan && !(observation && neutralDay(observation, 'food', d))) for (const m of day.filter((e) => e.kind === 'meal' && e.status === 'done' && e.items?.length)) {
      eatenMeals += 1;
      // R03: an eaten meal against what else was eaten that day (not what was only planned) and the week before
      const { checks } = evaluate({ plan, date: d, foods, entries, exclude: m.id, intent: 'recorded', meal: m.items! });
      const tags = new Set(checks.flatMap((c) => c.hits).filter((h) => h.verdict === 'replace' || h.verdict === 'remove').map((h) => h.reason));
      if (!tags.size) continue;
      devMeals += 1;
      for (const tag of tags) {
        const title = plan.constraints.find((c) => c.tag === tag)?.title ?? tag;
        devBy.set(title, (devBy.get(title) ?? 0) + 1);
      }
    }
    for (const [k, ok] of Object.entries(dayFlags(plan, day, d, workouts, foods, observation)) as [HabitKey, boolean][]) {
      const h = hab.get(k) ?? { met: 0, of: 0 };
      h.of += 1; if (ok) h.met += 1;
      hab.set(k, h);
    }
  }
  const menuMeals = entries.filter((e) => e.menu && e.kind === 'meal' && inside(dateOf(e.at)) && isPast(e.at)
    && !(observation && neutralDay(observation, 'food', dateOf(e.at))) && observedPlannedEntry(observation, e)); // recorded facts remain; proposals need observed food + menu; a light day's food is outside scoring
  const quality = weightQuality(weights, format(now, 'yyyy-MM-dd'));
  const w = quality.accepted.filter((x) => inside(x.date));
  const weightPending = quality.pending.filter((x) => inside(x.record.date)).length;
  const scored = wellbeing.filter((x) => inside(x.date) && x.energy != null);
  const counts = new Map<string, number>();
  for (const x of wellbeing.filter((y) => inside(y.date))) for (const s of x.symptoms) counts.set(s, (counts.get(s) ?? 0) + 1);
  // D56: «Мені погано» with its time counts too
  for (const e of entries.filter((y) => y.kind === 'symptom' && inside(dateOf(y.at)))) for (const s of e.symptoms ?? []) counts.set(s, (counts.get(s) ?? 0) + 1);

  const hasPeriod = (key: TrackingKey) => !observation || trackingInfo(observation, from, to, [key]).intervals.length > 0;
  const keys: TrackingKey[] = [];
  const facts = entries.filter((e) => inside(dateOf(e.at)) && e.status !== 'planned');
  if (plan?.prescriptions.some((p) => p.kind === 'medication' || p.kind === 'supplement') || facts.some((e) => e.kind === 'med')) keys.push('meds');
  if (plan?.targets.waterMl || facts.some((e) => e.kind === 'water')) keys.push('water');
  if (plan?.constraints.some((c) => c.active) || plan?.targets.proteinG || plan?.targets.carbsG || facts.some((e) => e.kind === 'meal')) keys.push('food');
  if (menuMeals.length) keys.push('menu');
  if ((observation && hasPeriod('workout')) || workouts.some((w) => inside(w.date))) keys.push('workout');
  if (wellbeing.some((w) => inside(w.date))) keys.push('wellbeing');
  if (plan?.targets.weightGoalKg || w.length) keys.push('weight');
  const tracking = observation ? trackingInfo(observation, from, to, keys) : undefined;
  const unscoredMedMarks = observation ? facts.filter((e) => e.kind === 'med' && e.status === 'done' && !countedMarks.has(e.id)
    && !plan?.prescriptions.find((p) => p.id === e.prescriptionId)?.asNeeded).length : 0;

  return {
    from, to, days,
    ...(observation && !observation.demo ? { lightDays: lightDayHistory(observation.events, from, to, observation.now),
      lightDayWorkouts: workouts.filter((w) => inside(w.date) && neutralDay(observation, 'workout', w.date)).length } : {}),
    ...(tracking ? { tracking, observed: { workout: hasPeriod('workout') || workouts.some((w) => inside(w.date)),
      weight: w.length > 0, wellbeing: scored.length > 0 } } : {}),
    ...(unscoredMedMarks ? { unscoredMedMarks } : {}),
    ...(total ? { checklistPct: Math.round((done / total) * 100) } : {}),
    ...(weightPending ? { weightPending } : {}),
    ...(w.length ? { weightStart: w[0]!.kg, weightNow: w.at(-1)!.kg } : {}),
    // D81: weekly averages over the period — the same count as «Прогрес», not first-to-last weighing
    ...(pace(weeklyWeights(w), Infinity) !== undefined ? { weightPace: pace(weeklyWeights(w), Infinity)! } : {}),
    ...(plan?.targets.maxWeightLossKgPerWeek != null ? { maxLossPerWeek: plan.targets.maxWeightLossKgPerWeek } : {}),
    habits: (['protein', 'carbs', 'water', 'meds', 'plan'] as HabitKey[]).flatMap((key) => { const h = hab.get(key); return h ? [{ key, ...h }] : []; }),
    ...(menuMeals.length ? { menu: { done: menuMeals.filter((e) => e.status === 'done').length,
      skipped: menuMeals.filter((e) => e.status === 'skipped').length, open: menuMeals.filter((e) => e.status === 'planned').length } } : {}),
    workouts: workouts.filter((x) => inside(x.date) && !(observation && neutralDay(observation, 'workout', x.date))).length,
    ...(scored.length ? { avgEnergy: Math.round((scored.reduce((a, x) => a + (x.energy ?? 0), 0) / scored.length) * 10) / 10 } : {}),
    symptoms: [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    coincidences: [...observedCoincidences(entries.filter((e) => inside(dateOf(e.at))), foods, observation).map(coincidenceText),
      ...wellbeingCoincidences(entries.filter((e) => inside(dateOf(e.at))), wellbeing.filter((x) => inside(x.date)), foods, plan, observation).map((p) => p.text)], // D71
    questions: plan?.questions ?? [],
    ...(due ? { meds: { taken, due, unmarked, missed: [...missed.entries()].map(([title, count]) => ({ title, count })).sort((a, b) => b.count - a.count),
      list: [...perMed.entries()].map(([key, n]) => {
        const p = plan?.prescriptions.find((x) => x.id === key);
        return { title: p?.title ?? key, ...(p?.med?.inn ? { inn: p.med.inn } : {}), ...(p?.dose ? { dose: p.dose } : {}), ...n };
      }) } } : {}),
    ...(eatenMeals ? { deviations: { meals: devMeals, of: eatenMeals, by: [...devBy.entries()].map(([title, count]) => ({ title, count })).sort((a, b) => b.count - a.count) } } : {}),
    medFood: plan ? entries.filter((e) => e.kind === 'meal' && e.status === 'done' && e.items?.length && inside(dateOf(e.at))).filter((m) => medFoodNotes(plan.prescriptions, m.items!, foods, {
      mealAt: m.at, doses: new Map(plan.prescriptions.map((p) => [p.id, entries.filter((e) => e.kind === 'med' && e.status === 'done' && e.prescriptionId === p.id && !e.timeUnknown && dateOf(e.at) === dateOf(m.at)).map((e) => e.at)])) }).length > 0).length : 0,
    prn: prnReport(plan, entries, from, to),
    dietQuestions: plan ? dietConflicts(plan).map((x) => t.diet.conflict(x.code, t.diet.fields[x.field], x.target, x.range[0], x.range[1])) : [],
    labs: labs.filter((l) => inside(l.date)).sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name)),
  };
}

const dec = (n: number) => String(n).replace('.', ',');
/** R01: «не більше 4 табл. на добу» — a limit in its own unit; one of unknown unit is said without one */
export const prnLimitText = (l: DailyLimit) => t.prn.limitText(dec(l.value), t.prn.units[l.unit] ?? '');
export const prnAmountText = (qty: number, unit: string) => `${dec(qty)} ${t.prn.units[unit] ?? ''}`.trim();
const HABIT: Record<HabitKey, string> = { protein: 'Білок ≥ 90 % цілі', carbs: 'Вуглеводи в межах', water: 'Вода — норма', meds: 'Ліки — усі належні дози відмічено', plan: 'План дня ≥ 80 %' };
export const habitLabel = (k: HabitKey) => HABIT[k];
const TRACKING_LABEL: Record<TrackingKey, string> = { meds: 'Ліки', water: 'Запис води', food: 'Запис їжі', menu: 'Меню',
  assistant: 'Помічник', wellbeing: 'Самопочуття', workout: 'Тренування', progress: 'Прогрес', weight: 'Вага' };
export function trackingLines(info: TrackingInfo): string[] {
  const stamp = (at: string) => format(parseISO(at), 'dd.MM.yyyy HH:mm');
  return [
    ...info.intervals.map((p) => `${TRACKING_LABEL[p.key]}: ${p.since ? `увімкнено з ${stamp(p.since)}; ` : ''}облік у звіті ${stamp(p.from)} — ${stamp(p.to)}${p.unknownStart ? '; точна дата початку невідома' : ''}.`),
    ...(info.unknown.length ? [`Початок спостереження невідомий: ${info.unknown.map((key) => TRACKING_LABEL[key]).join(', ')}.`] : []),
    ...info.disabled.map((key) => `${TRACKING_LABEL[key]}: у вибраному періоді спостереження вимкнено.`),
  ];
}
export const unscoredMedText = (n: number) => {
  const word = n % 10 === 1 && n % 100 !== 11 ? 'відмітку' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'відмітки' : 'відміток';
  return `Окремо збережено ${n} ${word} ліків поза відомими періодами обліку; частку виконання для них не розраховано.`;
};
const signedKg = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${dec(Math.abs(n))}`;

/** The report as plain text for «Поділитися» (and for a doctor without the app). */
export function reportText(r: Report, dm: (d: ISODate) => string): string {
  const lines = [
    `Звіт за ${dm(r.from)} — ${dm(r.to)} (${r.days} дн.)`,
    ...(r.lightDays ? [t.lightDay.summary(r.lightDays.count, r.lightDays.days), ...(r.lightDays.dates.length ? [t.lightDay.dates(r.lightDays.dates.map(dm).join(', ')), t.lightDay.hint] : [])] : []),
    ...(r.tracking ? trackingLines(r.tracking) : []),
    ...(r.unscoredMedMarks ? [unscoredMedText(r.unscoredMedMarks)] : []),
    r.meds ? `${t.report.meds(r.meds.taken, r.meds.due)}${r.meds.missed.length ? ` — ${r.meds.missed.map((m) => t.report.missed(m.title, m.count)).join('; ')}` : ''}` : '',
    r.meds?.unmarked ? t.report.unmarked(r.meds.unmarked) : '',
    r.meds ? t.report.medsScope : '',
    r.meds && r.meds.list.length > 1 ? r.meds.list.map((m) => `• ${t.report.medLine(m)}`).join('\n') : '',
    ...r.prn.map((x) => `${t.prn.report(x.title, x.total, x.days)}${x.over.length ? ` — ${t.prn.over(prnLimitText(x.limit!), x.over.map((d) => d.slice(8, 10) + '.' + d.slice(5, 7)).join(', '))}` : ''}${x.unmatched ? ` — ${t.prn.reportUnmatched(x.unmatched)}` : ''}`), // D118, R01
    r.deviations ? (r.deviations.meals ? `${t.report.deviations(r.deviations.meals, r.deviations.of)}: ${r.deviations.by.map((b) => `${b.title} — ${b.count}`).join('; ')}`
      : t.report.noDeviations(r.deviations.of)) : '',
    r.medFood ? t.medFood.report(r.medFood) : '',
    r.dietQuestions.length ? r.dietQuestions.map((q) => `• ${q}`).join('\n') : '',
    r.labs.length ? `${t.report.labs}:\n${r.labs.map((l) => `• ${dm(l.date)} ${l.name}: ${dec(l.value)} ${l.unit}${[l.reference ? `референс лабораторії ${l.reference}` : '', l.target ? `ціль лікаря ${l.target}` : ''].filter(Boolean).join('; ').replace(/^(.+)$/, ' ($1)')}`).join('\n')}` : '',
    r.checklistPct != null ? `План дня виконано: ${r.checklistPct} %` : '',
    r.weightPending ? t.weightQuality.reportPending(r.weightPending) : '',
    r.weightStart != null ? `Вага: ${dec(r.weightStart)} → ${dec(r.weightNow!)} кг` : '',
    r.weightPace != null ? `Темп за період, за тижневими середніми: ${signedKg(r.weightPace)} кг на тиждень${r.maxLossPerWeek != null ? ` (межа — не швидше ${dec(r.maxLossPerWeek)})` : ''}` : '',
    r.habits.length ? `Дні з записами, коли виконано:\n${r.habits.map((h) => `• ${HABIT[h.key]}: ${h.met} з ${h.of}`).join('\n')}` : '',
    r.menu ? `Меню з застосунку: з’їдено ${r.menu.done}, пропущено ${r.menu.skipped}, не відмічено ${r.menu.open}` : '',
    r.observed?.workout === false ? '' : `${r.lightDayWorkouts ? t.lightDay.scoredWorkouts : 'Тренувань'}: ${r.workouts}`,
    r.observed?.workout !== false && r.lightDayWorkouts ? t.lightDay.workouts(r.lightDayWorkouts) : '',
    r.avgEnergy != null ? `Середня енергія: ${dec(r.avgEnergy)} з 5` : '',
    r.symptoms.length ? `Симптоми: ${r.symptoms.map((s) => `${s.name} — ${s.count}`).join('; ')}` : '',
    r.coincidences.length ? `Збіги в записах (підрахунок, не висновок):\n${r.coincidences.map((c) => `• ${c}`).join('\n')}` : '',
    r.questions.length ? `Мої питання:\n${r.questions.map((q) => `• ${q}`).join('\n')}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}
