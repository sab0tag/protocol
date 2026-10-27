/** Local-only document review. Never included in vault sync or clinical backups. */
import type { ProtocolDB, PlanRow } from './db';
import type { DraftLine } from '../domain/conclusion';
export interface ReviewContent { lines: DraftLine[]; cuts: Record<string, string>; source: string; note: string }
export interface ReviewDraft extends ReviewContent { id: 'plan-review'; v: 1; revision: string; at: string }
export const REVIEW_ID = 'plan-review';
/** Optimistic concurrency: a stale tab cannot overwrite or consume another tab's review. */
export async function storeReview(target: ProtocolDB, content: ReviewContent, expected?: string): Promise<string> {
  return target.transaction('rw', target.reviewDrafts, async () => {
    const old = await target.reviewDrafts.get(REVIEW_ID);
    if (old?.revision !== expected) throw new Error('review_conflict');
    const revision = crypto.randomUUID();
    await target.reviewDrafts.put({ ...content, id: REVIEW_ID, v: 1, revision, at: new Date().toISOString() });
    return revision;
  });
}
/** Also used inside the activation transaction: either plan+pieces commit and the draft disappears, or all stay. */
export async function discardReview(target: ProtocolDB, expected?: string): Promise<void> {
  return target.transaction('rw', target.reviewDrafts, async () => {
    if ((await target.reviewDrafts.get(REVIEW_ID))?.revision !== expected) throw new Error('review_conflict');
    await target.reviewDrafts.delete(REVIEW_ID);
  });
}
export function reviewBase(plan: PlanRow): string {
  return JSON.stringify([plan.constraints, plan.prescriptions, plan.targets, plan.nextCheckup]);
}
