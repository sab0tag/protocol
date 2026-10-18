// A doctor's conclusion read from a photo → lines for «План» (SPEC.md D80). Pure. The model's answer is only a draft:
// every line is checked here (times, numbers in sane ranges, known tags), shown unticked, and goes into the plan only
// when the person ticks it after comparing with the paper. Nothing of the person's is removed: a line for a limit or a
// medicine already in the plan updates it, everything else is added.
import { ALLERGENS, type Allergen, type Constraint, type ConstraintTag, type Plan, type Prescription, type Targets } from './types';

export interface ConclusionResult {
  readable: boolean;
  date: string | null;
  doctor: string | null;
  constraints: { tag: string; title: string; reason: string; allergens: string[] }[];
  prescriptions: { kind: string; title: string; dose: string | null; times: string[]; frequency: string | null; withFood: boolean | null }[];
  tests: string[];
  nextVisit: string | null;
  targets: { kcal: number | null; proteinG: number | null; carbsMaxG: number | null; fatG: number | null; waterMl: number | null;
    lastMealBy: string | null; weightGoalKg: number | null; maxWeightLossKgPerWeek: number | null };
  note: string | null;
}

export type DraftLine =
  | { kind: 'constraint'; key: string; constraint: Constraint }
  | { kind: 'prescription'; key: string; prescription: Prescription; frequency?: string }
  | { kind: 'target'; key: keyof Targets; value: Targets[keyof Targets] }
  | { kind: 'checkup'; key: 'checkup'; date: string; tests: string[] };

const TAGS: ConstraintTag[] = ['oxalate', 'gallbladder', 'lactose', 'glycemic', 'iron', 'sodium', 'allergy', 'custom'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const within = (v: number | null, lo: number, hi: number) => (v != null && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined);

/** «Ендокринолог, 12.10.2026» — where the lines came from, as the plan keeps it. */
export function sourceOf(r: Pick<ConclusionResult, 'doctor' | 'date'>): string {
  const d = r.date && DATE.test(r.date) ? r.date.split('-').reverse().join('.') : '';
  return [r.doctor?.trim() || 'Висновок лікаря', d].filter(Boolean).join(', ');
}

export function draftLines(r: ConclusionResult, newId: () => string, today = new Date().toISOString().slice(0, 10)): DraftLine[] {
  const source = sourceOf(r);
  const out: DraftLine[] = [];
  for (const c of r.constraints) {
    const tag = (TAGS as string[]).includes(c.tag) ? (c.tag as ConstraintTag) : 'custom';
    const allergens = c.allergens.filter((a): a is Allergen => (ALLERGENS as readonly string[]).includes(a));
    if (!c.title.trim() || (tag === 'allergy' && !allergens.length)) continue;
    out.push({ kind: 'constraint', key: `c:${out.length}`, constraint: { id: newId(), tag, title: c.title.trim(), reason: c.reason.trim(), source, active: true,
      ...(tag === 'allergy' ? { allergens } : {}) } });
  }
  for (const p of r.prescriptions) {
    if (!p.title.trim()) continue;
    const times = [...new Set(p.times.filter((x) => HHMM.test(x)))].sort();
    out.push({ kind: 'prescription', key: `p:${out.length}`, ...(p.frequency?.trim() ? { frequency: p.frequency.trim() } : {}),
      prescription: { id: newId(), kind: p.kind === 'medication' ? 'medication' : 'supplement', title: p.title.trim(), source, since: today,
        ...(p.dose?.trim() ? { dose: p.dose.trim() } : {}),
        ...(times.length || p.withFood != null ? { schedule: { times, ...(p.withFood != null ? { withFood: p.withFood } : {}) } } : {}),
        ...(p.frequency?.trim() ? { notes: p.frequency.trim() } : {}) } });
  }
  const t = r.targets;
  const nums: [keyof Targets, number | undefined][] = [
    ['kcal', within(t.kcal, 800, 5000)], ['proteinG', within(t.proteinG, 20, 300)], ['fatG', within(t.fatG, 20, 250)],
    ['waterMl', within(t.waterMl, 500, 5000)], ['weightGoalKg', within(t.weightGoalKg, 30, 250)],
    ['maxWeightLossKgPerWeek', within(t.maxWeightLossKgPerWeek, 0.1, 2)],
  ];
  for (const [key, v] of nums) if (v != null) out.push({ kind: 'target', key, value: v });
  const carbs = within(t.carbsMaxG, 20, 600);
  if (carbs != null) out.push({ kind: 'target', key: 'carbsG', value: { max: carbs } });
  if (t.lastMealBy && HHMM.test(t.lastMealBy)) out.push({ kind: 'target', key: 'lastMealBy', value: t.lastMealBy });
  const tests = r.tests.map((x) => x.trim()).filter(Boolean);
  const date = r.nextVisit && DATE.test(r.nextVisit) ? r.nextVisit : undefined;
  // a visit with a date takes the tests along; tests without a date are kept in «Призначення» as tests to take
  if (date) out.push({ kind: 'checkup', key: 'checkup', date, tests });
  else for (const title of tests) out.push({ kind: 'prescription', key: `p:${out.length}`, prescription: { id: newId(), kind: 'test', title, source } });
  return out;
}

const WORDS: Record<string, number> = { двічі: 2, два: 2, дві: 2, тричі: 3, три: 3, чотири: 4 };
/** D80: «2 рази на день» in the doctor's words and no times in the plan — the doses a day the person still has to time
 *  (the app never picks them). Without times a medicine counts as once a day (D49), so this must be said. */
export function timesToSet(p: Prescription): number | undefined {
  if ((p.kind !== 'medication' && p.kind !== 'supplement') || p.schedule?.times.length || !p.notes) return undefined;
  const m = /(\d+|двічі|тричі|два|дві|три|чотири)(?:\s*(?:рази|раз|р\.))?\s*(?:на|в|у)\s*(?:день|добу)/iu.exec(p.notes)
    ?? /(двічі|тричі)/iu.exec(p.notes);
  if (!m) return undefined;
  const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : WORDS[m[1]!.toLowerCase()];
  return n && n >= 2 && n <= 6 ? n : undefined;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The ticked lines put into the plan: a limit of the same kind (or a medicine of the same name) is updated in place. */
export function applyLines(plan: Plan, lines: DraftLine[]): Pick<Plan, 'constraints' | 'prescriptions' | 'targets'> & Partial<Pick<Plan, 'nextCheckup'>> {
  let constraints = [...plan.constraints], prescriptions = [...plan.prescriptions];
  const targets: Targets = { ...plan.targets };
  let nextCheckup = plan.nextCheckup;
  for (const l of lines) {
    if (l.kind === 'constraint') {
      const c = l.constraint;
      const i = constraints.findIndex((x) => (c.tag === 'custom' || c.tag === 'allergy' ? same(x.title, c.title) : x.tag === c.tag));
      if (i >= 0) constraints[i] = { ...c, id: constraints[i]!.id };
      else constraints = [...constraints, c];
    } else if (l.kind === 'prescription') {
      const p = l.prescription;
      const i = prescriptions.findIndex((x) => same(x.title, p.title));
      if (i >= 0) prescriptions[i] = { ...prescriptions[i]!, ...p, id: prescriptions[i]!.id, ...(prescriptions[i]!.since ? { since: prescriptions[i]!.since } : {}) };
      else prescriptions = [...prescriptions, p];
    } else if (l.kind === 'target') {
      (targets as Record<string, unknown>)[l.key] = l.value;
    } else {
      nextCheckup = { date: l.date, tests: l.tests };
    }
  }
  return { constraints, prescriptions, targets, ...(nextCheckup ? { nextCheckup } : {}) };
}
