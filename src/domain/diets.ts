// D90: diets of Наказ МОЗ №931 as presets of the plan — from Харчоблок's shared reference data (src/data/harch, a snapshot
// of a known commit). A diet is a set of the plan's rules plus reference norms; the person or the doctor picks it and can
// switch any rule off. Unchecked data never checks food: rules work only with a dietitian's `checkedBy`; the norms are
// shown for reference and fill a target only when the person asks — and only an empty one. Old table numbers («стіл №5»)
// only suggest a diet to confirm. The app never picks a diet by a diagnosis.
import raw from '../data/harch/diets.json';
import source from '../data/harch/source.json';
import { DIET_RULES } from '../data/dietRules';
import type { Cooking, Plan, Targets } from './types';

/** R02: a rule of a diet, the way the meal check reads it. Only a rule a dietitian or a doctor checked (`checkedBy`) is run;
 *  `exclude` — a food that does not belong; `limit` — a quantity with its structure (grams of the matching foods a day) — a
 *  limit in words only is not run as a quantity; `note` — reference, never run. Its id is stable, its version grows with each
 *  change of its content; `quote` — the source's words, `source` — where («Наказ МОЗ №931, дод. 3, п. …»). */
export interface DietRule {
  id: string;
  version: number;
  kind: 'exclude' | 'limit' | 'note';
  title: string;
  match: { cooking?: Cooking[]; words?: string[]; tags?: string[] };
  limit?: { value: number; unit: 'g'; per: 'day' };
  quote?: string;
  source?: string;
  checkedBy?: string;
  checkedAt?: string;
}
/** A rule the check runs: checked, and either an exclusion or a limit with its numbers. */
export const runnable = (r: DietRule) => !!r.checkedBy && (r.kind === 'exclude' || (r.kind === 'limit' && !!r.limit && r.limit.value > 0));

export interface DietPreset {
  code: string; name: string; kind: 'variant' | 'special'; indications: string;
  norms: { kcal?: [number, number]; proteinG?: [number, number]; fatG?: [number, number]; carbsG?: [number, number] };
  tables: string[]; // old table numbers it replaces, as written in its description («1», «2», «5»)
  rules: DietRule[];
  verified: boolean; // the diet itself (norms and composition) — false for the whole snapshot until a dietitian checks it
}

type Raw = { code: string; name: string; kind: string; kcal: [number, number] | null; protein_g: [number, number] | null; fat_g: [number, number] | null; carbs_g: [number, number] | null; indications: string };

const tablesOf = (d: Raw) => {
  const said = [...(/заміна[^)]*/iu.exec(d.indications)?.[0].matchAll(/№\s*(\d+[а-я]?)/giu) ?? [])].map((m) => m[1]!);
  const own = /^№\s*(\d+[а-я]?)$/u.exec(d.code)?.[1];
  return [...new Set([...said, ...(own ? [own] : [])])];
};

export const DIETS: DietPreset[] = (raw as Raw[]).map((d) => ({
  code: d.code, name: d.name, kind: d.kind === 'special' ? 'special' : 'variant', indications: d.indications,
  norms: { ...(d.kcal ? { kcal: d.kcal } : {}), ...(d.protein_g ? { proteinG: d.protein_g } : {}), ...(d.fat_g ? { fatG: d.fat_g } : {}), ...(d.carbs_g ? { carbsG: d.carbs_g } : {}) },
  tables: tablesOf(d), rules: DIET_RULES[d.code] ?? [], verified: source.verified === true,
}));

export const dietOf = (code: string | undefined) => DIETS.find((d) => d.code === code);
export const DIET_SOURCE = `Наказ МОЗ України №931 · дані Харчоблоку (${source.commit.slice(0, 7)}, ${source.taken}) · не перевірено дієтологом`;

/** «стіл 5», «стол №5», «5 стіл», «щд» → the diets to suggest — never chosen without the person's confirmation. */
export function findDiets(query: string): { diet: DietPreset; byTable?: string }[] {
  const q = query.toLocaleLowerCase('uk').trim();
  if (!q) return DIETS.map((diet) => ({ diet }));
  const table = /(?:стіл|стол|стола|столу|дієта|№)\s*№?\s*(\d+[а-я]?)|^(\d+[а-я]?)\s*(?:стіл|стол)?$/u.exec(q);
  const n = table?.[1] ?? table?.[2];
  if (n) return DIETS.filter((d) => d.tables.includes(n)).map((diet) => ({ diet, byTable: n }));
  return DIETS.filter((d) => `${d.code} ${d.name} ${d.indications}`.toLocaleLowerCase('uk').includes(q)).map((diet) => ({ diet }));
}

export interface DietConflict { code: string; field: keyof DietPreset['norms']; target: number; range: [number, number] }

/** R02: how much of a chosen diet the check really runs — shown with the diet and over the meal check. A diet with none runs no
 *  check of its own («Дієту збережено; автоматичну перевірку її правил ще не налаштовано»); the plan's other limits still do. */
export interface DietCoverage { code: string; name: string; source: string; verified: boolean; active: number; off: number; unchecked: number; configured: boolean }
export function dietCoverage(plan: Pick<Plan, 'constraints'> | undefined): DietCoverage[] {
  return (plan?.constraints ?? []).flatMap((c) => {
    const d = c.tag === 'diet' && c.active ? dietOf(c.diet) : undefined;
    if (!d) return [];
    const run = d.rules.filter(runnable), off = run.filter((r) => c.off?.includes(r.id)).length;
    return [{ code: d.code, name: d.name, source: DIET_SOURCE, verified: d.verified, active: run.length - off, off,
      unchecked: d.rules.filter((r) => !r.checkedBy).length, configured: run.length - off > 0 }];
  });
}

/** A doctor's target outside the diet's reference norm — not settled silently: a question for the plan and the report. */
export function dietConflicts(plan: Pick<Plan, 'constraints' | 'targets'>): DietConflict[] {
  const t = plan.targets, out: DietConflict[] = [];
  const value: Record<keyof DietPreset['norms'], number | undefined> = { kcal: t.kcal, proteinG: t.proteinG, fatG: t.fatG, carbsG: t.carbsG?.max };
  for (const c of plan.constraints) {
    const d = c.tag === 'diet' && c.active ? dietOf(c.diet) : undefined;
    if (!d) continue;
    for (const [field, range] of Object.entries(d.norms) as [keyof DietPreset['norms'], [number, number]][]) {
      const v = value[field];
      if (v !== undefined && (v < range[0] || v > range[1])) out.push({ code: d.code, field, target: v, range });
    }
  }
  return out;
}

/** The diet's norms as targets — only on the person's explicit command, after a preview, only into empty ones (a doctor's number is
 *  never written over); the middle of the range, marked as the diet's (R02: «з довідника, не від лікаря»). */
export function fillEmptyTargets(targets: Targets, d: DietPreset): Targets {
  const mid = (r: [number, number]) => Math.round((r[0] + r[1]) / 2);
  const add: Partial<Targets> = {
    ...(targets.kcal === undefined && d.norms.kcal ? { kcal: mid(d.norms.kcal) } : {}),
    ...(targets.proteinG === undefined && d.norms.proteinG ? { proteinG: mid(d.norms.proteinG) } : {}),
    ...(targets.fatG === undefined && d.norms.fatG ? { fatG: mid(d.norms.fatG) } : {}),
    ...(targets.carbsG === undefined && d.norms.carbsG ? { carbsG: { max: d.norms.carbsG[1] } } : {}),
  };
  const fields = Object.keys(add) as (keyof NonNullable<Targets['fromDiet']>)[];
  return { ...targets, ...add, ...(fields.length ? { fromDiet: { ...targets.fromDiet, ...Object.fromEntries(fields.map((f) => [f, d.code])) } } : {}) };
}

/** R02: a target edited by the person is theirs — its «з довідника» mark goes. */
export function ownTargets(was: Targets, now: Targets): Targets {
  const keep = Object.fromEntries(Object.entries(was.fromDiet ?? {}).filter(([f]) => JSON.stringify(was[f as keyof Targets]) === JSON.stringify(now[f as keyof Targets])));
  const { fromDiet: _f, ...rest } = now;
  return Object.keys(keep).length ? { ...rest, fromDiet: keep } : rest;
}
