import { useEffect, useState } from 'react';
import { ApiError } from '../sync/api';
import { identitySession, identityLoginURL, invitationPreview, invitationAccept, type IdentitySession, type InvitationPreview } from '../sync/identityApi';

let pendingCode: string | null = null;
function captureCode(): string | null {
  const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  if (q.has('code')) {
    const value = q.get('code') ?? ''; pendingCode = /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#/clinic/invite`);
  }
  return pendingCode;
}
const messages: Record<string, string> = {
  invitation_not_found: 'Запрошення недійсне, відкликане або строк минув. Попросіть адміністратора надіслати нове.',
  invitation_recipient_mismatch: 'Увійдіть із підтвердженою адресою, на яку надійшло запрошення. Інший обліковий запис його не прийме.',
  invitation_conflict: 'Членство вже існує або його умови змінилися. Перевірте кабінет чи зверніться до адміністратора.',
  step_up_required: 'Підтвердіть вхід ще раз, а потім поверніться до цієї вкладки.',
  mfa_required: 'Для вступу до клініки потрібен вхід із другим фактором.',
  identity_changed: 'Обліковий запис змінився. Перегляньте запрошення ще раз перед прийняттям.',
  offline: 'Немає зʼєднання. Спробуйте ще раз.', database_busy: 'Сервіс тимчасово зайнятий. Спробуйте ще раз.',
};
export function ClinicInvitationScreen() {
  const [code] = useState(captureCode), [session, setSession] = useState<IdentitySession | null>(null);
  const [previewAccount, setPreviewAccount] = useState<string | null>(null);
  const [preview, setPreview] = useState<InvitationPreview | null>(null), [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [accepted, setAccepted] = useState(false);
  useEffect(() => {
    let live = true;
    const check = async () => {
      try { const s = await identitySession(); if (live) setSession(s); }
      catch (e) { if (live) { setSession(null); if (!(e instanceof ApiError && e.status === 401)) setError('Не вдалося перевірити вхід. Спробуйте ще раз.'); } }
    };
    void check(); window.addEventListener('focus', check);
    return () => { live = false; window.removeEventListener('focus', check); };
  }, []);
  async function run(accept: boolean) {
    if (!code || !session || busy) return;
    setBusy(true); setError('');
    try {
      // Refresh CSRF after a step-up in another tab; the verified contact always comes from the server session.
      const current = await identitySession(); setSession(current);
      if (accept && current.account.id !== previewAccount) { setPreview(null); setAgreed(false); throw new ApiError(409, 'identity_changed'); }
      if (accept) { await invitationAccept(current, code); pendingCode = null; setAccepted(true); setPreview(null); }
      else { setPreview(await invitationPreview(current, code)); setPreviewAccount(current.account.id); setAgreed(false); }
    } catch (e) { setError(messages[e instanceof ApiError ? e.code : ''] ?? 'Не вдалося виконати дію. Перевірте вхід і спробуйте ще раз.'); }
    finally { setBusy(false); }
  }
  const button = 'min-h-tap rounded-xl bg-accent px-4 text-white disabled:opacity-50';
  return <section className="space-y-4 pt-4">
    <h1 className="text-2xl font-semibold">Запрошення до клініки</h1>
    {accepted ? <><p role="status">Запрошення прийнято. Доступ до клініки додано.</p><a className="underline min-h-tap inline-flex items-center" href="#/clinic">Відкрити кабінет</a></> : !code ?
      <p role="alert">Відкрийте посилання з листа-запрошення. Код не зберігається на пристрої.</p> : <>
      <p className="text-sm">Вступ добровільний. Членство не відкриває дані пацієнтів і не є перевіркою лікарської кваліфікації.</p>
      <p className="text-sm">Увійдіть у новій вкладці з адресою одержувача та другим фактором, потім поверніться сюди. Посилання залишається тільки в памʼяті цієї вкладки.</p>
      <a href={identityLoginURL(!!session)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-tap items-center underline">{session ? 'Підтвердити вхід у новій вкладці' : 'Увійти в новій вкладці'}</a>
      <button className={button} disabled={busy} onClick={() => { void identitySession().then(setSession).catch(() => setError('Спершу увійдіть у новій вкладці.')); }}>Перевірити вхід</button>
      {session && <button className={button} disabled={busy} onClick={() => void run(false)}>Переглянути запрошення</button>}
      {preview && <div className="space-y-3">
        <p>{preview.clinic} · {preview.displayName}</p>
        <p>Ролі: {preview.roles.map(r => r === 'admin' ? 'адміністратор' : 'лікар').join(', ')}</p>
        <p>Діє до {new Date(preview.expiresAt).toLocaleString('uk-UA')}</p>
        <label className="flex min-h-tap items-center gap-2"><input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />Хочу вступити до цієї клініки з указаними ролями</label>
        <button className={button} disabled={!agreed || busy} onClick={() => void run(true)}>Прийняти запрошення</button>
      </div>}
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
