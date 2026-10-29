import { useEffect, useState } from 'react';
import qrcode from 'qrcode-generator';
import { composePlan, patientLink, type PlanForm } from '../domain/clinicPlanDraft';
import { ApiError } from '../sync/api';
import { clinicAddStaff, clinicDeactivate, clinicIssue, clinicMe, clinicPlanStatus, clinicRevoke, clinicStaff, clinicStats, type ClinicMe, type ClinicStats, type StaffMember } from '../sync/clinicApi';

const ERR: Record<string, string> = {
  unauthorized: 'Токен не підходить або доступ вимкнено.', offline: 'Немає зʼєднання.', forbidden: 'Недостатньо прав.',
  too_many: 'Забагато запитів. Спробуйте пізніше.', bad_request: 'Сервер не прийняв дані.', not_found: 'Не знайдено.', last_admin: 'Не можна прибрати останнього адміністратора.',
  database_busy: 'Сервіс тимчасово зайнятий. Спробуйте ще раз.',
};
const FORM: Record<string, string> = {
  title: 'Вкажіть назву плану.', medication: 'У кожному рядку ліків потрібні назва, доза й частота.', empty: 'Додайте хоча б один пункт.', invalid: 'Занадто довгий текст.',
};
const say = (e: unknown) => ERR[e instanceof ApiError ? e.code : ''] ?? 'Не вдалося виконати дію.';
const qrSvg = (text: string) => { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); };

/** Staff screen. The token lives in this tab's memory only: a reload signs out, nothing is written to the device. */
export function ClinicPortalScreen() {
  const [token, setToken] = useState(''), [input, setInput] = useState('');
  const [me, setMe] = useState<ClinicMe | null>(null), [error, setError] = useState('');

  async function signIn() {
    setError('');
    try { const m = await clinicMe(input.trim()); setToken(input.trim()); setInput(''); setMe(m); } catch (e) { setError(say(e)); }
  }
  const signOut = () => { setToken(''); setMe(null); };

  return (
    <section className="space-y-4 pt-4">
      <h1 className="text-2xl font-semibold">Кабінет клініки</h1>
      {!me ? (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void signIn(); }}>
          <label className="block text-sm">Токен доступу
            <input className="mt-1 block min-h-tap w-full rounded-xl border px-3" type="password" autoComplete="off" value={input} onChange={(e) => setInput(e.target.value)} />
          </label>
          {error && <p role="alert" className="text-sm">{error}</p>}
          <button className="min-h-tap rounded-xl bg-accent px-4 text-white disabled:opacity-50" disabled={input.trim().length < 20}>Увійти</button>
        </form>
      ) : (
        <>
          <p className="text-sm text-muted">{me.displayName}, {me.organizationName} · {me.role === 'admin' ? 'адміністратор' : 'лікар'}{' '}
            <button className="underline" onClick={signOut}>Вийти</button></p>
          {me.role === 'admin' ? <Staff token={token} /> : <Issue token={token} me={me} />}
        </>
      )}
    </section>
  );
}

function Staff({ token }: { token: string }) {
  const [staff, setStaff] = useState<StaffMember[]>([]), [name, setName] = useState(''), [role, setRole] = useState<'doctor' | 'admin'>('doctor');
  const [issued, setIssued] = useState(''), [error, setError] = useState(''), [stats, setStats] = useState<ClinicStats | null>(null);
  const load = () => clinicStaff(token).then(setStaff).catch((e) => setError(say(e)));
  useEffect(() => { void load(); void clinicStats(token).then(setStats).catch(() => undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function add() {
    setError('');
    try { setIssued((await clinicAddStaff(token, name, role)).token); setName(''); await load(); } catch (e) { setError(say(e)); }
  }
  async function remove(id: string) {
    setError('');
    try { await clinicDeactivate(token, id); await load(); } catch (e) { setError(say(e)); }
  }
  return (
    <div className="space-y-4">
      {stats && (
        <div className="text-sm">
          <h2 className="font-medium">Плани за {stats.days} днів</h2>
          <p>Видано: {stats.issued} · отримано: {stats.redeemed} · очікують: {stats.pending} · прострочено: {stats.expired} · скасовано: {stats.revoked}{stats.tampered ? <> · пошкоджено: {stats.tampered}</> : null}</p>
          {stats.byDoctor.map((d) => <p key={d.memberId} className="text-muted">{d.displayName || 'Колишній співробітник'}: {d.issued}</p>)}
        </div>
      )}
      <ul className="space-y-2">
        {staff.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-2">
            <span>{m.displayName} · {m.role === 'admin' ? 'адміністратор' : 'лікар'}{m.active ? '' : ' (вимкнено)'}</span>
            {m.active && <button className="min-h-tap underline" onClick={() => remove(m.id)}>Вимкнути</button>}
          </li>
        ))}
      </ul>
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <input className="block min-h-tap w-full rounded-xl border px-3" placeholder="Імʼя" aria-label="Імʼя" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
        <select className="block min-h-tap w-full rounded-xl border px-3" aria-label="Роль" value={role} onChange={(e) => setRole(e.target.value as 'doctor' | 'admin')}>
          <option value="doctor">Лікар</option><option value="admin">Адміністратор</option>
        </select>
        <button className="min-h-tap rounded-xl bg-accent px-4 text-white disabled:opacity-50" disabled={!name.trim()}>Додати</button>
      </form>
      {issued && <p role="status" className="break-all text-sm">Токен нового співробітника (показується один раз, передайте його особисто): <code>{issued}</code></p>}
      {error && <p role="alert" className="text-sm">{error}</p>}
    </div>
  );
}

function Issue({ token, me }: { token: string; me: ClinicMe }) {
  const [form, setForm] = useState<PlanForm>({ title: '', medications: '', restrictions: '', tests: '', followUp: '' });
  const [consent, setConsent] = useState(false), [error, setError] = useState('');
  const [sent, setSent] = useState<{ id: string; link: string; expiresAt: number; status: string } | null>(null);
  const set = (k: keyof PlanForm) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function issue() {
    setError('');
    const r = composePlan(form, me);
    if ('error' in r) { setError(FORM[r.error]!); return; }
    try {
      const d = await clinicIssue(token, r.plan);
      setSent({ id: d.deliveryId, link: patientLink(`${location.origin}${location.pathname}`, d.code), expiresAt: d.expiresAt, status: 'pending' });
      setForm({ title: '', medications: '', restrictions: '', tests: '', followUp: '' }); setConsent(false);
    } catch (e) { setError(say(e)); }
  }
  async function refresh() { if (sent) setSent({ ...sent, status: (await clinicPlanStatus(token, sent.id).catch(() => ({ status: 'unknown' }))).status }); }
  async function revoke() { if (sent) { await clinicRevoke(token, sent.id).catch((e) => setError(say(e))); await refresh(); } }

  if (sent) return (
    <div className="space-y-3">
      <p className="text-sm">Покажіть пацієнту цей QR. Код одноразовий і діє до {new Date(sent.expiresAt).toLocaleString('uk-UA')}. Після закриття екрана його не можна відновити.</p>
      {/* the QR is drawn by qrcode-generator from our own link */}
      <div className="mx-auto w-64 rounded-xl bg-white p-2" dangerouslySetInnerHTML={{ __html: qrSvg(sent.link) }} />
      <p className="text-sm" role="status">Статус: {({ pending: 'очікує', redeemed: 'отримано', revoked: 'скасовано', expired: 'прострочено', tampered: 'план пошкоджено — видайте новий' } as Record<string, string>)[sent.status] ?? 'невідомо'}</p>
      <div className="flex gap-3">
        <button className="min-h-tap underline" onClick={refresh}>Оновити статус</button>
        {sent.status === 'pending' && <button className="min-h-tap underline" onClick={revoke}>Скасувати</button>}
        <button className="min-h-tap underline" onClick={() => setSent(null)}>Новий план</button>
      </div>
      {error && <p role="alert" className="text-sm">{error}</p>}
    </div>
  );
  const box = 'mt-1 block w-full rounded-xl border px-3 py-2';
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void issue(); }}>
      <label className="block text-sm">Назва плану<input className={`${box} min-h-tap`} maxLength={200} value={form.title} onChange={set('title')} /></label>
      <label className="block text-sm">Ліки (один рядок — одні ліки: назва | доза | частота | тривалість | інструкції)
        <textarea className={box} rows={4} value={form.medications} onChange={set('medications')} /></label>
      <label className="block text-sm">Обмеження (рядок на пункт)<textarea className={box} rows={2} value={form.restrictions} onChange={set('restrictions')} /></label>
      <label className="block text-sm">Аналізи (рядок на пункт)<textarea className={box} rows={2} value={form.tests} onChange={set('tests')} /></label>
      <label className="block text-sm">Наступний візит<input className={`${box} min-h-tap`} maxLength={500} value={form.followUp} onChange={set('followUp')} /></label>
      <label className="flex min-h-tap items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        Пацієнт погодився отримати цей план у застосунок.</label>
      {error && <p role="alert" className="text-sm">{error}</p>}
      <button className="min-h-tap rounded-xl bg-accent px-4 text-white disabled:opacity-50" disabled={!consent}>Створити QR</button>
    </form>
  );
}
