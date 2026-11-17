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

/** `compact` (the «Сьогодні» header, ТЗ 17.11 step 3): the button alone while the day is ordinary; the words about it come once it is on. */
export function LightDayControl({ date, onlyEnable = false, compact = false, onDone }: { date: string; onlyEnable?: boolean; compact?: boolean; onDone?: () => void }) {
  const { enabled, context } = useFeatures();
  const { observation, ready } = useObservation();
  const meta = useLiveQuery(async () => (await db.meta.get('sync')) ?? null, []);
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  if (!enabled || context.demo || !ready || !observation || date !== todayISO()) return null;
  const on = lightDayOnDate(observation.events, date, observation.now);
  if (onlyEnable && on) return null;
  const synced = meta?.reminderPolicyState === 'synced' && meta.reminderPolicyAck === JSON.stringify(policyFromEvents(observation.events));
  return <div className={compact ? 'flex flex-wrap items-center justify-end gap-x-2 text-sm' : 'space-y-1 text-sm'}>
    <button type="button" disabled={busy} aria-pressed={onlyEnable ? undefined : on} onClick={async () => {
      if (date !== todayISO() || busy) return;
      setBusy(true); setError(false);
      try { await applyLightDay(onlyEnable || !on); onDone?.(); } catch { setError(true); } finally { setBusy(false); }
    }} className={`min-h-tap rounded-xl border border-accent font-medium text-accent disabled:opacity-40 ${compact ? 'px-2' : 'px-3'}`}>{on ? t.lightDay.restore : t.lightDay.enable}</button>
    {on && <p className={compact ? 'basis-full' : ''}>{t.lightDay.active}</p>}
    {(!compact || on || (meta && !synced)) && <p role="status" className={`text-muted ${compact ? 'basis-full' : ''}`}>{meta ? synced ? t.modules.synced : t.lightDay.pending : t.modules.local}</p>}
    {error && <p role="alert">{t.startFlow.error}</p>}
  </div>;
}
