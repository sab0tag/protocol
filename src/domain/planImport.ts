/** PR-13: a plan handed over by a clinic. It is shown as a preview first; only items the person ticks are stored, as a
 *  draft with `pending` verification. Nothing is activated and no reminder or obligation is created by importing. */
import type { CarePlan, CarePlanItem } from './carePlans';

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
}
export interface PreviewItem { key: string; kind: CarePlanItem['kind']; title: string; detail: string }
export interface ImportPreview { plan: ClinicPlanV1; items: PreviewItem[] }

const isStr = (x: unknown, max: number, min = 0): x is string => typeof x === 'string' && x.length >= min && x.length <= max;
const strs = (x: unknown, max: number, len: number): x is string[] => Array.isArray(x) && x.length <= max && x.every((s) => isStr(s, len, 1));
const ALLOWED = new Set(['schemaVersion', 'planId', 'organizationId', 'issuedAt', 'clinician', 'title', 'medications', 'restrictions', 'tests', 'followUp']);

/** Returns the plan only if it has exactly the agreed shape; anything else (including extra fields) is refused. */
export function parseClinicPlan(raw: unknown): ClinicPlanV1 | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  if (Object.keys(p).some((k) => !ALLOWED.has(k))) return null;
  const c = p.clinician as Record<string, unknown> | undefined;
  if (p.schemaVersion !== 1 || !isStr(p.planId, 64, 1) || !isStr(p.organizationId, 128, 1) || !isStr(p.issuedAt, 40, 10) ||
    Number.isNaN(Date.parse(p.issuedAt as string)) || !isStr(p.title, 200, 1) || !c || !isStr(c.displayName, 200, 1) ||
    !isStr(c.organizationName, 200, 1) || !strs(p.restrictions, 100, 500) || !strs(p.tests, 100, 500) ||
    (p.followUp !== undefined && !isStr(p.followUp, 500))) return null;
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
  ];
  return { plan, items };
}

/** Builds the draft to store. `accepted` are the preview keys the person ticked; unknown keys are ignored, none = nothing to import. */
export function confirmImport(preview: ImportPreview, accepted: readonly string[], personId: string): { plan: CarePlan; items: CarePlanItem[] } | null {
  const chosen = preview.items.filter((i) => accepted.includes(i.key));
  if (!chosen.length) return null;
  const p = preview.plan, planId = JSON.stringify(['clinic-plan', p.planId]);
  const source = `${p.clinician.displayName}, ${p.clinician.organizationName}`;
  const plan: CarePlan = { id: planId, personId, title: p.title, clinicianRef: source, status: 'draft', version: 1,
    source: { kind: 'clinic', clinicPlanId: p.planId, organizationName: p.clinician.organizationName, issuedAt: p.issuedAt } };
  const items = chosen.map((i): CarePlanItem => ({
    id: JSON.stringify([planId, i.key]), personId, planId, kind: i.kind, provenance: { verification: 'pending', text: i.detail ? `${i.title}: ${i.detail}` : i.title },
    content: { type: 'prescription', value: {
      id: JSON.stringify([planId, i.key]), source,
      kind: i.kind === 'medication' ? 'medication' : i.kind === 'follow_up' ? 'test' : 'lifestyle', title: i.title,
      ...(i.detail ? { notes: i.detail } : {}) } },
  }));
  return { plan, items };
}
