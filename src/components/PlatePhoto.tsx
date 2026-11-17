// D32: a photo of the plate → a «Розпізнано» draft to confirm. Shared by the meal tile (D159) and the full meal form.
import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { db } from '../data/db';
import { fromPhoto } from '../domain/photo';
import { dishItem } from '../domain/recipes';
import type { Recognized } from '../domain/foodSearch';
import type { Food, Recipe } from '../domain/types';
import { t } from '../i18n/uk';
import { ApiError, photo as recognizePhoto } from '../sync/api';
import { currentKeys } from '../sync/runner';
import { shrink } from '../sync/shrink';

export type PhotoState = { state: 'none' | 'busy' | 'consent' | 'nosync' } | { state: 'error'; message: string }
  | { state: 'done'; rows: Recognized[]; note?: string };

export function usePlatePhoto({ foods, recipes, usual }: { foods: Map<string, Food> | undefined; recipes: Recipe[] | undefined; usual: ReadonlySet<string> }) {
  const [photo, setPhoto] = useState<PhotoState>({ state: 'none' });
  const input = useRef<HTMLInputElement>(null);
  const syncMeta = useLiveQuery(async () => (await db.meta.get('sync')) ?? null, []);
  const pick = () => {
    if (!syncMeta || !currentKeys()) return setPhoto({ state: 'nosync' });
    if (!syncMeta.photoConsent) return setPhoto({ state: 'consent' });
    input.current?.click();
  };
  const allow = () => { void db.meta.update('sync', { photoConsent: true }); setPhoto({ state: 'none' }); input.current?.click(); };
  const onFile = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    const keys = currentKeys();
    if (!file || !keys || !foods) return;
    setPhoto({ state: 'busy' });
    try {
      const image = await shrink(file);
      const all = [...foods.values()];
      const result = await recognizePhoto(keys, image, all.map((f) => f.name), (recipes ?? []).map((r) => r.name));
      setPhoto({ state: 'done', rows: fromPhoto(result, all, recipes ?? [], dishItem, usual), note: result.note ?? undefined });
    } catch (e) {
      const code = e instanceof ApiError ? (e.status === 0 ? 'offline' : e.code) : 'other';
      setPhoto({ state: 'error', message: (t.meal.photoErrors as Record<string, string>)[code] ?? t.meal.photoErrors.other });
    }
  };
  const fileInput = <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />;
  return { photo, setPhoto, pick, allow, fileInput };
}

/** The photo's state under a field: consent, «needs sync», busy, an error, an empty result. The draft itself is the caller's. */
export function PhotoStatus({ photo, allow }: { photo: PhotoState; allow: () => void }) {
  if (photo.state === 'consent') return (
    <div className="mt-2 space-y-2 rounded-xl border border-accent/40 p-2 text-sm">
      <p>{t.meal.photoConsent}</p>
      <button type="button" onClick={allow} className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface">{t.meal.photoAllow}</button>
    </div>
  );
  if (photo.state === 'nosync') return <p className="mt-2 text-sm text-muted">{t.meal.photoNeedsSync}</p>;
  if (photo.state === 'busy') return <p role="status" className="mt-2 text-sm text-muted">{t.meal.photoBusy}</p>;
  if (photo.state === 'error') return <p role="alert" className="mt-2 text-sm text-warn">{photo.message}</p>;
  if (photo.state === 'done' && photo.rows.length === 0) return <p role="status" className="mt-2 text-sm text-muted">{photo.note ?? t.meal.photoEmpty}</p>;
  return null;
}
