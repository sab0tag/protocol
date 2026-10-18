// D90: diets of Наказ МОЗ №931 as presets of the plan — from Харчоблок's shared reference data (src/data/harch, a snapshot
// of a known commit). A diet is a set of the plan's rules plus reference norms; the person or the doctor picks it and can
// switch any rule off. Unchecked data never checks food: rules work only with a dietitian's `checkedBy`; the norms are
// shown for reference and fill a target only when the person asks — and only an empty one. Old table numbers («стіл №5»)
// only suggest a diet to confirm. The app never picks a diet by a diagnosis.
import raw from '../data/harch/diets.json';
import source from '../data/harch/source.json';
import { DIET_RULES } from '../data/dietRules';
import type { Cooking, Plan, Targets } from './types';

export interface DietRule {
  id: string;
  kind: 'exclude' | 'limit';
  title: string;
  match: { cooking?: Cooking[]; words?: string[]; tags?: string[] };
  limit?: string;
  source?: string;
  checkedBy?: string;
  checkedAt?: string;
}

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

/** The diet's norms as targets — only into empty ones (a doctor's number is never written over); the middle of the range. */
export function fillEmptyTargets(targets: Targets, d: DietPreset): Targets {
  const mid = (r: [number, number]) => Math.round((r[0] + r[1]) / 2);
  return {
    ...targets,
    ...(targets.kcal === undefined && d.norms.kcal ? { kcal: mid(d.norms.kcal) } : {}),
    ...(targets.proteinG === undefined && d.norms.proteinG ? { proteinG: mid(d.norms.proteinG) } : {}),
    ...(targets.fatG === undefined && d.norms.fatG ? { fatG: mid(d.norms.fatG) } : {}),
    ...(targets.carbsG === undefined && d.norms.carbsG ? { carbsG: { max: d.norms.carbsG[1] } } : {}),
  };
}
