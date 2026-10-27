/** R5 storage preparation. Not called by app startup/UI until sync/backup compatibility is implemented. */
import type { ProtocolDB } from './db';
import { profileDatabase } from './profiles';
import { expandLegacyPlan, plansForPerson, type LegacyPlanExpansion, type PlanCatalog } from '../domain/carePlans';
import { stable } from '../sync/engine';

export interface PlanMigration {
  id: 'legacy-main-v1';
  personId: string;
  at: string;
  legacySnapshot: LegacyPlanExpansion['legacySnapshot'];
}
const MIGRATION_ID = 'legacy-main-v1';
function owner(target: ProtocolDB, personId: string): void {
  if (!personId.trim() || target.name !== profileDatabase(personId)) throw new Error('plan_database_owner_mismatch');
}

/** Expand only, atomically. A retry never overwrites prepared data or silently accepts a changed legacy source. */
export async function prepareLegacyPlanCore(target: ProtocolDB, personId: string): Promise<'created' | 'unchanged' | 'source_changed' | 'no_legacy_plan'> {
  owner(target, personId);
  return target.transaction('rw', target.plan, target.carePlans, target.carePlanItems, target.planMigrations, async () => {
    const record = await target.plan.get('main');
    if (!record) return 'no_legacy_plan';
    const marker = await target.planMigrations.get(MIGRATION_ID);
    if (marker) {
      if (marker.personId !== personId || marker.legacySnapshot.personId !== personId) throw new Error('plan_database_owner_mismatch');
      const prepared = await target.carePlans.get(marker.legacySnapshot.planId);
      const expected = expandLegacyPlan(marker.legacySnapshot.record, personId, marker.legacySnapshot.planId);
      const items = await target.carePlanItems.bulkGet(expected.items.map(item => item.id));
      if (!prepared || prepared.personId !== personId || expected.plans[0]!.id !== marker.legacySnapshot.planId ||
        items.some(item => !item || item.personId !== personId || item.planId !== prepared.id)) throw new Error('plan_migration_inconsistent');
      if (stable(record) !== stable(marker.legacySnapshot.record)) return 'source_changed';
      return 'unchanged';
    }
    const expansion = expandLegacyPlan(record, personId);
    // add/bulkAdd deliberately reject an existing identity instead of replacing a future source plan.
    await target.carePlans.bulkAdd(expansion.plans);
    await target.carePlanItems.bulkAdd(expansion.items);
    await target.planMigrations.add({ id: MIGRATION_ID, personId, at: new Date().toISOString(), legacySnapshot: expansion.legacySnapshot });
    return 'created';
  });
}

/** Read a prepared catalog from the fixed person's database. This remains local integrity, not server authorization. */
export async function readPreparedPlans(target: ProtocolDB, personId: string): Promise<ReturnType<typeof plansForPerson>> {
  owner(target, personId);
  return target.transaction('r', target.carePlans, target.carePlanItems, async () => {
    const catalog: PlanCatalog = { plans: await target.carePlans.toArray(), items: await target.carePlanItems.toArray() };
    if (catalog.plans.some(plan => plan.personId !== personId) || catalog.items.some(item => item.personId !== personId)) throw new Error('plan_database_owner_mismatch');
    return plansForPerson(catalog, personId);
  });
}
