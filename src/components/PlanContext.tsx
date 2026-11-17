import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarDays, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { db } from '../data/db';
import { activeProfileId } from '../data/profiles';
import type { CarePlanStatus } from '../domain/carePlans';
import type { Plan } from '../domain/types';
import { t } from '../i18n/uk';

const L = t.planView;
const statuses: Record<CarePlanStatus, string> = { draft: L.draft, active: L.active, paused: L.paused, completed: L.completed, archived: L.archived };

/** Read-only context. Source metadata does not create schedules or certify a clinician's identity. */
export function PlanContext({ plan }: { plan: Plan }) {
  const catalog = useLiveQuery(async () => (await db.carePlans.toArray()).filter(source => source.personId === activeProfileId && source.source.kind !== 'legacy'), [], []);
  const sources = [...new Set([...plan.prescriptions.map(item => item.source), ...plan.constraints.map(item => item.source)].filter(source => source?.trim()))];
  const scheduled = plan.prescriptions.filter(item => item.kind !== 'test').map(item => ({ item, times: [...(item.schedule?.times ?? [])].sort() }))
    .sort((a, b) => (a.times[0] ?? '99').localeCompare(b.times[0] ?? '99'));
  return <>
    <section aria-labelledby="plan-sources-title" className="protocol-card space-y-3">
      <h2 id="plan-sources-title">{L.sources}</h2>
      <article className="rounded-xl border border-line p-3">
        <p className="font-semibold">{L.current}</p>
        <p className="mt-1 text-sm text-muted">{L.currentHint}</p>
        <details className="mt-2">
          <summary className="min-h-tap cursor-pointer text-sm font-medium text-accent">{L.sourceDetails}</summary>
          {sources.length ? <ul className="space-y-2 py-2 text-sm">{sources.map(source => <li key={source} className="flex items-start gap-2 [overflow-wrap:anywhere]"><FileText size={16} className="mt-1 shrink-0 text-muted" aria-hidden /><span>{source}</span></li>)}</ul> : <p className="py-2 text-sm text-muted">{L.noSource}</p>}
          <p className="text-xs text-muted">{L.unverifiedSources}</p>
        </details>
      </article>
      {catalog.map(source => <article key={source.id} className="rounded-xl border border-line p-3 [overflow-wrap:anywhere]">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-semibold">{source.title}</h3><span className="rounded-full bg-accent/10 px-2 py-1 text-xs text-accent">{statuses[source.status]}</span></div>
        <p className="mt-1 text-sm text-muted">{source.source.kind === 'clinic' ? source.source.organizationName : source.source.kind === 'document' ? L.document : L.manual}</p>
        {source.clinicianRef && <p className="text-sm text-muted">{L.authorAsStored} {source.clinicianRef}</p>}
        {source.source.kind === 'clinic' && source.source.redemption && <div className="mt-1 text-sm text-muted"><p>{L.issuerAsStored} {source.source.redemption.issuer.displayName}, {source.source.redemption.issuer.organizationName}</p><p className="mt-1 text-xs">{L.receiptHint}</p></div>}
        {(source.validFrom || source.validTo) && <p className="text-sm text-muted">{[source.validFrom, source.validTo].filter(Boolean).join(' — ')}</p>}
        {source.status === 'draft' && <p className="mt-1 text-sm text-muted">{L.draftHint}</p>}
      </article>)}
    </section>
    <section aria-labelledby="plan-schedule-title" className="protocol-card">
      <div className="mb-2 flex items-center gap-2"><CalendarDays size={18} className="text-accent" aria-hidden /><h2 id="plan-schedule-title">{L.schedule}</h2></div>
      <p className="mb-3 text-sm text-muted">{L.scheduleHint}</p>
      {scheduled.length === 0 ? <p className="text-sm text-muted">{L.emptySchedule}</p> : <ul className="divide-y divide-line">{scheduled.map(({ item, times }) => <li key={item.id}>
        <Link to="/plan/prescriptions" className="grid min-h-tap grid-cols-[5rem_1fr] gap-3 py-3">
          <span className="tabular text-sm text-accent">{item.asNeeded ? t.conclusion.asNeeded : times.length ? times.join(' · ') : L.noTime}</span>
          <span className="min-w-0"><span className="block font-medium">{item.title}</span><span className="block text-sm text-muted">{[item.dose, item.schedule?.withFood === true ? t.plan.withFood : item.schedule?.withFood === false ? t.conclusion.empty : undefined].filter(Boolean).join(' · ')}</span>
            {(item.since || item.until) && <span className="block text-xs text-muted">{[item.since, item.until].filter(Boolean).join(' — ')}</span>}
          </span>
        </Link>
      </li>)}</ul>}
    </section>
  </>;
}
