import { useLiveQuery } from 'dexie-react-hooks';
import { ScanText } from 'lucide-react';
import { useRef, useState } from 'react';
import { db } from '../data/db';
import { newId } from '../domain/dates';
import type { Allergen, Food, MealItem } from '../domain/types';
import { AllergenPicker } from './AllergenPicker';
import { t } from '../i18n/uk';
import { ApiError, label, type LabelResult } from '../sync/api';
import { currentKeys } from '../sync/runner';
import { shrink } from '../sync/shrink';
import { saved } from './Toast';

const L = t.label;
const field = 'mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3';
type Num = 'kcal' | 'protein' | 'fat' | 'carbs' | 'calciumMg';

/** D45: «Фото етикетки» — Claude reads the nutrition table, the person checks it, the food goes to «Мої продукти»
 *  (and, from «Додати їжу», into the meal with the eaten weight). */
export function LabelScan({ onAdd }: { onAdd?: (item: MealItem) => void }) {
  const meta = useLiveQuery(async () => (await db.meta.get('sync')) ?? null, []);
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'none' | 'consent' | 'busy' | 'form'>('none');
  const [error, setError] = useState('');
  const [allergens, setAllergens] = useState<Allergen[]>([]); // D57: ticked from the package
  const [name, setName] = useState('');
  const [n, setN] = useState<Record<Num, string>>({ kcal: '', protein: '', fat: '', carbs: '', calciumMg: '' });
  const [grams, setGrams] = useState('100');
  const [note, setNote] = useState('');

  const pick = () => {
    setError('');
    if (!meta || !currentKeys()) { setError(t.meal.photoNeedsSync); return; }
    if (!meta.photoConsent) { setState('consent'); return; }
    input.current?.click();
  };
  const read = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    const keys = currentKeys();
    if (!file || !keys) return;
    setState('busy');
    try {
      const r: LabelResult = await label(keys, await shrink(file, 1600, 0.85)); // small print — a bit more detail
      if (!r.readable) { setError(r.note ?? L.unreadable); setState('none'); return; }
      const p = r.per100g, s = (x: number | null) => (x == null ? '' : String(Math.round(x * 10) / 10));
      setName(r.name); setN({ kcal: s(p.kcal), protein: s(p.protein), fat: s(p.fat), carbs: s(p.carbs), calciumMg: s(p.calciumMg) });
      setGrams(String(r.servingG ?? 100)); setNote(r.note ?? ''); setAllergens([]); setState('form');
    } catch (e) {
      const code = e instanceof ApiError ? (e.status === 0 ? 'offline' : e.code) : 'other';
      setError((t.meal.photoErrors as Record<string, string>)[code] ?? t.meal.photoErrors.other); setState('none');
    }
  };
  const num = (v: string) => Math.max(0, Number(v.replace(',', '.')) || 0);
  const save = async (addToMeal: boolean) => {
    const food: Food = { id: `u-${newId()}`, name: name.trim(), custom: true, tags: [],
      per100g: { kcal: num(n.kcal), protein: num(n.protein), fat: num(n.fat), carbs: num(n.carbs), ...(n.calciumMg ? { calciumMg: num(n.calciumMg) } : {}) },
      ...(allergens.length ? { allergens } : {}) };
    await saved(db.foods.put(food), t.toast.food(food.name));
    if (addToMeal && onAdd) onAdd({ foodId: food.id, name: food.name, grams: num(grams) || 100 });
    setState('none');
  };
  const labels: [Num, string][] = [['kcal', 'ккал'], ['protein', 'Б, г'], ['fat', 'Ж, г'], ['carbs', 'В, г'], ['calciumMg', 'Ca, мг']];

  return (
    <div className="mt-2">
      {state !== 'form' && (
        <button type="button" onClick={pick} disabled={state === 'busy'} className="flex min-h-tap items-center gap-2 text-accent underline disabled:opacity-40">
          <ScanText size={18} aria-hidden />{state === 'busy' ? L.busy : L.button}</button>
      )}
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => void read(e.target.files?.[0])} />
      {state === 'consent' && (
        <div className="mt-2 space-y-2 rounded-xl border border-accent/40 p-2 text-sm">
          <p>{t.meal.photoConsent}</p>
          <button type="button" onClick={() => { void db.meta.update('sync', { photoConsent: true }); setState('none'); input.current?.click(); }}
            className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface">{t.meal.photoAllow}</button>
        </div>
      )}
      {state === 'form' && (
        <div className="mt-2 space-y-2 rounded-xl border border-accent/40 p-2">
          <p className="text-sm text-muted">{L.check}</p>
          {note && <p className="text-sm text-warn">{note}</p>}
          <label className="block"><span className="text-sm text-muted">{t.meal.freeName}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={field} /></label>
          <p className="text-sm text-muted">{L.per100}</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {labels.map(([k, l]) => (
              <label key={k} className="block"><span className="text-sm text-muted">{l}</span>
                <input inputMode="decimal" value={n[k]} onChange={(e) => setN((x) => ({ ...x, [k]: e.target.value }))} className={field} /></label>
            ))}
          </div>
          <AllergenPicker value={allergens} onChange={setAllergens} />
          {onAdd && (
            <label className="block w-40"><span className="text-sm text-muted">{L.eaten}</span>
              <input inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} className={field} /></label>
          )}
          <div className="flex flex-wrap gap-2">
            {onAdd && <button type="button" disabled={!name.trim()} onClick={() => void save(true)}
              className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface disabled:opacity-40">{L.saveAdd}</button>}
            <button type="button" disabled={!name.trim()} onClick={() => void save(false)}
              className={`min-h-tap rounded-xl px-3 font-medium disabled:opacity-40 ${onAdd ? 'border border-accent text-accent' : 'bg-accent text-surface'}`}>{L.saveOnly}</button>
            <button type="button" onClick={() => setState('none')} className="min-h-tap rounded-xl border border-line px-3">{t.meal.cancel}</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-1 text-sm text-warn">{error}</p>}
    </div>
  );
}
