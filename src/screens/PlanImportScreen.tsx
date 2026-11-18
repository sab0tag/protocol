import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../data/db';
import { activateClinicPlan, saveClinicImport } from '../data/carePlans';
import { finishModuleOnboarding } from '../data/moduleStart';
import { useUi } from '../store/ui';
import { activeProfileId } from '../data/profiles';
import { confirmImport, previewClinicRedemption, type ImportPreview } from '../domain/planImport';
import { ApiError, redeemClinicPlan } from '../sync/api';

const MESSAGE: Record<string, string> = {
  offline: 'Немає зʼєднання. Спробуйте ще раз, коли буде інтернет.',
  invalid: 'Код не знайдено. Перевірте, чи правильно відскановано QR.',
  expired: 'Термін дії коду минув. Попросіть клініку видати новий.',
  used: 'Цей код уже використано. Попросіть клініку видати новий.',
  revoked: 'Клініка скасувала цей код.',
  tampered: 'План не пройшов перевірку. Попросіть клініку видати новий.',
  too_many: 'Забагато спроб. Спробуйте пізніше.',
  database_busy: 'Сервіс тимчасово зайнятий. Спробуйте ще раз',
};

/** A new link opened in the same tab is a new import: its own code, no error left from the one before (D171). */
export function PlanImportScreen() {
  const [params] = useSearchParams();
  const last = useRef<string | null>(null);
  const fresh = params.get('code');
  if (fresh) last.current = fresh; // the screen takes the code out of the address once read — the key stays
  return <PlanImport key={last.current ?? ''} />;
}

/** The code is read from the QR link once and removed from the address bar; the plan is only a preview until confirmed. */
function PlanImport() {
  const [params, setParams] = useSearchParams();
  const [code] = useState(() => params.get('code') ?? '');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const navigate = useNavigate();
  const [state, setState] = useState<'idle' | 'loading' | 'saved' | 'already' | 'busy'>('idle');
  const [verified, setVerified] = useState(false); // D171: «звірив(ла)» before anything becomes the plan (D157)
  const [error, setError] = useState('');
  // A busy server changed nothing: the code stays in this page's memory only (not the URL, not storage) for a retry.
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const mounted = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    };
  }, []);

  async function load() {
    if (code && params.has('code')) setParams({}, { replace: true });
    setState('loading'); setError('');
    const wait = retryAt === null ? 0 : retryAt - Date.now();
    if (wait > 0) await new Promise<void>((resolve) => { retryTimer.current = setTimeout(resolve, wait); });
    retryTimer.current = null;
    if (!mounted.current) return; // Leaving must not spend a one-time code on a queued retry.
    setRetryAt(null);
    try {
      const pv = previewClinicRedemption(await redeemClinicPlan(code));
      if (!mounted.current) return;
      if (!pv) { setError('План має невідомий формат. Оновіть застосунок або попросіть клініку видати новий.'); setState('idle'); return; }
      setPreview(pv); setTicked(new Set(pv.items.map((i) => i.key))); setState('idle');
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof ApiError && e.code === 'database_busy') {
        const seconds = typeof e.data.retryAfterS === 'number' ? e.data.retryAfterS : 1;
        setRetryAt(Date.now() + seconds * 1000);
      }
      setError(MESSAGE[e instanceof ApiError ? e.code : ''] ?? 'Не вдалося отримати план.'); setState('idle');
    }
  }
  /** «Не зараз»: the plan waits as a draft in «Мій план»; nothing is switched on and the current plan is unchanged. */
  async function later() {
    if (!preview) return;
    const draft = confirmImport(preview, [...ticked], activeProfileId);
    if (!draft) return;
    setState(await saveClinicImport(db, activeProfileId, draft) === 'saved' ? 'saved' : 'already');
  }
  /** D171: checked against the paper — the plan is the person's now: medicines and limits in the plan, the modules by it on a
   *  new phone, no patient «Знайомство» to walk through; then the person's own times (D157: nothing is read from free text). */
  async function accept() {
    if (!preview || !verified) return;
    const draft = confirmImport(preview, [...ticked], activeProfileId);
    if (!draft) return;
    setState('busy');
    try {
      await saveClinicImport(db, activeProfileId, draft);
      const r = await activateClinicPlan(db, activeProfileId, draft.plan.id);
      if (r !== 'activated' && r !== 'already_active') { setError('Не вдалося додати план. Спробуйте ще раз.'); setState('idle'); return; }
      await finishModuleOnboarding(db, {}); // a fresh profile starts its modules from this plan; an existing one keeps its own
      useUi.getState().setOnboarded();
      navigate('/plan/prescriptions', { replace: true });
    } catch { setError('Не вдалося додати план. Спробуйте ще раз.'); setState('idle'); }
  }
  const clinic = preview?.snapshot?.issuer.organizationName ?? preview?.plan.clinician.organizationName;

  return (
    <section className="space-y-4 pt-4">
      <h1 className="text-2xl font-semibold">{clinic ? `«${clinic}» надіслала вам план` : 'Клініка надіслала вам план'}</h1>
      {state === 'saved' || state === 'already' ? (
        <div className="protocol-card space-y-3 p-4" role="status"><p>{state === 'saved' ? 'Нічого не ввімкнено: план чекає чернеткою в «Мій план». Додасте, коли звірите з призначенням лікаря.' : 'Цей план уже збережено.'}</p><Link to="/plan" className="inline-flex min-h-tap items-center rounded-xl bg-accent px-4 font-semibold text-on-accent">Перейти до плану</Link></div>
      ) : !preview ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">Клініка передає план одноразовим кодом. Ви побачите його і самі оберете, що зберегти. Код спрацьовує лише один раз.</p>
          {error && <p role="alert" className="text-sm">{error}</p>}
          <button className="min-h-tap rounded-xl bg-accent px-4 text-white disabled:opacity-50" disabled={!code || state === 'loading'} onClick={load}>
            {state === 'loading' ? 'Завантажуємо…' : retryAt !== null ? 'Повторити' : 'Переглянути план'}
          </button>
          {!code && <p className="text-sm text-muted">Відскануйте QR-код від клініки.</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="break-words text-sm">{preview.plan.title} — {preview.plan.clinician.displayName}, {preview.plan.clinician.organizationName}</p>
          {preview.snapshot ? (
            <div className="space-y-1 break-words text-sm">
              <p>Видано клінікою: {preview.snapshot.issuer.displayName}, {preview.snapshot.issuer.organizationName}.</p>
              <p className="text-muted">Автор у джерелі: {preview.snapshot.source.clinician.displayName}, {preview.snapshot.source.clinician.organizationName}. Це імʼя не підтверджене сервером.</p>
            </div>
          ) : <p className="text-sm text-muted">Імʼя автора в цьому документі не підтверджене сервером.</p>}
          <p className="text-sm text-muted">Це чернетка від клініки. Нічого не вмикається автоматично.</p>
          <ul className="space-y-2">
            {preview.items.map((i) => (
              <li key={i.key}>
                <label className="flex min-h-tap items-start gap-2">
                  <input type="checkbox" checked={ticked.has(i.key)} onChange={(e) => setTicked((s) => { const n = new Set(s); if (e.target.checked) n.add(i.key); else n.delete(i.key); return n; })} />
                  <span><span className="font-medium">{i.title}</span>{i.detail && <span className="block text-sm text-muted">{i.detail}</span>}</span>
                </label>
              </li>
            ))}
          </ul>
          <label className="flex min-h-tap items-start gap-3 rounded-xl border border-line p-3">
            <input type="checkbox" className="mt-1 h-5 w-5" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
            <span>Я звірив(ла) кожен пункт із призначенням лікаря</span>
          </label>
          <p className="text-sm text-muted">Обрані ліки й обмеження стануть вашим планом. Час прийому ви вкажете самі.</p>
          {error && <p role="alert" className="text-sm">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button className="min-h-tap rounded-xl bg-accent px-4 font-semibold text-on-accent disabled:opacity-50" disabled={!ticked.size || !verified || state === 'busy'} onClick={() => void accept()}>Додати до мого плану</button>
            <button className="min-h-tap rounded-xl border border-line px-4 disabled:opacity-50" disabled={!ticked.size || state === 'busy'} onClick={() => void later()}>Не зараз</button>
          </div>
        </div>
      )}
    </section>
  );
}
