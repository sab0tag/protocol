/** R5 expand phase. Source plans stay separate; this module does not replace the legacy journal,
 * activate instructions, compute obligations, or grant access to another person's records. */
import type { Constraint, Mode, Plan, Prescription, Targets } from './types';

export type CarePlanStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived';
export type PlanSource = { kind: 'legacy'; recordId: 'main' } | { kind: 'manual' } | { kind: 'document'; documentId: string }
  | { kind: 'clinic'; clinicPlanId: string; organizationName: string; issuedAt: string };
export interface CarePlan {
  id: string;
  personId: string;
  title: string;
  clinicianRef?: string;
  validFrom?: string;
  validTo?: string;
  status: CarePlanStatus;
  version: number;
  source: PlanSource;
}
export interface ItemProvenance {
  /** Missing source details remain missing; migration cannot certify a legacy instruction. */
  verification: 'legacy' | 'pending' | 'verified';
  text?: string;
  legacyId?: string;
  span?: { documentId: string; page: number; box: [number, number, number, number] };
}
export type PlanItemContent =
  | { type: 'prescription'; value: Prescription }
  | { type: 'constraint'; value: Constraint }
  | { type: 'target'; key: Exclude<keyof Targets, 'fromDiet'>; value: Targets[Exclude<keyof Targets, 'fromDiet'>]; referenceDiet?: string }
  | { type: 'mode'; value: Mode }
  | { type: 'follow_up'; value: NonNullable<Plan['nextCheckup']> };
export interface CarePlanItem {
  id: string;
  personId: string;
  planId: string;
  kind: 'medication' | 'nutrition' | 'activity' | 'measurement' | 'follow_up';
  provenance: ItemProvenance;
  content: PlanItemContent;
}
export interface PlanCatalog { plans: CarePlan[]; items: CarePlanItem[] }
export interface LegacyPlanExpansion extends PlanCatalog {
  /** Retains profile, questions, modes, provenance strings and fields this adapter does not yet understand. */
  legacySnapshot: { personId: string; planId: string; record: Plan };
}
const identity = (...parts: string[]) => JSON.stringify(parts);
const required = (s: string) => { if (typeof s !== 'string' || !s.trim()) throw new Error('plan_identity_required'); };

/** Deterministic, lossless preparation for a future transactional migration. No storage is changed.
 * The single legacy record is one source of unknown authorship; source strings never imply separate clinicians. */
export function expandLegacyPlan(record: Plan, personId: string, retainedPlanId?: string): LegacyPlanExpansion {
  required(personId);
  const snapshot = structuredClone(record);
  // IDs belong to a per-person vault; local profile ids can differ on another device.
  const planId = retainedPlanId ?? identity('legacy-plan', 'main');
  required(planId);
  const plan: CarePlan = { id: planId, personId, title: 'Поточний план', status: 'active', version: 1,
    source: { kind: 'legacy', recordId: 'main' } };
  const items: CarePlanItem[] = [];
  const add = (key: string, kind: CarePlanItem['kind'], content: PlanItemContent, provenance: Omit<ItemProvenance, 'verification'> = {}) => {
    items.push({ id: identity(planId, content.type, key), personId, planId, kind, content, provenance: { ...provenance, verification: 'legacy' } });
  };
  for (const p of snapshot.prescriptions) {
    required(p.id);
    add(p.id, p.kind === 'test' ? 'follow_up' : p.kind === 'lifestyle' ? 'activity' : 'medication',
      { type: 'prescription', value: p }, { text: p.source, legacyId: p.id });
  }
  for (const c of snapshot.constraints) {
    required(c.id);
    add(c.id, 'nutrition', { type: 'constraint', value: c }, { text: c.source, legacyId: c.id });
  }
  for (const key of Object.keys(snapshot.targets) as (keyof Targets)[]) {
    if (key === 'fromDiet') continue; // Provenance metadata is not a separate instruction.
    const referenceDiet = snapshot.targets.fromDiet?.[key as keyof NonNullable<Targets['fromDiet']>];
    add(key, key === 'weightGoalKg' || key === 'maxWeightLossKgPerWeek' ? 'measurement' : 'nutrition',
      { type: 'target', key, value: snapshot.targets[key], ...(referenceDiet ? { referenceDiet } : {}) });
  }
  for (const mode of snapshot.modes) {
    required(mode.id);
    add(mode.id, 'nutrition', { type: 'mode', value: mode }, { legacyId: mode.id });
  }
  if (snapshot.nextCheckup) add('nextCheckup', 'follow_up', { type: 'follow_up', value: snapshot.nextCheckup });
  const expanded = { plans: [plan], items, legacySnapshot: { personId, planId, record: structuredClone(snapshot) } };
  assertPlanCatalog(expanded);
  return expanded;
}

/** Local integrity guard; personId is ownership data, never a replacement for server authorization. */
export function assertPlanCatalog(catalog: PlanCatalog): void {
  const plans = new Map<string, CarePlan>();
  for (const plan of catalog.plans) {
    required(plan.id); required(plan.personId);
    if (!Number.isInteger(plan.version) || plan.version < 1) throw new Error('plan_version_invalid');
    if (!['draft', 'active', 'paused', 'completed', 'archived'].includes(plan.status)) throw new Error('plan_status_invalid');
    const key = identity(plan.personId, plan.id);
    if (plans.has(key)) throw new Error('plan_identity_collision');
    plans.set(key, plan);
  }
  const items = new Set<string>();
  for (const item of catalog.items) {
    required(item.id); required(item.personId); required(item.planId);
    if (!plans.has(identity(item.personId, item.planId))) throw new Error('plan_item_owner_mismatch');
    const key = identity(item.personId, item.id);
    if (items.has(key)) throw new Error('plan_item_identity_collision');
    items.add(key);
  }
}

/** Read projection only. Preserves each source and version, including same-named instructions.
 * Recurrence, activation verification and cross-plan duplicate resolution belong to later R5/R6 slices. */
export function plansForPerson(catalog: PlanCatalog, personId: string): { plan: CarePlan; items: CarePlanItem[] }[] {
  required(personId); assertPlanCatalog(catalog);
  return catalog.plans.filter(plan => plan.personId === personId).map(plan => ({
    plan: structuredClone(plan), items: structuredClone(catalog.items.filter(item => item.personId === personId && item.planId === plan.id)),
  }));
}
