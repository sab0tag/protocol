// A doctor's conclusion read from a photo → lines for «План» (SPEC.md D80, D101). Pure. The model's answer is only a draft:
// every line is checked here (times, numbers in sane ranges, known tags), carries where on which page it was read and how
// sure the reading is — ✓ read clearly, ? check it, ✗ not read (raw text to add by hand or skip) — and goes into the plan
// only when the person ticks it after comparing with the paper. A medicine goes in only with its dose and time (D100);
// a time the paper does not give is *suggested* from «2 рази на день» and said so. The diagnosis is never kept.
// Nothing of the person's is removed: a line for a limit or a medicine already in the plan updates it.
import { addDays, format, parseISO } from 'date-fns';
import { findDiets } from './diets';
import { fold, searchMeds, type MedIndex } from './meds';
import { ALLERGENS, type Allergen, type Constraint, type ConstraintTag, type Plan, type Prescription, type Targets } from './types';

export interface Where { page: number; box: number[]; sure: 'yes' | 'check' }
export type TargetKey = 'kcal' | 'proteinG' | 'carbsMaxG' | 'fatG' | 'waterMl' | 'lastMealBy' | 'weightGoalKg' | 'maxWeightLossKgPerWeek';

export interface ConclusionResult {
  readable: boolean;
  date: string | null;
  doctor: string | null;
  diagnosis?: string | null; // read so it is not mixed into other lines — never kept
  diet?: ({ said: string } & Where) | null;
  constraints: ({ tag: string; title: string; reason: string; allergens: string[] } & Where)[];
  prescriptions: ({ kind: string; title: string; dose: string | null; times: string[]; perDay: number | null; frequency: string | null;
    durationDays: number | null; asNeeded: boolean; withFood: boolean | null } & Where)[];
  tests: ({ title: string } & Where)[];
  nextVisit: ({ date: string } & Where) | null;
  targets: ({ key: TargetKey; value: string } & Where)[];
  unread: { text: string; page: number; box: number[] }[];
  note: string | null;
}

/** Where on the paper a line was read: the page (from 1) and a box in fractions of it — for the piece of paper beside it. */
export interface From { page: number; box: [number, number, number, number] }
export type Status = 'sure' | 'check' | 'unread';
interface Common { key: string; status: Status; from?: From }

export type DraftLine = Common & (
  | { kind: 'constraint'; constraint: Constraint }
  | { kind: 'prescription'; prescription: Prescription; frequency?: string; suggested?: true }
  | { kind: 'target'; target: keyof Targets; value: Targets[keyof Targets] }
  | { kind: 'checkup'; date: string; tests: string[] }
  | { kind: 'unread'; text: string });

const TAGS: ConstraintTag[] = ['oxalate', 'gallbladder', 'lactose', 'glycemic', 'iron', 'sodium', 'allergy', 'custom'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const within = (v: number | undefined, lo: number, hi: number) => (v != null && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined);
/** D101: the times the app suggests for «N разів на день» — always marked «час запропоновано», never passed for the doctor's */
export const SUGGESTED: Record<number, string[]> = { 1: ['08:00'], 2: ['08:00', '20:00'], 3: ['08:00', '14:00', '20:00'], 4: ['08:00', '12:00', '16:00', '20:00'] };

/** The part of the day the doctor named — the time to suggest for a dose once a day. */
function partOfDay(words: string): string | undefined {
  const w = words.toLocaleLowerCase('uk');
  return /на ніч|перед сном/u.test(w) ? '22:00' : /ввечері|увечері|вечор/u.test(w) ? '20:00' : /в обід|вдень|удень/u.test(w) ? '13:00'
    : /вранці|уранці|зранку|вранц/u.test(w) ? '08:00' : undefined;
}

/** D100 for what older versions let in: a medicine of the plan, still taken, kept without its dose or time (not «за потреби»). */
export function unfinished(prescriptions: Prescription[], today: string): Prescription[] {
  return prescriptions.filter((p) => (p.kind === 'medication' || p.kind === 'supplement') && !p.asNeeded && !(p.until && p.until < today)
    && (!p.dose?.trim() || !p.schedule?.times.length));
}

/** «Ендокринолог, 12.10.2026» — where the lines came from, as the plan keeps it. */
export function sourceOf(r: Pick<ConclusionResult, 'doctor' | 'date'>): string {
  const d = r.date && DATE.test(r.date) ? r.date.split('-').reverse().join('.') : '';
  return [r.doctor?.trim() || 'Висновок лікаря', d].filter(Boolean).join(', ');
}

function fromOf(w: { page: number; box: number[] }, pages: number): From | undefined {
  const [x, y, bw, bh] = w.box;
  if (!Number.isInteger(w.page) || w.page < 1 || w.page > pages || w.box.length !== 4) return undefined;
  if (![x, y, bw, bh].every((v) => v != null && Number.isFinite(v) && v >= 0 && v <= 1) || !bw || !bh) return undefined;
  return { page: w.page, box: [x!, y!, Math.min(bw, 1 - x!), Math.min(bh, 1 - y!)] };
}

/** «2 л» → 2000 мл, «19.00» → «19:00», «1 800» → 1800: the doctor's figure as the target holds it. */
function targetValue(key: TargetKey, raw: string): [keyof Targets, Targets[keyof Targets]] | undefined {
  const s = raw.trim();
  if (key === 'lastMealBy') {
    const m = /^(\d{1,2})[:.](\d{2})$/.exec(s);
    const v = m ? `${m[1]!.padStart(2, '0')}:${m[2]}` : '';
    return HHMM.test(v) ? ['lastMealBy', v] : undefined;
  }
  const n = Number(s.replace(/\s/g, '').replace(',', '.').replace(/[^\d.]+$/u, ''));
  if (!Number.isFinite(n)) return undefined;
  const range: Record<Exclude<TargetKey, 'lastMealBy' | 'carbsMaxG'>, [number, number]> = {
    kcal: [800, 5000], proteinG: [20, 300], fatG: [20, 250], waterMl: [500, 5000], weightGoalKg: [30, 250], maxWeightLossKgPerWeek: [0.1, 2] };
  if (key === 'carbsMaxG') { const v = within(n, 20, 600); return v != null ? ['carbsG', { max: v }] : undefined; }
  const v = within(key === 'waterMl' && (/л$/u.test(s) || n < 10) ? n * 1000 : n, ...range[key]);
  return v != null ? [key, v] : undefined;
}

export interface DraftOptions { pages?: number; today?: string; index?: MedIndex }

export function draftLines(r: ConclusionResult, newId: () => string, opts: DraftOptions = {}): DraftLine[] {
  const today = opts.today ?? format(new Date(), 'yyyy-MM-dd');
  const pages = opts.pages ?? 1;
  const source = sourceOf(r);
  const out: DraftLine[] = [];
  const key = (p: string) => `${p}:${out.length}`;
  const at = (w: Where) => ({ status: (w.sure === 'yes' ? 'sure' : 'check') as Status, ...(fromOf(w, pages) ? { from: fromOf(w, pages)! } : {}) });

  for (const p of r.prescriptions) {
    const title = p.title.trim();
    if (!title) continue;
    const kind = p.kind === 'medication' ? 'medication' : 'supplement';
    const said = [...new Set(p.times.filter((x) => HHMM.test(x)))].sort();
    const part = partOfDay(p.frequency ?? '');
    const perDay = p.perDay != null && Number.isInteger(p.perDay) ? p.perDay : part ? 1 : undefined;
    // «1 раз ввечері» → 20:00, not the morning default; still a suggestion, marked so
    const suggest = !said.length && !p.asNeeded && perDay ? (perDay === 1 && part ? [part] : SUGGESTED[perDay]) : undefined;
    const times = said.length ? said : suggest ?? [];
    const dose = p.dose?.trim() || undefined;
    // the course runs from the day of the conclusion; doses count from the day it enters the plan (D97)
    const start = r.date && DATE.test(r.date) && r.date <= today ? r.date : today;
    const days = within(p.durationDays ?? undefined, 1, 366);
    const until = days ? format(addDays(parseISO(start), Math.round(days) - 1), 'yyyy-MM-dd') : undefined;
    const reg = opts.index ? registered(opts.index, title) : undefined;
    const base = at(p);
    out.push({ kind: 'prescription', key: key('p'), ...base,
      // ✓ only for a dose read clearly: a wrong dose shown as sure is the one failure the reading must never make
      status: base.status === 'sure' && dose ? 'sure' : 'check',
      ...(p.frequency?.trim() ? { frequency: p.frequency.trim() } : {}), ...(suggest ? { suggested: true as const } : {}),
      prescription: { id: newId(), kind, title, source, since: today, ...(dose ? { dose } : {}),
        ...(times.length || p.withFood != null ? { schedule: { times, ...(p.withFood != null ? { withFood: p.withFood } : {}) } } : {}),
        ...(p.asNeeded ? { asNeeded: true as const } : {}), ...(until ? { until } : {}),
        ...(p.frequency?.trim() ? { notes: p.frequency.trim() } : {}), ...(reg ? { med: reg } : {}) } });
  }

  if (r.diet?.said.trim()) {
    const said = r.diet.said.trim();
    const found = findDiets(said)[0]?.diet; // «стіл №5» → ЩД — always to confirm, never chosen by the app
    out.push({ kind: 'constraint', key: key('c'), ...at(r.diet), status: 'check',
      constraint: found ? { id: newId(), tag: 'diet', diet: found.code, title: `${found.code} — ${found.name}`, reason: said, source, active: true }
        : { id: newId(), tag: 'custom', title: said, reason: '', source, active: true } });
  }
  for (const c of r.constraints) {
    const tag = (TAGS as string[]).includes(c.tag) ? (c.tag as ConstraintTag) : 'custom';
    const allergens = c.allergens.filter((a): a is Allergen => (ALLERGENS as readonly string[]).includes(a));
    if (!c.title.trim() || (tag === 'allergy' && !allergens.length)) continue;
    out.push({ kind: 'constraint', key: key('c'), ...at(c), constraint: { id: newId(), tag, title: c.title.trim(), reason: c.reason.trim(), source,
      active: true, ...(tag === 'allergy' ? { allergens } : {}) } });
  }

  for (const t of r.targets) {
    const v = targetValue(t.key, t.value);
    if (v && !out.some((l) => l.kind === 'target' && l.target === v[0])) out.push({ kind: 'target', key: key('t'), ...at(t), target: v[0], value: v[1] });
  }

  const tests = r.tests.filter((x) => x.title.trim());
  const visit = r.nextVisit && DATE.test(r.nextVisit.date) ? r.nextVisit : undefined;
  // a visit with a date takes the tests along; tests without a date are kept in «Призначення» as tests to take
  if (visit) out.push({ kind: 'checkup', key: 'checkup', ...at(visit), date: visit.date, tests: tests.map((x) => x.title.trim()) });
  else for (const x of tests) out.push({ kind: 'prescription', key: key('p'), ...at(x), prescription: { id: newId(), kind: 'test', title: x.title.trim(), source } });

  for (const u of r.unread) {
    if (!u.text.trim()) continue;
    const from = fromOf(u, pages);
    out.push({ kind: 'unread', key: key('u'), status: 'unread', text: u.text.trim(), ...(from ? { from } : {}) });
  }
  return out;
}

/** The register's entry for a name read off the paper — only the whole name, word for word («Метформін» → «Метформін-Тева»,
 *  never «Вітамін D» → «Вітамін Е»), or the INN; a near guess is no match and the line says «не з реєстру». */
function registered(index: MedIndex, title: string): Prescription['med'] | undefined {
  const t = fold(title);
  const whole = (a: string, b: string) => a === b || a.startsWith(`${b} `);
  const e = searchMeds(index, title, 5).find((x) => whole(fold(x.name), t) || whole(t, fold(x.name)) || (x.inn && fold(x.inn) === t));
  return e ? { name: e.name, ...(e.inn ? { inn: e.inn } : {}), ...(e.atc ? { atc: e.atc } : {}) } : undefined;
}

/** D100: what still keeps a line of a medicine out of the plan — its dose, its time; nothing for other lines. */
export function missing(l: DraftLine): 'dose' | 'time' | undefined {
  if (l.kind !== 'prescription' || (l.prescription.kind !== 'medication' && l.prescription.kind !== 'supplement')) return undefined;
  const p = l.prescription;
  return !p.dose?.trim() ? 'dose' : !p.schedule?.times.length && !p.asNeeded ? 'time' : undefined;
}

const WORDS: Record<string, number> = { двічі: 2, два: 2, дві: 2, тричі: 3, три: 3, чотири: 4 };
/** D80: «2 рази на день» in the doctor's words and no times in the plan — the doses a day the person still has to time
 *  (the app never picks them). Without times a medicine counts as once a day (D49), so this must be said. */
export function timesToSet(p: Prescription): number | undefined {
  if ((p.kind !== 'medication' && p.kind !== 'supplement') || p.schedule?.times.length || p.asNeeded || !p.notes) return undefined;
  const m = /(\d+|двічі|тричі|два|дві|три|чотири)(?:\s*(?:рази|раз|р\.))?\s*(?:на|в|у)\s*(?:день|добу)/iu.exec(p.notes)
    ?? /(двічі|тричі)/iu.exec(p.notes);
  if (!m) return undefined;
  const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : WORDS[m[1]!.toLowerCase()];
  return n && n >= 2 && n <= 6 ? n : undefined;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
export const sameConstraint = (a: Constraint, b: Constraint) =>
  b.tag === 'custom' || b.tag === 'allergy' ? same(a.title, b.title) : b.tag === 'diet' ? a.tag === 'diet' && a.diet === b.diet : a.tag === b.tag;

/** The ticked lines put into the plan: a limit of the same kind (or a medicine of the same name) is updated in place. */
export function applyLines(plan: Plan, lines: DraftLine[]): Pick<Plan, 'constraints' | 'prescriptions' | 'targets'> & Partial<Pick<Plan, 'nextCheckup'>> {
  let constraints = [...plan.constraints], prescriptions = [...plan.prescriptions];
  const targets: Targets = { ...plan.targets };
  let nextCheckup = plan.nextCheckup;
  for (const l of lines) {
    if (l.kind === 'constraint') {
      const c = l.constraint;
      const i = constraints.findIndex((x) => sameConstraint(x, c));
      if (i >= 0) constraints[i] = { ...c, id: constraints[i]!.id };
      else constraints = [...constraints, c];
    } else if (l.kind === 'prescription') {
      if (missing(l)) continue; // D100: never a medicine without its dose and time
      const p = l.prescription;
      const i = prescriptions.findIndex((x) => same(x.title, p.title));
      if (i >= 0) prescriptions[i] = { ...prescriptions[i]!, ...p, id: prescriptions[i]!.id, ...(prescriptions[i]!.since ? { since: prescriptions[i]!.since } : {}) };
      else prescriptions = [...prescriptions, p];
    } else if (l.kind === 'target') {
      (targets as Record<string, unknown>)[l.target] = l.value;
    } else if (l.kind === 'checkup') {
      nextCheckup = { date: l.date, tests: l.tests };
    }
  }
  return { constraints, prescriptions, targets, ...(nextCheckup ? { nextCheckup } : {}) };
}
