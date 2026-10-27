import { Camera, Trash2, UserRound } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { db } from '../data/db';
import { shrink } from '../sync/shrink';
import { t } from '../i18n/uk';

const L = t.profile;

export function ProfilePhotoSettings() {
  const photo = useLiveQuery(() => db.profile.get('self'), []);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const choose = async (file?: File) => {
    if (!file) return;
    setError('');
    if (!file.type.startsWith('image/')) {
      setError(L.invalidType);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError(L.tooLarge);
      return;
    }
    setBusy(true);
    try {
      const jpeg = await shrink(file, 512, 0.82);
      await db.profile.put({ key: 'self', jpeg });
    } catch {
      setError(L.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setError('');
    try {
      await db.profile.delete('self');
    } catch {
      setError(L.removeFailed);
    }
  };

  return (
    <section aria-labelledby="profile-photo-heading" className="protocol-card flex items-center gap-4 rounded-2xl border border-line bg-surface p-4">
      {photo ? (
        <img src={`data:image/jpeg;base64,${photo.jpeg}`} alt={L.title} className="h-16 w-16 shrink-0 rounded-full object-cover" />
      ) : (
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent" aria-hidden>
          <UserRound size={30} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h2 id="profile-photo-heading" className="font-semibold">{L.title}</h2>
        <p className="mt-1 text-sm text-muted">{L.localOnly}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => input.current?.click()}
            className="inline-flex min-h-tap items-center gap-2 rounded-xl bg-accent px-3 font-medium text-surface disabled:opacity-50">
            <Camera size={17} aria-hidden />{busy ? L.saving : photo ? L.change : L.choose}
          </button>
          {photo && <button type="button" onClick={() => void remove()} className="inline-flex min-h-tap items-center gap-2 rounded-xl border border-line px-3">
            <Trash2 size={16} aria-hidden />{L.remove}
          </button>}
        </div>
        <input ref={input} type="file" accept="image/*" aria-label={L.choose} className="sr-only"
          onChange={(event) => { void choose(event.target.files?.[0]); event.target.value = ''; }} />
        {error && <p role="alert" className="mt-2 text-sm text-warn">{error}</p>}
      </div>
    </section>
  );
}
