/** PR-13: a plan handed over by a clinic. It is shown as a preview first; only items the person ticks are stored, as a
 *  draft with `pending` verification. Nothing is activated and no reminder or obligation is created by importing. */
import type { CarePlan, CarePlanItem } from './carePlans';
import { parseClinicSnapshot, type ClinicSnapshot } from './clinicSnapshot';
import { readRehab } from './rehab';

export interface ClinicPlanV1 {
  schemaVersion: 1;
  planId: string;
  organizationId: string;
  issuedAt: string;
  clinician: { displayName: string; organizationName: string };
  title: string;
  medications: { name: string; dose: string; frequency: string; duration: string; instructions: string }[];
  restrictions: string[];
  tests: string[];
  followUp?: string;
  /** D179: a rehabilitation complex, as lines (src/domain/rehab.ts) */
  rehab?: { perDay: number; text: string };
}
export interface PreviewItem { key: string; kind: CarePlanItem['kind']; title: string; detail: string }
export interface ImportPreview { plan: ClinicPlanV1; items: PreviewItem[]; snapshot?: ClinicSnapshot }

const isStr = (x: unknown, max: number, min = 0): x is string => typeof x === 'string' && x.length >= min && x.length <= max;
const strs = (x: unknown, max: number, len: number): x is string[] => Array.isArray(x) && x.length <= max && x.every((s) => isStr(s, len, 1));
const ALLOWED = new Set(['schemaVersion', 'planId', 'organizationId', 'issuedAt', 'clinician', 'title', 'medications', 'restrictions', 'tests', 'followUp', 'rehab']);

/** Returns the plan only if it has exactly the agreed shape; anything else (including extra fields) is refused. */
export function parseClinicPlan(raw: unknown): ClinicPlanV1 | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  if (Object.keys(p).some((k) => !ALLOWED.has(k))) return null;
  const c = p.clinician as Record<string, unknown> | undefined;
  if (p.schemaVersion !== 1 || !isStr(p.planId, 64, 1) || !isStr(p.organizationId, 128, 1) || !isStr(p.issuedAt, 40, 10) ||
    Number.isNaN(Date.parse(p.issuedAt as string)) || !isStr(p.title, 200, 1) || !c || !isStr(c.displayName, 200, 1) ||
    !isStr(c.organizationName, 200, 1) || Object.keys(c).some(k => !['displayName', 'organizationName'].includes(k)) ||
    !strs(p.restrictions, 100, 500) || !strs(p.tests, 100, 500) ||
    (p.followUp !== undefined && !isStr(p.followUp, 500))) return null;
  if (p.rehab !== undefined) {
    const r = p.rehab as Record<string, unknown> | null;
    if (!r || typeof r !== 'object' || Object.keys(r).some((k) => !['perDay', 'text'].includes(k)) || !Number.isInteger(r.perDay)
      || (r.perDay as number) < 1 || (r.perDay as number) > 10 || !isStr(r.text, 4000, 1)) return null;
  }
  const meds = p.medications;
  if (!Array.isArray(meds) || meds.length > 100) return null;
  for (const m of meds) {
    const o = m as Record<string, unknown> | null;
    if (!o || typeof o !== 'object' || Object.keys(o).some((k) => !['name', 'dose', 'frequency', 'duration', 'instructions'].includes(k)) ||
      !isStr(o.name, 200, 1) || !isStr(o.dose, 120, 1) || !isStr(o.frequency, 200, 1) || !isStr(o.duration, 200) || !isStr(o.instructions, 1000)) return null;
  }
  return structuredClone(p) as unknown as ClinicPlanV1;
}

export function previewClinicPlan(raw: unknown): ImportPreview | null {
  const plan = parseClinicPlan(raw);
  if (!plan) return null;
  const items: PreviewItem[] = [
    ...plan.medications.map((m, i): PreviewItem => ({ key: `med:${i}`, kind: 'medication', title: m.name,
      detail: [m.dose, m.frequency, m.duration, m.instructions].filter(Boolean).join(' · ') })),
    ...plan.restrictions.map((r, i): PreviewItem => ({ key: `rest:${i}`, kind: 'nutrition', title: r, detail: '' })),
    ...plan.tests.map((t, i): PreviewItem => ({ key: `test:${i}`, kind: 'follow_up', title: t, detail: '' })),
    ...(plan.followUp ? [{ key: 'follow', kind: 'follow_up' as const, title: plan.followUp, detail: '' }] : []),
    ...(plan.rehab && readRehab(plan.rehab.text).length ? [{ key: 'rehab', kind: 'activity' as const, title: 'Комплекс ЛФК',
      detail: [...readRehab(plan.rehab.text).map((s) => `${s.title}: ${s.exercises.map((x) => x.dose ? `${x.name} ${x.dose}` : x.name).join(', ')}`), `${plan.rehab.perDay} раз(и) на день`].join(' · ') }] : []),
  ];
  return { plan, items };
}

const object = (x: unknown): Record<string, unknown> | null => x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : null;
const exact = (x: Record<string, unknown>, keys: string[]) => Object.keys(x).every(k => keys.includes(k));

/** Only for the response fetched from the configured API by redeemClinicPlan. File/pasted JSON always uses
 * previewClinicPlan, which cannot accept or certify an issuer. This receipt is not an offline authenticity proof. */
export function previewClinicRedemption(raw: unknown): ImportPreview | null {
  const response = object(raw);
  if (!response || !exact(response, ['plan', 'snapshot'])) return null;
  const preview = previewClinicPlan(response.plan);
  if (!preview) return null;
  if (response.snapshot === undefined) return preview; // legacy server/document: keep unverified authorship
  const s = parseClinicSnapshot(response.snapshot);
  if (!s) return null;
  const { issuer, source } = s;
  const p = preview.plan;
  if (issuer.organizationId !== p.organizationId || issuer.displayName !== p.clinician.displayName ||
    issuer.organizationName !== p.clinician.organizationName || s.issuedAt !== p.issuedAt || source.planId !== p.planId) return null;
  return { ...preview, snapshot: s };
}

/** Builds the draft to store. `accepted` are the preview keys the person ticked; unknown keys are ignored, none = nothing to import. */
/** `table` finds the diet of «стіл №N» said with its number (the app passes the diets' table; this module stays free of it so
 *  it runs outside the app's bundler too); without it a restriction is the doctor's own words. */
export type TableDiet = (said: string) => { code: string; name: string } | undefined;
export function confirmImport(preview: ImportPreview, accepted: readonly string[], personId: string, table?: TableDiet): { plan: CarePlan; items: CarePlanItem[] } | null {
  const chosen = preview.items.filter((i) => accepted.includes(i.key));
  if (!chosen.length) return null;
  const p = preview.plan, planId = preview.snapshot ? JSON.stringify(['clinic-snapshot', preview.snapshot.snapshotId]) : JSON.stringify(['clinic-plan', p.planId]);
  const source = `${p.clinician.displayName}, ${p.clinician.organizationName}`;
  const plan: CarePlan = { id: planId, personId, title: p.title, clinicianRef: source, status: 'draft', version: 1,
    source: { kind: 'clinic', clinicPlanId: p.planId, organizationName: p.clinician.organizationName, issuedAt: p.issuedAt,
      ...(preview.snapshot ? { redemption: structuredClone(preview.snapshot) } : {}) } };
  const items = chosen.map((i): CarePlanItem => i.key === 'rehab' && p.rehab ? (() => { // D179: the complex as given; the first stage, nothing moved
    const stages = readRehab(p.rehab.text);
    return { id: JSON.stringify([planId, i.key]), personId, planId, kind: 'activity', provenance: { verification: 'pending', text: `${i.title}: ${i.detail}` },
      content: { type: 'rehab', value: { id: JSON.stringify([planId, i.key]), perDay: p.rehab.perDay, stages, stageId: stages[0]!.id, source } } };
  })() : ({
    id: JSON.stringify([planId, i.key]), personId, planId, kind: i.kind, provenance: { verification: 'pending', text: i.detail ? `${i.title}: ${i.detail}` : i.title },
    // D171: a restriction of the clinic is a restriction of the plan — «стіл №5» said with its number is that table's diet (as the
    // paper reader does, D90), anything else the doctor's own words; never guessed from free text beyond the table's number
    content: i.kind === 'nutrition' ? { type: 'constraint', value: restriction(JSON.stringify([planId, i.key]), i.title, source, table) } : { type: 'prescription', value: {
      id: JSON.stringify([planId, i.key]), source,
      kind: i.kind === 'medication' ? 'medication' : i.kind === 'follow_up' ? 'test' : 'lifestyle', title: i.title,
      ...(i.detail ? { notes: i.detail } : {}) } },
  }));
  return { plan, items };
}

function restriction(id: string, said: string, source: string, find?: TableDiet): import('./types').Constraint {
  const table = find?.(said);
  return table ? { id, tag: 'diet', diet: table.code, title: `${table.code} — ${table.name}`, reason: said, source, active: true }
    : { id, tag: 'custom', title: said, reason: '', source, active: true };
}
