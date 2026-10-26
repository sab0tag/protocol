// D110: «Розкласти страву» — a dish described in words, its ingredients with grams like a canteen's breakdown card. The
// model proposes the lines; every number on screen is counted here (a base food — from the base, the rest — the model's
// estimate per 100 g, marked); the person corrects the grams, takes lines out, sets the portions and saves the dish for
// one portion in «Мої страви» — from then on it is found in «Записати їжу» like any dish. Works without sync.
import { Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { db, inDemo } from '../data/db';
import { newId } from '../domain/dates';
import { breakdown, recipeItems, type DishLine } from '../domain/dishBreakdown';
import type { Food, Plan } from '../domain/types';
import { BreakdownEditor } from './BreakdownEditor';
import { t } from '../i18n/uk';
import { ApiError, dishBreakdown } from '../sync/api';
import { currentKeys } from '../sync/runner';
import { saved } from './Toast';

const L = t.dishes.breakdown;
const CONSENT = 'protocol.dishConsent';
export const dishConsented = () => { try { return localStorage.getItem(CONSENT) === '1'; } catch { return false; } };
export const allowDishes = () => { try { localStorage.setItem(CONSENT, '1'); } catch { /* private mode */ } };
const field = 'block min-h-tap w-full rounded-xl border border-line bg-bg px-3';

/** `replace` — a draft «Потрібен склад» (D123) this breakdown becomes, under the same id. */
export function DishBreakdown({ foods, plan, initial = '', replace }: { foods: Map<string, Food>; plan?: Plan; initial?: string; replace?: string }) {
  const [text, setText] = useState(initial);
  const [state, setState] = useState<'none' | 'consent' | 'busy' | 'form'>('none');
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [portions, setPortions] = useState(1);
  const [lines, setLines] = useState<DishLine[]>([]);
  const [note, setNote] = useState('');
  const list = useMemo(() => [...foods.values()], [foods]);

  const ask = async () => {
    setError('');
    if (inDemo()) { setError(L.demo); return; } // D98: nothing of the example goes to the server
    if (!dishConsented()) { setState('consent'); return; }
    setState('busy');
    try {
      const r = await dishBreakdown(currentKeys() ?? null, text.trim(), list.map((f) => f.name));
      const ls = r.readable ? breakdown(r, list) : [];
      if (!ls.length) { setError(r.note || L.unreadable); setState('none'); return; }
      setName(r.name.trim() || text.trim().split(/[-—,:]/)[0]!.trim()); setPortions(Math.max(1, Math.round(r.portions) || 1));
      setLines(ls); setNote(r.note); setState('form');
    } catch (e) {
      const code = e instanceof ApiError ? (e.status === 0 ? 'offline' : e.code) : 'other';
      setError((L.errors as Record<string, string>)[code] ?? L.errors.other); setState('none');
    }
  };
  const save = async () => {
    const recipe = { id: replace ?? newId(), name: name.trim(), items: recipeItems(lines, portions) };
    const was = replace ? await db.recipes.get(replace) : undefined; // «Скасувати» gives the draft back
    await saved(db.recipes.put(recipe), L.saved(recipe.name), () => (was ? db.recipes.put(was) : db.recipes.delete(recipe.id)));
    setState('none'); setLines([]); setText('');
  };

  return (
    <section aria-label={L.title} className="space-y-2 protocol-card rounded-2xl border border-line bg-surface p-3">
      <h2 className="flex items-center gap-2 font-semibold"><Sparkles size={18} className="text-accent" aria-hidden />{L.title}</h2>
      {state !== 'form' && (
        <>
          <p className="text-sm text-muted">{L.hint}</p>
          <label className="block"><span className="sr-only">{L.describe}</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder={L.placeholder} className={`${field} py-2`} /></label>
          <button type="button" disabled={text.trim().length < 3 || state === 'busy'} onClick={() => void ask()}
            className="min-h-tap rounded-xl bg-accent px-4 font-medium text-surface disabled:opacity-40">{state === 'busy' ? L.busy : L.go}</button>
        </>
      )}
      {state === 'consent' && (
        <div className="space-y-2 rounded-xl border border-accent/40 p-2 text-sm">
          <p>{L.consent}</p>
          <button type="button" onClick={() => { allowDishes(); void ask(); }}
            className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface">{L.allow}</button>
        </div>
      )}
      {state === 'form' && (
        <BreakdownEditor foods={foods} {...(plan ? { plan } : {})} name={name} onName={setName} portions={portions} onPortions={setPortions}
          lines={lines} onLines={setLines} note={note}>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!name.trim() || !lines.some((l) => l.grams > 0)} onClick={() => void save()}
              className="min-h-tap rounded-xl bg-accent px-4 font-medium text-surface disabled:opacity-40">{L.save}</button>
            <button type="button" onClick={() => { setState('none'); setLines([]); }} className="min-h-tap rounded-xl border border-line px-4">{t.meal.cancel}</button>
          </div>
        </BreakdownEditor>
      )}
      {error && <p role="alert" className="text-sm text-warn">{error}</p>}
    </section>
  );
}
