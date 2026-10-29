import { useEffect, useState } from 'react';
import { ApiError } from '../sync/api';
import { clinicStaff, clinicInvitations, clinicInvite, clinicRevokeInvite, clinicSetRoles, clinicDeactivate, clinicAuthTransition, clinicCutover, clinicStats,
  type ClinicAuth, type StaffMember, type StaffInvite, type AuthTransition, type ClinicStats } from '../sync/clinicApi';
const explain = (e: unknown) => ({
  invitation_unavailable: 'Надсилання запрошень не налаштовано або не вдалося. Зверніться до оператора чи спробуйте ще раз.',
  invitation_conflict: 'Цього співробітника вже привʼязано або запрошення змінилося. Оновіть список.',
  last_admin: 'Не можна прибрати останнього адміністратора.', step_up_required: 'Підтвердіть вхід ще раз перед зміною доступу.',
  bad_request: 'Перевірте ролі та приєднання всіх активних співробітників. Дедлайн не можна продовжити.',
  offline: 'Немає зʼєднання.',
} as Record<string, string>)[e instanceof ApiError ? e.code : ''] ?? 'Не вдалося виконати дію. Оновіть список і спробуйте ще раз.';
export function ClinicStaffAccess({ auth }: { auth: ClinicAuth }) {
  const [staff, setStaff] = useState<StaffMember[]>([]), [invites, setInvites] = useState<StaffInvite[]>([]);
  const [transition, setTransition] = useState<AuthTransition | null>(null), [stats, setStats] = useState<ClinicStats | null>(null);
  const [enabled, setEnabled] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [target, setTarget] = useState(''), [name, setName] = useState(''), [email, setEmail] = useState(''), [roles, setRoles] = useState(['doctor']);
  const [grace, setGrace] = useState(168), [confirmed, setConfirmed] = useState(false);
  async function load() {
    const [members, invitations, migration, summary] = await Promise.all([clinicStaff(auth), clinicInvitations(auth), clinicAuthTransition(auth), clinicStats(auth)]);
    setStaff(members); setInvites(invitations.invitations); setEnabled(invitations.enabled); setTransition(migration); setStats(summary);
  }
  useEffect(() => { void load().catch(e => setError(explain(e))); }, [auth]); // eslint-disable-line react-hooks/exhaustive-deps
  async function action(f: () => Promise<unknown>, message = '') {
    if (busy) return; setBusy(true); setError(''); setNotice('');
    try { await f(); await load(); setNotice(message); } catch (e) { setError(explain(e)); } finally { setBusy(false); }
  }
  const toggle = (role: string) => setRoles(old => old.includes(role) ? old.filter(r => r !== role) : [...old, role]);
  return <div className="space-y-5">
    <button className="min-h-tap underline" disabled={busy} onClick={() => void action(load)}>Оновити співробітників</button>
    {stats && <div className="text-sm"><h2 className="font-medium">Плани за {stats.days} днів</h2><p>Видано: {stats.issued} · отримано: {stats.redeemed} · очікують: {stats.pending} · прострочено: {stats.expired} · скасовано: {stats.revoked}</p></div>}
    <h2 className="text-lg font-medium">Співробітники та ролі</h2>
    <ul className="space-y-3">{staff.map(member => <StaffRow key={member.id} member={member} busy={busy} save={roles => action(() => clinicSetRoles(auth, member.id, roles))} remove={() => action(() => clinicDeactivate(auth, member.id))} />)}</ul>
    <form className="space-y-3" onSubmit={e => { e.preventDefault(); void action(async () => {
      await clinicInvite(auth, { email, displayName: name, roles, ...(target ? { targetMemberId: target } : {}) }); setEmail('');
    }, 'Запрошення передано поштовому серверу. Вступ відбудеться після прийняття одержувачем.'); }}>
      <h2 className="text-lg font-medium">Запросити співробітника</h2>
      {!enabled && <p className="text-sm">Пошту запрошень має налаштувати оператор. Запрошення поки не надсилаються.</p>}
      <label className="block text-sm">Кого запросити<select className="block w-full min-h-tap border rounded-xl" value={target} onChange={e => {
        setTarget(e.target.value); const m = staff.find(m => m.id === e.target.value); setName(m?.displayName ?? ''); setRoles(m?.roles ?? ['doctor']);
      }}><option value="">Новий співробітник</option>{staff.filter(m => m.active && !m.linked).map(m => <option value={m.id} key={m.id}>{m.displayName} — наявний запис</option>)}</select></label>
      <label className="block text-sm">Імʼя запрошеного<input className="block w-full min-h-tap border rounded-xl px-3" value={name} maxLength={200} readOnly={!!target} onChange={e => setName(e.target.value)} /></label>
      <label className="block text-sm">Адреса запрошеного<input className="block w-full min-h-tap border rounded-xl px-3" type="email" maxLength={254} required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <fieldset><legend>Ролі запрошеного</legend>{['doctor', 'admin'].map(role => <label className="flex min-h-tap items-center gap-2" key={role}><input type="checkbox" checked={roles.includes(role)} onChange={() => toggle(role)} />{role === 'doctor' ? 'Лікар' : 'Адміністратор'}</label>)}</fieldset>
      <p className="text-sm">Лист діє 72 години. Повторне надсилання скасує попереднє запрошення. Дані пацієнтів не відкриваються.</p>
      <button className="min-h-tap bg-accent text-white rounded-xl px-4 disabled:opacity-50" disabled={!enabled || busy || !name.trim() || !email.trim() || !roles.length}>Надіслати запрошення</button>
    </form>
    <ul className="space-y-2">{invites.map(i => <li className="text-sm break-words" key={i.id}>{i.email} · {({ sending: 'надсилається', sent: 'очікує прийняття', failed: 'не надіслано', accepted: 'прийнято', revoked: 'відкликано', expired: 'строк минув' } as Record<string, string>)[i.state] ?? i.state}
      {['sending', 'sent'].includes(i.state) && <button className="min-h-tap underline ml-2" disabled={busy} onClick={() => void action(() => clinicRevokeInvite(auth, i.id))}>Відкликати запрошення</button>}</li>)}</ul>
    {transition && <div className="space-y-2 text-sm">
      <h2 className="text-lg font-medium">Перехід на захищений вхід</h2>
      {transition.legacyUntil !== null ? <p>Службові токени не працюватимуть після {new Date(transition.legacyUntil).toLocaleString('uk-UA')}. Продовжити цей строк не можна.</p> : <>
        <p>Ще не приєдналися: {transition.unlinked.length}. Перехід можливий після приєднання всіх активних співробітників.</p>
        <label className="block">Старі токени діятимуть ще<select className="min-h-tap border rounded-xl ml-2" value={grace} onChange={e => setGrace(Number(e.target.value))}><option value={168}>7 днів</option><option value={24}>1 день</option><option value={0}>Вимкнути одразу</option></select></label>
        <label className="flex min-h-tap items-center gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Співробітники перевірили новий вхід; підтверджую відключення токенів</label>
        <button className="min-h-tap underline disabled:opacity-50" disabled={busy || !confirmed || !!transition.unlinked.length} onClick={() => void action(() => clinicCutover(auth, grace), 'Дедлайн старих токенів зафіксовано.')}>Почати перехід</button>
      </>}
    </div>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
  </div>;
}
function StaffRow({ member, busy, save, remove }: { member: StaffMember; busy: boolean; save: (roles: string[]) => Promise<void>; remove: () => Promise<void> }) {
  const [roles, setRoles] = useState(member.roles ?? [member.role]);
  useEffect(() => setRoles(member.roles ?? [member.role]), [member]);
  return <li className="text-sm space-y-1">
    <p>{member.displayName} · {member.active ? member.linked ? 'приєднався' : 'очікує привʼязки' : 'вимкнено'}</p>
    {member.active && <fieldset><legend className="sr-only">Ролі: {member.displayName}</legend>{(['doctor', 'admin'] as const).map(role => <label className="inline-flex min-h-tap items-center gap-2 mr-3" key={role}><input type="checkbox" checked={roles.includes(role)} onChange={() => setRoles(old => old.includes(role) ? old.filter(r => r !== role) : [...old, role])} />{role === 'doctor' ? 'Лікар' : 'Адміністратор'}</label>)}
      <button className="min-h-tap underline mr-3" disabled={busy || !roles.length} onClick={() => void save(roles)}>Зберегти ролі</button>
      <button className="min-h-tap underline" disabled={busy} onClick={() => void remove()}>Вимкнути</button>
    </fieldset>}
  </li>;
}
