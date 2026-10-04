// «Звіт для лікаря» (SPEC.md §5.8). Pure: everything comes in, numbers come out.
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import { buildChecklist } from './checklist';
import { dateOf } from './dates';
import type { DayEntry, Food, ISODate, Plan, WeightLog, Wellbeing, Workout } from './types';

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
  questions: string[];
}

export function buildReport(args: {
  from: ISODate; to: ISODate; plan: Plan | undefined; entries: DayEntry[]; workouts: Workout[]; wellbeing: Wellbeing[];
  weights: WeightLog[]; foods: Map<string, Food>;
}): Report {
  const { from, to, plan, entries, workouts, wellbeing, weights, foods } = args;
  const inside = (d: ISODate) => d >= from && d <= to;
  const days = differenceInCalendarDays(parseISO(to), parseISO(from)) + 1;

  let done = 0, total = 0;
  for (let i = 0; i < days; i++) {
    const d = format(addDays(parseISO(from), i), 'yyyy-MM-dd');
    const c = buildChecklist({ plan, date: d, entries: entries.filter((e) => dateOf(e.at) === d), workouts, foods,
      now: new Date(`${d}T23:59:00`) });
    done += c.done; total += c.total;
  }
  const w = weights.filter((x) => inside(x.date)).sort((a, b) => a.date.localeCompare(b.date));
  const scored = wellbeing.filter((x) => inside(x.date) && x.energy != null);
  const counts = new Map<string, number>();
  for (const x of wellbeing.filter((y) => inside(y.date))) for (const s of x.symptoms) counts.set(s, (counts.get(s) ?? 0) + 1);

  return {
    from, to, days,
    ...(total ? { checklistPct: Math.round((done / total) * 100) } : {}),
    ...(w.length ? { weightStart: w[0]!.kg, weightNow: w.at(-1)!.kg } : {}),
    workouts: workouts.filter((x) => inside(x.date)).length,
    ...(scored.length ? { avgEnergy: Math.round((scored.reduce((a, x) => a + (x.energy ?? 0), 0) / scored.length) * 10) / 10 } : {}),
    symptoms: [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    questions: plan?.questions ?? [],
  };
}

const dec = (n: number) => String(n).replace('.', ',');

/** The report as plain text for «Поділитися» (and for a doctor without the app). */
export function reportText(r: Report, dm: (d: ISODate) => string): string {
  const lines = [
    `Звіт за ${dm(r.from)} — ${dm(r.to)} (${r.days} дн.)`,
    r.checklistPct != null ? `План дня виконано: ${r.checklistPct} %` : '',
    r.weightStart != null ? `Вага: ${dec(r.weightStart)} → ${dec(r.weightNow!)} кг` : '',
    `Тренувань: ${r.workouts}`,
    r.avgEnergy != null ? `Середня енергія: ${dec(r.avgEnergy)} з 5` : '',
    r.symptoms.length ? `Симптоми: ${r.symptoms.map((s) => `${s.name} — ${s.count}`).join('; ')}` : '',
    r.questions.length ? `Мої питання:\n${r.questions.map((q) => `• ${q}`).join('\n')}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}
