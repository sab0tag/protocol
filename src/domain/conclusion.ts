// A doctor's conclusion read from a photo → lines for «План» (SPEC.md D80, D101). Pure. The model's answer is only a draft:
// every line is checked here (times, numbers in sane ranges, known tags), carries where on which page it was read and how
// sure the reading is — ✓ read clearly, ? check it, ✗ not read (raw text to add by hand or skip) — and goes into the plan
// only when the person ticks it after comparing with the paper. A medicine goes in only with its dose and time (D100);
// a time absent from the paper stays absent until the person enters it. Frequency is not a clock time. The diagnosis is never kept.
// Nothing of the person's is removed: a line for a limit or a medicine already in the plan updates it.
import { addDays, addMonths, format, parseISO } from 'date-fns';
import { findDiets } from './diets';
import { parseLimit } from './prn';
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
  nextVisit: ({ date: string; title?: string } & Where) | null;
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
  | { kind: 'prescription'; prescription: Prescription; frequency?: string; timing?: { input: string; perDay: number | null; entered?: true }; suggestedDate?: true }
  | { kind: 'target'; target: Exclude<keyof Targets, 'fromDiet'>; value: Targets[Exclude<keyof Targets, 'fromDiet'>] }
  | { kind: 'checkup'; date: string; title: string }
  | { kind: 'unread'; text: string });

const TAGS: ConstraintTag[] = ['oxalate', 'gallbladder', 'lactose', 'glycemic', 'iron', 'sodium', 'allergy', 'custom'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const within = (v: number | undefined, lo: number, hi: number) => (v != null && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined);
const COUNT: Record<string, number> = { пів: 0.5, півтора: 1.5, один: 1, одну: 1, два: 2, дві: 2, три: 3, чотири: 4, 'п’ять': 5, "п'ять": 5, пять: 5, шість: 6 };
/** D104: «через 3 місяці», «через місяць», «через пів року», «через 2 тижні» → the date from `from`; nothing for other words. */
export function dueIn(words: string, from: string): string | undefined {
  const m = /через\s+(?:(\d+(?:[.,]5)?|пів|півтора|один|одну|два|дві|три|чотири|п[’']?ять|шість)\s*)?(дн|день|тиж|місяц|рок|рік)/iu.exec(words);
  if (!m) return undefined;
  const n = m[1] ? (/^\d/.test(m[1]) ? Number(m[1].replace(',', '.')) : COUNT[m[1].toLowerCase()] ?? NaN) : 1;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const u = m[2]!.toLowerCase(), d = parseISO(from);
  const months = u.startsWith('міс') ? n : u.startsWith('р') ? n * 12 : undefined;
  const date = months !== undefined ? (Number.isInteger(months) ? addMonths(d, months) : addDays(d, Math.round(months * 30)))
    : addDays(d, Math.round(u.startsWith('тиж') ? n * 7 : n));
  const out = format(date, 'yyyy-MM-dd');
  return out > from && out <= format(addMonths(d, 24), 'yyyy-MM-dd') ? out : undefined;
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
function targetValue(key: TargetKey, raw: string): [Exclude<keyof Targets, 'fromDiet'>, Targets[Exclude<keyof Targets, 'fromDiet'>]] | undefined {
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
    // R7: preserve what was read, including malformed values. Never turn a frequency or part of day into times.
    const timing = p.asNeeded ? undefined : { input: p.times.join(', '), perDay: p.perDay };
    const times = readTimes(p.times.join(', ')) ?? [];
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
      ...(p.frequency?.trim() ? { frequency: p.frequency.trim() } : {}), ...(timing ? { timing } : {}),
      prescription: { id: newId(), kind, title, source, since: today, ...(dose ? { dose } : {}),
        ...(times.length || p.withFood != null ? { schedule: { times, ...(p.withFood != null ? { withFood: p.withFood } : {}) } } : {}),
        ...(p.asNeeded ? { asNeeded: true as const } : {}), ...(until ? { until } : {}),
        ...(p.asNeeded && parseLimit(p.frequency ?? '') ? { limit: parseLimit(p.frequency ?? '')! } : {}), // D118, R01: with its unit
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

  // D103: the visit is a line of its own, with its own words and piece of paper; tests are never given its date — «контроль
  // через 3 місяці» next to «огляд 15.01.2027» are two things (they were merged into one line under the visit's date)
  const visit = r.nextVisit && DATE.test(r.nextVisit.date) ? r.nextVisit : undefined;
  if (visit) out.push({ kind: 'checkup', key: 'checkup', ...at(visit), date: visit.date, title: visit.title?.trim() ?? '' });
  // «через 3 місяці» → a date to take the test, counted from the paper's date — suggested, marked so, so a reminder comes
  const from = r.date && DATE.test(r.date) && r.date <= today ? r.date : today;
  for (const x of r.tests) {
    const due = x.title.trim() ? dueIn(x.title, from) : undefined;
    if (x.title.trim()) out.push({ kind: 'prescription', key: key('p'), ...at(x), ...(due ? { suggestedDate: true as const } : {}),
      prescription: { id: newId(), kind: 'test', title: x.title.trim(), source, ...(due ? { dueDate: due } : {}) } });
  }

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

/** Strict clock values: do not silently drop an unreadable slot or merge duplicate doses. */
export function readTimes(input: string, { allowShortHour = false }: { allowShortHour?: boolean } = {}): string[] | undefined {
  if (!input.trim()) return undefined;
  const times = input.split(',').map((x) => x.trim()).map((x) => allowShortHour && /^\d:\d{2}$/.test(x) ? x.padStart(5, '0') : x);
  if (times.length > 24 || times.some((x) => !HHMM.test(x)) || new Set(times).size !== times.length) return undefined;
  return times.sort();
}

export type TimingProblem = 'required' | 'invalid' | 'count' | 'frequency';
/** R7: the same activation guard for source values, manual edits, UI and applyLines. */
export function timingProblem(l: DraftLine): TimingProblem | undefined {
  if (l.kind !== 'prescription' || !['medication', 'supplement'].includes(l.prescription.kind) || l.prescription.asNeeded) return undefined;
  const p = l.prescription;
  const input = l.timing?.input ?? p.schedule?.times.join(', ') ?? '';
  const count = l.timing?.perDay;
  if (count != null && (!Number.isInteger(count) || count < 1 || count > 24)) return 'frequency';
  if (!input.trim()) return 'required';
  const times = readTimes(input), scheduled = readTimes(p.schedule?.times.join(', ') ?? '');
  if (!times || !scheduled || times.join(',') !== scheduled.join(',')) return 'invalid';
  if (count != null && times.length !== count) return 'count';
  return undefined;
}

/** Only explicitly entered clock values change the draft. This does not confirm the medicine. */
export function withDraftTimes(l: DraftLine, input: string): DraftLine {
  if (l.kind !== 'prescription' || !['medication', 'supplement'].includes(l.prescription.kind) || l.prescription.asNeeded) return l;
  return { ...l, timing: { ...l.timing, perDay: l.timing?.perDay ?? null, input, entered: true },
    prescription: { ...l.prescription, schedule: { ...l.prescription.schedule, times: readTimes(input) ?? [] } } };
}

/** D100/R7: a medicine without a dose or a complete validated schedule cannot enter the plan. */
export function missing(l: DraftLine): 'dose' | 'time' | undefined {
  if (l.kind !== 'prescription' || (l.prescription.kind !== 'medication' && l.prescription.kind !== 'supplement')) return undefined;
  return !l.prescription.dose?.trim() ? 'dose' : timingProblem(l) ? 'time' : undefined;
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

// ------------------------------------------------------------------ D115: a later visit — what the new paper changes
export type Change = { kind: 'new' } | { kind: 'same' } | { kind: 'changed'; was: string };
const drug = (p: Prescription) => p.kind === 'medication' || p.kind === 'supplement';
const how = (p: Prescription) => [p.dose?.trim(), p.asNeeded ? 'за потреби' : p.schedule?.times.join(', '), p.until ? `до ${p.until.split('-').reverse().slice(0, 2).join('.')}` : '']
  .filter(Boolean).join(' · ');

/** Each medicine of the new paper against the plan: new, the same, or changed (and what it was). Nothing for other lines. */
export function changes(plan: Pick<Plan, 'prescriptions'>, lines: DraftLine[]): Map<string, Change> {
  const out = new Map<string, Change>();
  for (const l of lines) {
    if (l.kind !== 'prescription' || !drug(l.prescription)) continue;
    const old = plan.prescriptions.find((x) => drug(x) && same(x.title, l.prescription.title));
    if (!old) { out.set(l.key, { kind: 'new' }); continue; }
    const was = how(old), now = how({ ...old, ...l.prescription });
    out.set(l.key, was === now ? { kind: 'same' } : { kind: 'changed', was: was || '—' });
  }
  return out;
}

/** The plan's medicines still taken that the new paper does not name — offered to close, never closed silently (another
 *  doctor's paper does not cancel them). */
export function notOnPaper(plan: Pick<Plan, 'prescriptions'>, lines: DraftLine[], today: string): Prescription[] {
  const named = lines.flatMap((l) => (l.kind === 'prescription' ? [l.prescription.title] : []));
  return plan.prescriptions.filter((p) => drug(p) && !(p.until && p.until < today) && !named.some((n) => same(n, p.title)));
}

/** Closed from today: no doses due from today on, the history of the days before stays in the report. */
export function closeFromToday(prescriptions: Prescription[], ids: Set<string>, today: string): Prescription[] {
  const y = format(addDays(parseISO(today), -1), 'yyyy-MM-dd');
  return prescriptions.map((p) => (ids.has(p.id) ? { ...p, until: p.since && p.since > y ? p.since : y } : p));
}

export const sameConstraint = (a: Constraint, b: Constraint) =>
  b.tag === 'custom' || b.tag === 'allergy' ? same(a.title, b.title) : b.tag === 'diet' ? a.tag === 'diet' && a.diet === b.diet : a.tag === b.tag;

/** The ticked lines put into the plan: a limit of the same kind (or a medicine of the same name) is updated in place. */
/** D114: `placed` gets, for each line put in, the id it has in the plan (a limit or a medicine already there keeps its own). */
export function applyLines(plan: Plan, lines: DraftLine[], since?: { since: string; sinceTime: string }, placed?: Map<string, string>): Pick<Plan, 'constraints' | 'prescriptions' | 'targets'> & Partial<Pick<Plan, 'nextCheckup'>> {
  let constraints = [...plan.constraints], prescriptions = [...plan.prescriptions];
  const targets: Targets = { ...plan.targets };
  let nextCheckup = plan.nextCheckup;
  for (const l of lines) {
    if (l.kind === 'constraint') {
      const c = l.constraint;
      const i = constraints.findIndex((x) => sameConstraint(x, c));
      if (i >= 0) constraints[i] = { ...c, id: constraints[i]!.id };
      else constraints = [...constraints, c];
      placed?.set(l.key, i >= 0 ? constraints[i]!.id : c.id);
    } else if (l.kind === 'prescription') {
      if (missing(l)) continue; // D100: never a medicine without its dose and time
      // D103: a new medicine counts from the moment it is put in, not from the reading; one already there keeps its start
      const p = since && l.prescription.kind !== 'test' ? { ...l.prescription, ...since } : l.prescription;
      const i = prescriptions.findIndex((x) => same(x.title, p.title));
      const old = prescriptions[i];
      placed?.set(l.key, old ? old.id : p.id);
      if (!old) prescriptions = [...prescriptions, p];
      else {
        const { since: _s, sinceTime: _t, ...rest } = p;
        const start = old.since ? { since: old.since, ...(old.sinceTime ? { sinceTime: old.sinceTime } : {}) } : { ...(p.since ? { since: p.since } : {}), ...(p.sinceTime ? { sinceTime: p.sinceTime } : {}) };
        const { since: _os, sinceTime: _ot, ...kept } = old;
        prescriptions[i] = { ...kept, ...rest, id: old.id, ...start };
      }
    } else if (l.kind === 'target') {
      (targets as Record<string, unknown>)[l.target] = l.value;
    } else if (l.kind === 'checkup') {
      nextCheckup = { date: l.date, tests: l.title ? [l.title] : [] };
      placed?.set(l.key, 'checkup');
    }
  }
  return { constraints, prescriptions, targets, ...(nextCheckup ? { nextCheckup } : {}) };
}
