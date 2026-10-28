import { activeProfileId } from '../data/profiles';
import { SceneHeader } from '../components/SceneHeader';
import { useLiveQuery } from 'dexie-react-hooks';
import { Loading } from '../components/Recovery';
import { toast } from '../components/Toast';
import { BellRing } from 'lucide-react';
import { useState } from 'react';
import { db } from '../data/db';
import { DEFAULT_REMINDERS, type ReminderSettings } from '../domain/reminders';
import { t } from '../i18n/uk';
import { ApiError } from '../sync/api';
import { disablePush, enablePush, needsHomeScreen, pushSchedule, pushSupported, sendTest } from '../sync/push';
import { currentKeys } from '../sync/runner';
import { NeedsSync } from '../components/NeedsSync';
import { useFeatures } from '../app/features';
import { Link } from 'react-router-dom';

const L = t.remind;
const select = 'mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3';
const errorText = (e: unknown) => {
  const code = e instanceof ApiError ? (e.status === 0 ? 'offline' : e.code) : 'other';
  return (L.errors as Record<string, string>)[code] ?? L.errors.other;
};

/** «Нагадування» (SPEC.md D34): Web Push for planned meals, medicine times and water, with repeats. */
export function Reminders() {
  const { can, enabled } = useFeatures();
  const meta = useLiveQuery(async () => (await db.meta.get('sync')) ?? null, []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  if (meta === undefined) return <Loading />;
  const keys = currentKeys();
  const s: ReminderSettings & { on: boolean } = { ...DEFAULT_REMINDERS, on: false, ...meta?.reminders };
  const on = s.on && pushSupported() && Notification.permission === 'granted';

  const run = async (fn: () => Promise<unknown>, ok = '') => {
    setBusy(true); setError(''); setMessage('');
    try { await fn(); setMessage(ok); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const change = (patch: Partial<ReminderSettings>) => run(async () => {
    await db.meta.update('sync', { reminders: { ...s, ...patch } });
    if (on && keys) await pushSchedule(keys, true);
    toast(t.toast.settings);
  });

  return (
    <section className="space-y-4 pt-6">
      <SceneHeader title={L.title} description={t.visual.remindersHint} />
      {enabled && <Link to="/modules" className="inline-flex min-h-tap items-center text-accent underline">{t.modules.title}</Link>}
      <div className="space-y-3 protocol-card rounded-2xl border border-line bg-surface p-3">
        <p>{L.text}</p>
        <p className="text-sm text-muted">{L.privacy}</p>
        {activeProfileId !== 'main' ? <p className="text-sm text-muted">{t.profiles.pushPrimary}</p> : !meta || !keys ? <NeedsSync text={L.needsSync} />
          : !pushSupported() ? <p className="text-sm text-warn">{needsHomeScreen() ? L.homeScreen : L.unsupported}</p>
          : on ? (
            <>
              <p className="flex items-center gap-2 font-medium text-accent"><BellRing size={18} aria-hidden />{L.isOn}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => void run(() => sendTest(keys), L.testSent)}
                  className="min-h-tap rounded-xl border border-accent px-3 font-medium text-accent disabled:opacity-40">{L.test}</button>
                <button type="button" disabled={busy} onClick={() => void run(() => disablePush(keys))}
                  className="min-h-tap rounded-xl border border-line px-3">{L.off}</button>
              </div>
            </>
          ) : (
            <>
              {needsHomeScreen() && <p className="text-sm text-warn">{L.homeScreen}</p>}
              <button type="button" disabled={busy} onClick={() => void run(() => enablePush(keys, s))}
                className="flex min-h-tap items-center gap-2 rounded-xl bg-accent px-3 font-medium text-surface disabled:opacity-40">
                <BellRing size={18} aria-hidden />{L.on}</button>
            </>
          )}
        {busy && <p role="status" className="text-sm text-muted">{L.busy}</p>}
        {message && <p role="status" className="text-sm text-accent">{message}</p>}
        {error && <p role="alert" className="text-sm text-warn">{error}</p>}
      </div>

      {meta && keys && pushSupported() && (
        <div className="space-y-2 protocol-card rounded-2xl border border-line bg-surface p-3">
          {([['meals', L.meals], ['meds', L.meds], ['visits', L.visits], ['weekly', L.weekly]] as const)
            .filter(([k]) => k === 'visits' || can(k === 'meals' ? 'food.log' : k === 'meds' ? 'meds.reminders' : 'progress.week')).map(([k, label]) => (
            <label key={k} className="protocol-toggle-row min-h-tap">
              <input type="checkbox" checked={!!s[k]} onChange={(e) => void change({ [k]: e.target.checked })} className="protocol-switch" />
              <span>{label}</span>
            </label>
          ))}
          {(can('meds.reminders') || can('food.log')) && <label className="block"><span className="text-sm text-muted">{L.morning}</span>
            <select value={s.morning} onChange={(e) => void change({ morning: e.target.value })} className={select}>
              <option value="">{L.timeOff}</option>
              {['06:30', '07:00', '07:30', '08:00', '08:30', '09:00'].map((x) => <option key={x} value={x}>{x}</option>)}
            </select></label>}
          {can('menu.evening') && can('food.log') && <label className="block"><span className="text-sm text-muted">{L.evening}</span>
            <select value={s.evening} onChange={(e) => void change({ evening: e.target.value })} className={select}>
              <option value="">{L.timeOff}</option>
              {['19:00', '19:30', '20:00', '20:30', '21:00', '21:30'].map((x) => <option key={x} value={x}>{x}</option>)}
            </select></label>}
          {can('wellbeing.weight') && <label className="block"><span className="text-sm text-muted">{L.weight}</span>
            <select value={s.weightDay ?? 0} onChange={(e) => void change({ weightDay: Number(e.target.value) })} className={select}>
              <option value={0}>{L.weightOff}</option>
              {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{L.weekdays[d]}</option>)}
            </select></label>}
          {can('water.reminders') && <div><label className="block"><span className="text-sm text-muted">{L.water}</span>
            <select value={s.waterEveryH} onChange={(e) => void change({ waterEveryH: Number(e.target.value) as ReminderSettings['waterEveryH'] })} className={select}>
              <option value={0}>{L.waterOff}</option><option value={2}>{L.waterEvery(2)}</option><option value={3}>{L.waterEvery(3)}</option>
            </select></label>
            {s.waterEveryH > 0 && (
              <label className="protocol-toggle-row mt-2 min-h-tap text-sm">
                <input type="checkbox" checked={s.waterIfBehind !== false} onChange={(e) => void change({ waterIfBehind: e.target.checked })}
                  className="protocol-switch" aria-label={L.waterIfBehind} />
                <span>{L.waterIfBehind}</span></label>
            )}</div>}
          {can('menu.topup') && can('food.log') && can('assistant.chat') && <label className="protocol-toggle-row min-h-tap text-sm"> {/* D116 */}
            <input type="checkbox" checked={s.topup !== false} onChange={(e) => void change({ topup: e.target.checked })} className="protocol-switch" />
            <span>{L.topup}</span></label>}
          {(can('meds.reminders') || can('food.log')) && <label className="block"><span className="text-sm text-muted">{L.repeat}</span>
            <select value={s.repeatMin} onChange={(e) => void change({ repeatMin: Number(e.target.value) as ReminderSettings['repeatMin'] })} className={select}>
              <option value={0}>{L.repeatOff}</option>
              {[10, 15, 30].map((m) => <option key={m} value={m}>{L.repeatEvery(m)}</option>)}
            </select></label>}
        </div>
      )}
    </section>
  );
}
