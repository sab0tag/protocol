/** Runtime recovery only. This does not initialize a source catalog or upgrade a vault. */
import type { ProtocolDB } from '../data/db';
import type { Keys } from './crypto';
import { ApiError, conditionalRecordsCapability, conditionalVaultApi } from './api';
import { deliverSourcePlanSend, inspectSourcePlanConflict, type SourcePlanConflictReview } from './sourcePlanDelivery';

export type SourceRecovery =
  | { kind: 'none' }
  | { kind: 'restored' }
  | { kind: 'acknowledged' }
  | { kind: 'conflict'; review: SourcePlanConflictReview };

export async function recoverSourcePlanQueue(db: ProtocolDB, keys: Keys, api?: ReturnType<typeof conditionalVaultApi>): Promise<SourceRecovery> {
  const meta = await db.meta.get('sync');
  if (!meta?.sourcePlanDelivery) return { kind: 'none' };
  if (meta.paused) throw new Error('source_plan_sync_paused');
  if (meta.sourcePlanDelivery.blocked) return { kind: 'restored' };
  if (!meta.sourcePlanDelivery.pending && !meta.sourcePlanDelivery.acknowledged) throw new Error('source_plan_delivery_invalid');
  if (!api && meta.sourcePlanDelivery.pending) {
    try {
      const capability = await conditionalRecordsCapability(keys);
      if (capability.minimum !== 2) throw new ApiError(409, 'protocol_opt_in_required');
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) throw new ApiError(404, 'conditional_records_unsupported');
      throw error;
    }
  }
  api ??= conditionalVaultApi(keys);
  const result = await deliverSourcePlanSend(db, keys, api);
  if (result.status === 'conflict') return { kind: 'conflict', review: await inspectSourcePlanConflict(db, keys, api) };
  return { kind: 'acknowledged' };
}
