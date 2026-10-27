/** Local profile directory. Medical records stay in a separate database per person.
 * The original database and keys belong to `main`; upgrades never move or copy them. */
export interface Profile { id: string; name: string; relation: 'self' | 'child' | 'relative'; motivation?: boolean }
interface Directory { v: 1; active: string; profiles: Profile[] }
const KEY = 'protocol.profiles.v1';
const initial = (): Directory => ({ v: 1, active: 'main', profiles: [{ id: 'main', name: '', relation: 'self' }] });
export function readProfiles(): Directory {
  const raw = localStorage.getItem(KEY);
  if (!raw) return initial();
  const d = JSON.parse(raw) as Directory;
  if (d.v !== 1 || !Array.isArray(d.profiles) || !d.profiles.length ||
    !d.profiles.every(p => typeof p.name === 'string' && p.name.length <= 60 && /^(main|[a-f0-9-]{36})$/.test(p.id) && ['self', 'child', 'relative'].includes(p.relation) && (p.motivation === undefined || typeof p.motivation === 'boolean')) ||
    new Set(d.profiles.map(p => p.id)).size !== d.profiles.length || !d.profiles.some(p => p.id === d.active)) throw new Error('Не вдалося прочитати профілі. Дані збережено; спробуйте перезавантажити сторінку.');
  return d;
}
// Fixed for the lifetime of this page: no writes into another person's database mid-request.
// Notifications issued before profiles belong to the original person. Resolve before opening any DB.
if (typeof window !== 'undefined' && new URL(location.href).searchParams.get('protocol-profile') === 'main') {
  const directory = readProfiles();
  localStorage.setItem(KEY, JSON.stringify({ ...directory, active: 'main' }));
  const clean = new URL(location.href); clean.searchParams.delete('protocol-profile');
  history.replaceState(null, '', clean);
}
export const activeProfileId = (() => { try { return readProfiles().active; } catch { return 'main'; } })();
export const profileDatabase = (id: string) => id === 'main' ? 'protocol' : `protocol-profile-${id}`;
export function profileKey(key: string): string { return activeProfileId === 'main' ? key : `${key}.profile.${activeProfileId}`; }
export function activeProfile(): Profile { return readProfiles().profiles.find(p => p.id === activeProfileId)!; }
export function saveProfile(profile: Profile): void {
  const name = profile.name.trim();
  if (!name || name.length > 60) throw new Error('Вкажіть ім’я: від 1 до 60 символів.');
  const d = readProfiles();
  const old = d.profiles.findIndex(p => p.id === profile.id);
  if (old < 0) d.profiles.push({ ...profile, name }); else d.profiles[old] = { ...profile, name };
  localStorage.setItem(KEY, JSON.stringify(d));
  window.dispatchEvent(new Event('protocol-profiles-changed'));
}
export function switchProfile(id: string): void {
  const d = readProfiles();
  if (!d.profiles.some(p => p.id === id)) throw new Error('Профіль не знайдено.');
  localStorage.setItem(KEY, JSON.stringify({ ...d, active: id }));
  location.hash = '#/'; location.reload();
}
// Keep tabs consistent, including when a different tab switches the active person.
if (typeof window !== 'undefined') window.addEventListener('storage', e => {
  if (e.key !== KEY && e.key !== null) return;
  try {
    if (readProfiles().active !== activeProfileId) location.reload();
    else window.dispatchEvent(new Event('protocol-profiles-changed'));
  } catch { location.reload(); }
});
