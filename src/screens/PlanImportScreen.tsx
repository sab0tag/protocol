import { useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { db } from '../data/db';
import { saveClinicImport } from '../data/carePlans';
import { activeProfileId } from '../data/profiles';
import { confirmImport, previewClinicPlan, type ImportPreview } from '../domain/planImport';
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

/** The code is read from the QR link once and removed from the address bar; the plan is only a preview until confirmed. */
export function PlanImportScreen() {
  const [params, setParams] = useSearchParams();
  const [code] = useState(() => params.get('code') ?? '');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [state, setState] = useState<'idle' | 'loading' | 'saved' | 'already'>('idle');
  const [error, setError] = useState('');
  // A busy server changed nothing: the code stays in this page's memory only (not the URL, not storage) for a retry.
  const [retryAt, setRetryAt] = useState<number | null>(null);

  async function load() {
    if (code && params.has('code')) setParams({}, { replace: true });
    setState('loading'); setError('');
    const wait = retryAt === null ? 0 : retryAt - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    setRetryAt(null);
    try {
      const pv = previewClinicPlan(await redeemClinicPlan(code));
      if (!pv) { setError('План має невідомий формат. Оновіть застосунок або попросіть клініку видати новий.'); setState('idle'); return; }
      setPreview(pv); setTicked(new Set(pv.items.map((i) => i.key))); setState('idle');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'database_busy') {
        const seconds = typeof e.data.retryAfterS === 'number' ? e.data.retryAfterS : 1;
        setRetryAt(Date.now() + seconds * 1000);
      }
      setError(MESSAGE[e instanceof ApiError ? e.code : ''] ?? 'Не вдалося отримати план.'); setState('idle');
    }
  }
  async function save() {
    if (!preview) return;
    const draft = confirmImport(preview, [...ticked], activeProfileId);
    if (!draft) return;
    setState(await saveClinicImport(db, activeProfileId, draft) === 'saved' ? 'saved' : 'already');
  }

  return (
    <section className="space-y-4 pt-4">
      <Link to="/plan" className="inline-flex min-h-tap items-center gap-1 text-sm text-muted"><ChevronLeft size={18} aria-hidden />План лікаря</Link>
      <h1 className="text-2xl font-semibold">План від клініки</h1>
      {state === 'saved' || state === 'already' ? (
        <p role="status">{state === 'saved' ? 'Збережено на цьому пристрої як чернетку. Нагадування не створено — перевірте план з лікарем.' : 'Цей план уже збережено.'}</p>
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
          <p className="text-sm">{preview.plan.title} — {preview.plan.clinician.displayName}, {preview.plan.clinician.organizationName}</p>
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
          <button className="min-h-tap rounded-xl bg-accent px-4 text-white disabled:opacity-50" disabled={!ticked.size} onClick={save}>Зберегти обране</button>
        </div>
      )}
    </section>
  );
}
