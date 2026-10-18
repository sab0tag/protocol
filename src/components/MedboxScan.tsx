// D89: «Фото упаковки» — the name off the box, found in the register, shown to confirm. The strength printed on the box
// is said, never put in the dose: the dose is the doctor's.
import { useLiveQuery } from 'dexie-react-hooks';
import { Camera } from 'lucide-react';
import { useRef, useState } from 'react';
import { db } from '../data/db';
import { t } from '../i18n/uk';
import { ApiError, medbox, type MedboxResult } from '../sync/api';
import { currentKeys } from '../sync/runner';
import { shrink } from '../sync/shrink';
import { NeedsSync } from './NeedsSync';

const P = t.plan;

export function MedboxScan({ onRead }: { onRead: (r: MedboxResult) => void }) {
  const meta = useLiveQuery(async () => (await db.meta.get('sync')) ?? null, []);
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'none' | 'nosync' | 'consent' | 'busy'>('none');
  const [said, setSaid] = useState('');
  const pick = () => {
    setSaid('');
    if (!meta || !currentKeys()) return setState('nosync');
    if (!meta.medboxConsent) return setState('consent');
    input.current?.click();
  };
  const read = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    const keys = currentKeys();
    if (!file || !keys) return;
    setState('busy');
    try {
      const r = await medbox(keys, await shrink(file, 1600, 0.85));
      if (!r.readable || !r.name) { setSaid(r.note ?? P.medPhotoUnreadable); return; }
      onRead(r);
      setSaid(P.medPhotoRead([r.name, r.strength, r.form].filter(Boolean).join(', ')));
    } catch (e) {
      const code = e instanceof ApiError ? (e.status === 0 ? 'offline' : e.code) : 'other';
      setSaid((t.meal.photoErrors as Record<string, string>)[code] ?? t.meal.photoErrors.other);
    } finally { setState((s) => (s === 'busy' ? 'none' : s)); }
  };
  return (
    <div className="-mt-2 space-y-1">
      <button type="button" onClick={pick} disabled={state === 'busy'} className="flex min-h-tap items-center gap-2 text-sm text-accent underline disabled:opacity-40">
        <Camera size={16} aria-hidden />{state === 'busy' ? P.medPhotoBusy : P.medPhoto}</button>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => void read(e.target.files?.[0])} />
      {state === 'nosync' && <NeedsSync text={P.medPhotoNeedsSync} />}
      {state === 'consent' && (
        <div className="space-y-2 rounded-xl border border-accent/40 p-2 text-sm">
          <p>{P.medPhotoConsent}</p>
          <button type="button" onClick={async () => { await db.meta.update('sync', { medboxConsent: true }); setState('none'); input.current?.click(); }}
            className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface">{P.medPhotoAllow}</button>
        </div>
      )}
      {said && <p role="status" className="text-sm text-muted">{said}</p>}
    </div>
  );
}
