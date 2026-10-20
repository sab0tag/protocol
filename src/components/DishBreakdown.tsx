// D110: «Розкласти страву» — a dish described in words, its ingredients with grams like a canteen's breakdown card. The
// model proposes the lines; every number on screen is counted here (a base food — from the base, the rest — the model's
// estimate per 100 g, marked); the person corrects the grams, takes lines out, sets the portions and saves the dish for
// one portion in «Мої страви» — from then on it is found in «Записати їжу» like any dish. Works without sync.
import { Sparkles, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { db, inDemo } from '../data/db';
import { newId, todayISO } from '../domain/dates';
import { breakdown, lineItem, recipeItems, type DishLine } from '../domain/dishBreakdown';
import { mealNutrients, round } from '../domain/nutrition';
import type { Food, Plan } from '../domain/types';
import { checkMeal } from '../domain/rules';
import { t } from '../i18n/uk';
import { ApiError, dishBreakdown } from '../sync/api';
import { currentKeys } from '../sync/runner';
import { saved } from './Toast';

const L = t.dishes.breakdown;
const CONSENT = 'protocol.dishConsent';
const consented = () => { try { return localStorage.getItem(CONSENT) === '1'; } catch { return false; } };
const field = 'block min-h-tap w-full rounded-xl border border-line bg-bg px-3';

export function DishBreakdown({ foods, plan, initial = '' }: { foods: Map<string, Food>; plan?: Plan; initial?: string }) {
  const [text, setText] = useState(initial);
  const [state, setState] = useState<'none' | 'consent' | 'busy' | 'form'>('none');
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [portions, setPortions] = useState(1);
  const [lines, setLines] = useState<DishLine[]>([]);
  const [note, setNote] = useState('');
  const list = useMemo(() => [...foods.values()], [foods]);
  const nOf = (ls: DishLine[]) => mealNutrients(ls.map(lineItem), foods);
  const total = useMemo(() => mealNutrients(lines.map(lineItem), foods), [lines, foods]);
  const weight = lines.reduce((g, l) => g + l.grams, 0);
  // D111: what the plan's check says of each line — the estimated ones too, by what the model marked them as
  const hits = useMemo(() => (plan ? checkMeal({ plan, date: todayISO(), foods, dayEntries: [], recentEntries: [], meal: lines.map(lineItem) }) : [])
    .map((c) => [...new Set(c.hits.map((h) => h.message))]), [plan, foods, lines]);

  const ask = async () => {
    setError('');
    if (inDemo()) { setError(L.demo); return; } // D98: nothing of the example goes to the server
    if (!consented()) { setState('consent'); return; }
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
    const recipe = { id: newId(), name: name.trim(), items: recipeItems(lines, portions) };
    await saved(db.recipes.put(recipe), L.saved(recipe.name), () => db.recipes.delete(recipe.id));
    setState('none'); setLines([]); setText('');
  };
  const set = (key: string, grams: number) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, grams } : l)));
  const fmt = (n: number) => String(round(n, n < 10 ? 1 : 0)).replace('.', ',');

  return (
    <section aria-label={L.title} className="space-y-2 rounded-2xl border border-line bg-surface p-3">
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
          <button type="button" onClick={() => { try { localStorage.setItem(CONSENT, '1'); } catch { /* private mode */ } void ask(); }}
            className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface">{L.allow}</button>
        </div>
      )}
      {state === 'form' && (
        <div className="space-y-3">
          <label className="block"><span className="text-sm text-muted">{L.name}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={field} /></label>
          <label className="block w-40"><span className="text-sm text-muted">{L.portions}</span>
            <input type="number" inputMode="decimal" min={1} step={1} value={portions} onChange={(e) => setPortions(Math.max(1, Number(e.target.value) || 1))} className={field} /></label>
          {note && <p className="text-sm text-warn">{note}</p>}
          <p className="text-xs text-muted">{L.check}</p>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {lines.map((l, i) => { const n = nOf([l]); return (
              <li key={l.key} data-ingredient={l.food?.name ?? l.said} className="flex items-start gap-2 px-2 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{l.food?.name ?? l.said}</span>
                  <span className={`block text-xs ${l.food ? 'text-muted' : 'text-warn'}`}>{l.food ? L.fromBase : L.estimate}{l.amountSaid ? '' : ` · ${L.amountGuessed}`}</span>
                  <span className="tabular block text-xs text-muted">{L.line(fmt(n.kcal), fmt(n.protein), fmt(n.fat), fmt(n.carbs))}</span>
                  {l.est && (l.est.tags.length > 0 || l.est.allergens.length > 0) && <span className="block text-xs text-muted">{[...l.est.tags.map((x) => L.tags[x]),
                    ...(l.est.allergens.length ? [L.allergens(l.est.allergens.map((a) => t.allergen.name[a]).join(', '))] : [])].join(' · ')}</span>}
                  {(hits[i]?.length ?? 0) > 0 && <span className="block text-xs text-warn">{hits[i]!.join(' · ')}</span>}
                </span>
                <label className="w-20 shrink-0"><span className="sr-only">{L.grams(l.food?.name ?? l.said)}</span>
                  <input type="number" inputMode="decimal" min={0} step={1} value={l.grams} onChange={(e) => set(l.key, Math.max(0, Number(e.target.value) || 0))}
                    className="min-h-[2.25rem] w-full rounded-lg border border-line bg-bg px-2 text-right" /></label>
                <span className="pt-2 text-xs text-muted">г</span>
                <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`${t.meal.remove}: ${l.food?.name ?? l.said}`}
                  className="flex h-9 w-8 items-center justify-center text-muted"><X size={16} aria-hidden /></button>
              </li>); })}
          </ul>
          <div className="tabular rounded-xl bg-bg p-2 text-sm">
            <p>{L.total(fmt(weight), fmt(total.kcal), fmt(total.protein), fmt(total.fat), fmt(total.carbs))}</p>
            {portions > 1 && <p className="font-medium">{L.perPortion(fmt(weight / portions), fmt(total.kcal / portions), fmt(total.protein / portions), fmt(total.fat / portions), fmt(total.carbs / portions))}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!name.trim() || !lines.some((l) => l.grams > 0)} onClick={() => void save()}
              className="min-h-tap rounded-xl bg-accent px-4 font-medium text-surface disabled:opacity-40">{L.save}</button>
            <button type="button" onClick={() => { setState('none'); setLines([]); }} className="min-h-tap rounded-xl border border-line px-4">{t.meal.cancel}</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-warn">{error}</p>}
    </section>
  );
}
