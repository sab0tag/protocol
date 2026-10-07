import { format } from 'date-fns';
import { History } from 'lucide-react';
import { useState } from 'react';
import { db, type PlanRow } from '../data/db';
import { todayISO } from '../domain/dates';
import type { Plan } from '../domain/types';
import { t } from '../i18n/uk';
import { ApiError, backupRecords, backups, vaultApi } from '../sync/api';
import { planFromRecords, type PlanVersion } from '../sync/engine';
import { currentKeys } from '../sync/runner';
import type { RemoteRecord } from '../sync/engine';
import { saved } from './Toast';

const L = t.versions;

/** D44: «Відновити план з копії» — earlier plans from the vault and the server's nightly copies, opened here. */
export function PlanVersions({ current }: { current: PlanRow }) {
  const [list, setList] = useState<PlanVersion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const keys = currentKeys();
  if (!keys) return null;

  const find = async () => {
    setBusy(true); setError('');
    try {
      const live: RemoteRecord[] = [];
      for (let since = 0; ;) { const page = await vaultApi(keys).pull(since); live.push(...page.records); since = page.seq; if (!page.more) break; }
      const found: PlanVersion[] = [];
      const now = await planFromRecords(keys, live, L.live);
      if (now) found.push(now);
      for (const name of (await backups(keys)).backups) {
        const v = await planFromRecords(keys, (await backupRecords(keys, name)).records, L.copy(name.slice(9, 19)));
        if (v) found.push(v);
      }
      setList(found);
    } catch (e) { setError(e instanceof ApiError && e.status === 0 ? t.sync.errors.offline : t.sync.errors.other); } finally { setBusy(false); }
  };

  const restore = async (v: PlanVersion) => {
    const p = v.plan as unknown as Partial<Plan>;
    const next: PlanRow = { ...current, constraints: p.constraints ?? [], prescriptions: p.prescriptions ?? [], targets: p.targets ?? {},
      modes: p.modes ?? [], nextCheckup: p.nextCheckup, profile: p.profile ?? current.profile,
      onboardedAt: current.onboardedAt ?? p.onboardedAt ?? todayISO(), id: 'main' };
    await saved(db.plan.put(next), L.restored, () => db.plan.put(current));
  };

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-surface p-3">
      <h2 className="flex items-center gap-2 font-semibold"><History size={18} aria-hidden />{L.title}</h2>
      <p className="text-sm text-muted">{L.hint}</p>
      {!list && <button type="button" disabled={busy} onClick={() => void find()}
        className="min-h-tap rounded-xl border border-accent px-3 font-medium text-accent disabled:opacity-40">{busy ? L.busy : L.find}</button>}
      {error && <p role="alert" className="text-sm text-warn">{error}</p>}
      {list?.length === 0 && <p className="text-muted">{L.none}</p>}
      {list?.map((v) => {
        const p = v.plan as unknown as Partial<Plan>;
        const tg = p.targets ?? {};
        return (
          <div key={v.source} className="space-y-1 rounded-xl border border-line p-2 text-sm">
            <p className="font-semibold">{v.source}{v.at ? ` · ${L.saved(format(v.at, 'dd.MM HH:mm'))}` : ''}</p>
            <p className="tabular">{[tg.kcal && `${tg.kcal} ккал`, tg.proteinG && `білок ${tg.proteinG} г`,
              tg.carbsG?.max != null && `вуглеводи до ${tg.carbsG.max} г`, tg.carbsG?.min != null && `вуглеводи від ${tg.carbsG.min} г`,
              tg.waterMl && `вода ${tg.waterMl} мл`, tg.lastMealBy && `останній прийом до ${tg.lastMealBy}`].filter(Boolean).join(' · ') || L.noTargets}</p>
            <p className="text-muted">{L.counts((p.constraints ?? []).length, (p.prescriptions ?? []).length, (p.modes ?? []).length)}</p>
            {(p.constraints ?? []).length > 0 && <p className="text-muted">{(p.constraints ?? []).map((c) => c.title).join(', ')}</p>}
            <button type="button" onClick={() => void restore(v)} className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface">{L.restore}</button>
          </div>
        );
      })}
    </section>
  );
}
