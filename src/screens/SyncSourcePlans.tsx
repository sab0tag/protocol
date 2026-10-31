import type { SourcePlanBackup } from '../data/planBackup';
import type { SourcePlanConflictReview, SourcePlanDelivery } from '../sync/sourcePlanDelivery';
import { t } from '../i18n/uk';

const L = t.sync.source;
function Version({ label, catalog, absent }: { label: string; catalog: SourcePlanBackup | null; absent: string }) {
  const itemsByPlan = new Map<string, SourcePlanBackup['items']>();
  for (const item of catalog?.items ?? []) {
    const items = itemsByPlan.get(item.planId) ?? [];
    items.push(item); itemsByPlan.set(item.planId, items);
  }
  return <details className="min-w-0 rounded-xl border border-line bg-bg p-3">
    <summary className="min-h-tap cursor-pointer content-center break-words font-medium">{label}</summary>
    {!catalog ? <p className="mt-2 text-sm text-muted">{absent}</p> : !catalog.plans.length ? <p className="mt-2 text-sm text-muted">{L.empty}</p> :
      <ul className="mt-2 space-y-3">{catalog.plans.map(plan => <li key={plan.id} className="min-w-0 space-y-1">
        <h3 className="break-words font-medium">{plan.title}</h3>
        <p className="text-sm text-muted">{L.version(plan.version)} · {L.items(itemsByPlan.get(plan.id)?.length ?? 0)}</p>
        {itemsByPlan.get(plan.id)?.map(item => item.provenance.text ?
          <p key={item.id} className="whitespace-pre-wrap break-words text-sm text-muted">{item.provenance.text}</p> : null)}
      </li>)}</ul>}
  </details>;
}

/** Read-only recovery evidence. No medical choice, retry revision or replacement is inferred here. */
export function SyncSourcePlans({ delivery, paused, review }: { delivery: SourcePlanDelivery; paused?: boolean; review?: SourcePlanConflictReview }) {
  const visibleReview = !paused && !delivery.blocked && review?.pendingId === delivery.pending?.id ? review : undefined;
  return <section aria-label={L.title} className="min-w-0 space-y-3 rounded-2xl border border-line bg-surface p-3">
    <h2 className="font-semibold">{L.title}</h2>
    <p className="break-words text-sm text-muted">{paused ? L.paused : delivery.blocked ? L.restored : delivery.pending ? L.pending : delivery.acknowledged ? L.acknowledged : L.unprepared}</p>
    {visibleReview && <>
      <p className="text-sm text-warn">{L.conflict}</p>
      <h3 className="font-medium">{L.review}</h3>
      <p className="text-sm text-muted">{L.reviewHint}</p>
      <div className="grid min-w-0 gap-2 md:grid-cols-2">
        <Version label={L.agreed} catalog={visibleReview.acknowledged} absent={L.noBaseline} />
        <Version label={L.prepared} catalog={visibleReview.pending} absent={L.empty} />
        <Version label={L.local} catalog={visibleReview.local} absent={L.empty} />
        <Version label={L.remote} catalog={visibleReview.remote} absent={visibleReview.remoteState === 'deleted' ? L.deleted : L.missing} />
      </div>
    </>}
  </section>;
}
