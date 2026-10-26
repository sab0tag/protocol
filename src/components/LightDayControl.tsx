import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useFeatures } from '../app/features';
import { useObservation } from '../app/observation';
import { applyLightDay } from '../app/lightDay';
import { db } from '../data/db';
import { todayISO } from '../domain/dates';
import { lightDayOnDate } from '../domain/lightDay';
import { policyFromEvents } from '../../server/src/reminderPolicy';
import { t } from '../i18n/uk';

export function LightDayControl({ date, onlyEnable = false, onDone }: { date: string; onlyEnable?: boolean; onDone?: () => void }) {
  const { enabled, context } = useFeatures();
  const { observation, ready } = useObservation();
  const meta = useLiveQuery(async () => (await db.meta.get('sync')) ?? null, []);
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  if (!enabled || context.demo || !ready || !observation || date !== todayISO()) return null;
  const on = lightDayOnDate(observation.events, date, observation.now);
  if (onlyEnable && on) return null;
  const synced = meta?.reminderPolicyState === 'synced' && meta.reminderPolicyAck === JSON.stringify(policyFromEvents(observation.events));
  return <div className="space-y-1 text-sm">
    <button type="button" disabled={busy} aria-pressed={onlyEnable ? undefined : on} onClick={async () => {
      if (date !== todayISO() || busy) return;
      setBusy(true); setError(false);
      try { await applyLightDay(onlyEnable || !on); onDone?.(); } catch { setError(true); } finally { setBusy(false); }
    }} className="min-h-tap rounded-xl border border-accent px-3 font-medium text-accent disabled:opacity-40">{on ? t.lightDay.restore : t.lightDay.enable}</button>
    {on && <p>{t.lightDay.active}</p>}
    <p role="status" className="text-muted">{meta ? synced ? t.modules.synced : t.lightDay.pending : t.modules.local}</p>
    {error && <p role="alert">{t.startFlow.error}</p>}
  </div>;
}
