import { useState } from 'react';
import { Check, Pencil, Plus, UserRound } from 'lucide-react';
import { SceneHeader } from '../components/SceneHeader';
import { activeProfileId, readProfiles, saveProfile, switchProfile, type Profile } from '../data/profiles';
import { inDemo } from '../data/db';
import { t } from '../i18n/uk';
const L = t.profiles;
export function Profiles() {
  const [profiles, setProfiles] = useState(() => readProfiles().profiles);
  const [editing, setEditing] = useState<Profile>();
  const [error, setError] = useState('');
  const labels = { self: L.self, child: L.child, relative: L.relative };
  return <section className="space-y-4 pt-4">
    <SceneHeader title={L.title} description={inDemo() ? L.demo : L.local} />
    {!inDemo() && <>
      <button type="button" className="protocol-action-secondary flex items-center gap-2" onClick={() => { setError(''); setEditing({ id: crypto.randomUUID(), name: '', relation: 'relative' }); }}><Plus size={18} aria-hidden />{L.add}</button>
      <ul className="protocol-card divide-y divide-line">
        {profiles.map(p => <li key={p.id} className="flex items-center gap-3 p-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent" aria-hidden>{p.name ? Array.from(p.name)[0]?.toLocaleUpperCase('uk') : <UserRound />}</span>
          <div className="min-w-0 flex-1"><p className="break-words font-semibold">{p.name || L.self}</p><p className="text-sm text-muted">{labels[p.relation]}</p>
          {p.id === activeProfileId ? <span className="flex items-center gap-1 text-sm text-accent"><Check size={14} aria-hidden />{L.active}</span> : <button type="button" className="min-h-tap text-accent underline" onClick={() => { try { switchProfile(p.id); } catch { setError(L.error); } }}>{L.select}: {p.name}</button>}</div>
          <button type="button" className="flex min-h-tap min-w-tap items-center justify-center text-accent" aria-label={`${L.edit}: ${p.name || L.self}`} onClick={() => { setError(''); setEditing({ ...p }); }}><Pencil size={18} aria-hidden /></button>
        </li>)}
      </ul>
      {editing && <form aria-label={L.edit} className="protocol-card space-y-4 p-4" onSubmit={e => {
        e.preventDefault(); try { saveProfile(editing); setProfiles(readProfiles().profiles); setEditing(undefined); setError(''); } catch { setError(L.error); }
      }}>
        <label className="block">{L.name}<input autoFocus required maxLength={60} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className="mt-1 block min-h-tap w-full rounded-xl border border-line bg-surface px-3" /></label>
        <label className="block">{L.relation}<select value={editing.relation} onChange={e => setEditing({ ...editing, relation: e.target.value as Profile['relation'] })} className="mt-1 block min-h-tap w-full rounded-xl border border-line bg-surface px-3">{Object.entries(labels).map(([v, name]) => <option key={v} value={v}>{name}</option>)}</select></label>
        <div className="flex flex-wrap gap-2"><button disabled={!editing.name.trim()} className="protocol-action disabled:opacity-40">{L.save}</button><button type="button" className="protocol-action-secondary" onClick={() => setEditing(undefined)}>{L.cancel}</button></div>
      </form>}
    </>}
    {error && <p role="alert" className="text-warn">{error}</p>}
  </section>;
}
