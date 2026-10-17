// «Звіт для лікаря» (SPEC.md §5.8). Pure: everything comes in, numbers come out.
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import { buildChecklist } from './checklist';
import { dateOf, isPast } from './dates';
import { dayFlags, type HabitKey } from './habits';
import { activeMode } from './nutrition';
import { t } from '../i18n/uk';
import { checkMeal } from './rules';
import { coincidences, coincidenceText } from './symptoms';
import { wellbeingCoincidences } from './progress';
import type { DayEntry, Food, ISODate, LabResult, Plan, WeightLog, Wellbeing, Workout } from './types';

export interface Report {
  from: ISODate;
  to: ISODate;
  days: number;
  checklistPct?: number; // ticks done / due over the days that had a checklist
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
  /** D79 «Головне»: the doses due on the days with records (today — only those whose time has come), taken and missed */
  meds?: { taken: number; due: number; missed: { title: string; count: number }[] };
  /** D79: eaten meals the plan's check would have changed («замінити» / «прибрати»), by the doctor's limit */
  deviations?: { meals: number; of: number; by: { title: string; count: number }[] };
  /** D79: lab results in the period, the latest first */
  labs: LabResult[];
}

export function buildReport(args: {
  from: ISODate; to: ISODate; plan: Plan | undefined; entries: DayEntry[]; workouts: Workout[]; wellbeing: Wellbeing[];
  weights: WeightLog[]; foods: Map<string, Food>; labs?: LabResult[]; now?: Date;
}): Report {
  const { from, to, plan, entries, workouts, wellbeing, weights, foods, labs = [], now = new Date() } = args;
  const today = format(now, 'yyyy-MM-dd'), hm = format(now, 'HH:mm');
  let taken = 0, due = 0;
  const missed = new Map<string, number>();
  let devMeals = 0, eatenMeals = 0;
  const devBy = new Map<string, number>();
  const inside = (d: ISODate) => d >= from && d <= to;
  const days = differenceInCalendarDays(parseISO(to), parseISO(from)) + 1;

  let done = 0, total = 0;
  const hab = new Map<HabitKey, { met: number; of: number }>();
  for (let i = 0; i < days; i++) {
    const d = format(addDays(parseISO(from), i), 'yyyy-MM-dd');
    const day = entries.filter((e) => dateOf(e.at) === d);
    const c = buildChecklist({ plan, date: d, entries: day, workouts, foods, now: new Date(`${d}T23:59:00`) });
    done += c.done; total += c.total;
    if (!day.length) continue;
    for (const i of c.items) { // D79: doses — days without records are not counted as missed
      if (i.kind !== 'med' || (d === today && !i.done && (!i.time || i.time > hm))) continue;
      due += 1;
      if (i.done) taken += 1; else missed.set(i.title, (missed.get(i.title) ?? 0) + 1);
    }
    if (plan) for (const m of day.filter((e) => e.kind === 'meal' && e.status === 'done' && e.items?.length)) {
      eatenMeals += 1;
      const checks = checkMeal({ plan, ...(activeMode(plan, d) ? { activeMode: activeMode(plan, d)!.mode } : {}), date: d, foods,
        dayEntries: day.filter((e) => e.id !== m.id), meal: m.items!, recentEntries: entries.filter((e) => { const x = dateOf(e.at); return x < d && x >= format(addDays(parseISO(d), -7), 'yyyy-MM-dd'); }) });
      const tags = new Set(checks.flatMap((c) => c.hits).filter((h) => h.verdict === 'replace' || h.verdict === 'remove').map((h) => h.reason));
      if (!tags.size) continue;
      devMeals += 1;
      for (const tag of tags) {
        const title = plan.constraints.find((c) => c.tag === tag)?.title ?? tag;
        devBy.set(title, (devBy.get(title) ?? 0) + 1);
      }
    }
    for (const [k, ok] of Object.entries(dayFlags(plan, day, d, workouts, foods)) as [HabitKey, boolean][]) {
      const h = hab.get(k) ?? { met: 0, of: 0 };
      h.of += 1; if (ok) h.met += 1;
      hab.set(k, h);
    }
  }
  const menuMeals = entries.filter((e) => e.menu && e.kind === 'meal' && inside(dateOf(e.at)) && isPast(e.at)); // D75: by the instant
  const w = weights.filter((x) => inside(x.date)).sort((a, b) => a.date.localeCompare(b.date));
  const scored = wellbeing.filter((x) => inside(x.date) && x.energy != null);
  const counts = new Map<string, number>();
  for (const x of wellbeing.filter((y) => inside(y.date))) for (const s of x.symptoms) counts.set(s, (counts.get(s) ?? 0) + 1);
  // D56: «Мені погано» with its time counts too
  for (const e of entries.filter((y) => y.kind === 'symptom' && inside(dateOf(y.at)))) for (const s of e.symptoms ?? []) counts.set(s, (counts.get(s) ?? 0) + 1);

  return {
    from, to, days,
    ...(total ? { checklistPct: Math.round((done / total) * 100) } : {}),
    ...(w.length ? { weightStart: w[0]!.kg, weightNow: w.at(-1)!.kg } : {}),
    ...(w.length > 1 && differenceInCalendarDays(parseISO(w.at(-1)!.date), parseISO(w[0]!.date)) >= 7
      ? { weightPace: Math.round(((w.at(-1)!.kg - w[0]!.kg) / (differenceInCalendarDays(parseISO(w.at(-1)!.date), parseISO(w[0]!.date)) / 7)) * 10) / 10 } : {}),
    ...(plan?.targets.maxWeightLossKgPerWeek != null ? { maxLossPerWeek: plan.targets.maxWeightLossKgPerWeek } : {}),
    habits: (['protein', 'carbs', 'water', 'meds', 'plan'] as HabitKey[]).flatMap((key) => { const h = hab.get(key); return h ? [{ key, ...h }] : []; }),
    ...(menuMeals.length ? { menu: { done: menuMeals.filter((e) => e.status === 'done').length,
      skipped: menuMeals.filter((e) => e.status === 'skipped').length, open: menuMeals.filter((e) => e.status === 'planned').length } } : {}),
    workouts: workouts.filter((x) => inside(x.date)).length,
    ...(scored.length ? { avgEnergy: Math.round((scored.reduce((a, x) => a + (x.energy ?? 0), 0) / scored.length) * 10) / 10 } : {}),
    symptoms: [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    coincidences: [...coincidences(entries.filter((e) => inside(dateOf(e.at))), foods).map(coincidenceText),
      ...wellbeingCoincidences(entries.filter((e) => inside(dateOf(e.at))), wellbeing.filter((x) => inside(x.date)), foods, plan).map((p) => p.text)], // D71
    questions: plan?.questions ?? [],
    ...(due ? { meds: { taken, due, missed: [...missed.entries()].map(([title, count]) => ({ title, count })).sort((a, b) => b.count - a.count) } } : {}),
    ...(eatenMeals ? { deviations: { meals: devMeals, of: eatenMeals, by: [...devBy.entries()].map(([title, count]) => ({ title, count })).sort((a, b) => b.count - a.count) } } : {}),
    labs: labs.filter((l) => inside(l.date)).sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name)),
  };
}

const dec = (n: number) => String(n).replace('.', ',');
const HABIT: Record<HabitKey, string> = { protein: 'Білок ≥ 90 % цілі', carbs: 'Вуглеводи в межах', water: 'Вода — норма', meds: 'Ліки — всі вчасно', plan: 'План дня ≥ 80 %' };
export const habitLabel = (k: HabitKey) => HABIT[k];
const signedKg = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${dec(Math.abs(n))}`;

/** The report as plain text for «Поділитися» (and for a doctor without the app). */
export function reportText(r: Report, dm: (d: ISODate) => string): string {
  const lines = [
    `Звіт за ${dm(r.from)} — ${dm(r.to)} (${r.days} дн.)`,
    r.meds ? `${t.report.meds(r.meds.taken, r.meds.due)}${r.meds.missed.length ? ` — ${r.meds.missed.map((m) => t.report.missed(m.title, m.count)).join('; ')}` : ''}` : '',
    r.deviations ? (r.deviations.meals ? `${t.report.deviations(r.deviations.meals, r.deviations.of)}: ${r.deviations.by.map((b) => `${b.title} — ${b.count}`).join('; ')}`
      : t.report.noDeviations(r.deviations.of)) : '',
    r.labs.length ? `${t.report.labs}:\n${r.labs.map((l) => `• ${dm(l.date)} ${l.name}: ${dec(l.value)} ${l.unit}${l.target ? ` (ціль ${l.target})` : ''}`).join('\n')}` : '',
    r.checklistPct != null ? `План дня виконано: ${r.checklistPct} %` : '',
    r.weightStart != null ? `Вага: ${dec(r.weightStart)} → ${dec(r.weightNow!)} кг` : '',
    r.weightPace != null ? `Темп: ${signedKg(r.weightPace)} кг на тиждень${r.maxLossPerWeek != null ? ` (межа — не швидше ${dec(r.maxLossPerWeek)})` : ''}` : '',
    r.habits.length ? `Дні з записами, коли виконано:\n${r.habits.map((h) => `• ${HABIT[h.key]}: ${h.met} з ${h.of}`).join('\n')}` : '',
    r.menu ? `Меню з застосунку: з’їдено ${r.menu.done}, пропущено ${r.menu.skipped}, не відмічено ${r.menu.open}` : '',
    `Тренувань: ${r.workouts}`,
    r.avgEnergy != null ? `Середня енергія: ${dec(r.avgEnergy)} з 5` : '',
    r.symptoms.length ? `Симптоми: ${r.symptoms.map((s) => `${s.name} — ${s.count}`).join('; ')}` : '',
    r.coincidences.length ? `Збіги в записах (підрахунок, не висновок):\n${r.coincidences.map((c) => `• ${c}`).join('\n')}` : '',
    r.questions.length ? `Мої питання:\n${r.questions.map((q) => `• ${q}`).join('\n')}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}
