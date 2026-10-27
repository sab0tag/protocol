/** A backup belongs to one person. Local profile ids are rebound only on an explicit whole-profile restore. */
import type { ProtocolDB } from './db';
import type { PlanMigration } from './carePlans';
import { assertPlanCatalog, expandLegacyPlan, type CarePlan, type CarePlanItem } from '../domain/carePlans';

export interface SourcePlanBackup { v: 1; plans: CarePlan[]; items: CarePlanItem[]; migrations: PlanMigration[] }
const validId = (s: unknown): s is string => typeof s === 'string' && !!s.trim();
export function databasePersonId(target: ProtocolDB): string {
  if (target.name === 'protocol') return 'main';
  const match = /^protocol-profile-([a-f0-9-]{36})$/.exec(target.name);
  if (!match) throw new Error('Не вдалося визначити профіль окремих планів.');
  return match[1]!;
}
export function validateSourcePlanBackup(value: unknown): SourcePlanBackup {
  try {
    const b = value as SourcePlanBackup;
    if (!b || b.v !== 1 || !Array.isArray(b.plans) || !Array.isArray(b.items) || !Array.isArray(b.migrations)) throw new Error();
    assertPlanCatalog(b);
    const owners = new Set([...b.plans.map(p => p.personId), ...b.items.map(i => i.personId), ...b.migrations.map(m => m.personId)]);
    if (owners.size > 1 || [...owners].some(id => !validId(id))) throw new Error();
    for (const plan of b.plans) {
      if (!validId(plan.title) || !plan.source || !['legacy', 'manual', 'document'].includes(plan.source.kind)) throw new Error();
      if (plan.source.kind === 'document' && !validId(plan.source.documentId)) throw new Error();
      if (plan.source.kind === 'legacy' && plan.source.recordId !== 'main') throw new Error();
    }
    for (const item of b.items) {
      if (!['medication', 'nutrition', 'activity', 'measurement', 'follow_up'].includes(item.kind) ||
        !item.provenance || !['legacy', 'pending', 'verified'].includes(item.provenance.verification) || !item.content ||
        !['prescription', 'constraint', 'target', 'mode', 'follow_up'].includes(item.content.type)) throw new Error();
      if (item.content.type !== 'target' && (!item.content.value || typeof item.content.value !== 'object')) throw new Error();
    }
    if (new Set(b.migrations.map(m => m.id)).size !== b.migrations.length) throw new Error();
    for (const marker of b.migrations) {
      if (marker.id !== 'legacy-main-v1' || !marker.legacySnapshot || marker.legacySnapshot.personId !== marker.personId ||
        !validId(marker.at) || !Number.isFinite(Date.parse(marker.at))) throw new Error();
      const plan = b.plans.find(p => p.id === marker.legacySnapshot.planId && p.personId === marker.personId);
      if (!plan) throw new Error();
      const expected = expandLegacyPlan(marker.legacySnapshot.record, marker.personId, marker.legacySnapshot.planId);
      if (expected.items.some(e => !b.items.some(i => i.id === e.id && i.planId === plan.id && i.personId === plan.personId))) throw new Error();
    }
    return b;
  } catch { throw new Error('У копії пошкоджено окремі плани або їхню належність профілю.'); }
}
export function rebindSourcePlanBackup(value: SourcePlanBackup, personId: string): SourcePlanBackup {
  const b = structuredClone(validateSourcePlanBackup(value));
  if (!validId(personId)) throw new Error('Не вдалося визначити профіль окремих планів.');
  return { v: 1, plans: b.plans.map(p => ({ ...p, personId })), items: b.items.map(i => ({ ...i, personId })),
    migrations: b.migrations.map(m => ({ ...m, personId, legacySnapshot: { ...m.legacySnapshot, personId } })) };
}
export async function sourcePlanBackup(target: ProtocolDB): Promise<SourcePlanBackup | undefined> {
  const plans = await target.carePlans.toArray(), items = await target.carePlanItems.toArray(), migrations = await target.planMigrations.toArray();
  if (!plans.length && !items.length && !migrations.length) return undefined;
  const b = validateSourcePlanBackup({ v: 1, plans, items, migrations });
  const personId = databasePersonId(target);
  if ([...plans, ...items, ...migrations].some(row => row.personId !== personId)) throw new Error('Окремі плани належать іншому профілю.');
  return b;
}
