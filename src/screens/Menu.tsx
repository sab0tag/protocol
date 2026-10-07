import { addDays, format, parseISO } from 'date-fns';
import { uk } from 'date-fns/locale';
import { useLiveQuery } from 'dexie-react-hooks';
import { Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../data/db';
import { useAllEntries, useFoods, usePlan, useRecipes } from '../data/queries';
import { atLocal, dateOf, newId, todayISO } from '../domain/dates';
import { amountText } from '../domain/foodSearch';
import { frequentItems } from '../domain/habits';
import { acceptPlan, draftFrom, draftTotals, menuRequest, type MenuDraft } from '../domain/menu';
import { effectiveTargets, lineNutrients, round } from '../domain/nutrition';
import { dishItem } from '../domain/recipes';
import { t } from '../i18n/uk';
import { useUi } from '../store/ui';
import { ApiError, menu as askMenu } from '../sync/api';
import { currentKeys } from '../sync/runner';

const L = t.menu;
const field = 'mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3';
const tomorrow = () => format(addDays(new Date(), 1), 'yyyy-MM-dd');
const dm = (d: string) => format(parseISO(d), 'd MMMM, EEEE', { locale: uk });

/** «Меню на завтра» (SPEC.md D33): the model proposes a day within the plan, the app checks and counts it,
 *  the person accepts it as planned meals and later ticks what was eaten. */
export function Menu() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const plan = usePlan();
  const foods = useFoods();
  const recipes = useRecipes();
  const all = useAllEntries();
  const meta = useLiveQuery(async () => (await db.meta.get('sync')) ?? null, []);
  const [date, setDate] = useState(() => { const d = params.get('date'); return d && d >= todayISO() ? d : tomorrow(); });
  const [wish, setWish] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<MenuDraft | null>(null);
  const [consent, setConsent] = useState(false);

  if (!plan || !foods || !recipes || !all || meta === undefined) return null;
  const keys = currentKeys();
  const existing = all.filter((e) => dateOf(e.at) === date);
  const replacing = existing.some((e) => e.menu && e.status === 'planned');

  const make = async () => {
    if (!keys) return;
    if (!meta?.menuConsent) { setConsent(true); return; }
    setBusy(true); setError(''); setDraft(null);
    try {
      const { targets, rules } = menuRequest(plan, date);
      const recent = all.filter((e) => dateOf(e.at) < date && dateOf(e.at) >= format(addDays(parseISO(date), -7), 'yyyy-MM-dd'));
      const usual = frequentItems(all, todayISO(), 30, 20).map((f) => f.item.name);
      const result = await askMenu(keys, { date, targets, rules, wish, usual,
        foods: [...foods.values()].map((f) => f.name), dishes: recipes.map((r) => r.name) });
      const d = draftFrom(result, { plan, date, foods, recipes, recentEntries: recent, dishItem });
      if (d.meals.length === 0) setError(L.empty); else setDraft(d);
    } catch (e) {
      const code = e instanceof ApiError ? (e.status === 0 ? 'offline' : e.code) : 'other';
      setError((L.errors as Record<string, string>)[code] ?? L.errors.other);
    } finally { setBusy(false); }
  };

  const accept = async () => {
    if (!draft) return;
    const { remove, add } = acceptPlan(draft, existing, newId, atLocal);
    await db.transaction('rw', db.entries, async () => { await db.entries.bulkDelete(remove); await db.entries.bulkPut(add); });
    useUi.getState().setDate(draft.date);
    navigate('/');
  };

  const targets = effectiveTargets(plan, date);
  const totals = draft && draftTotals(draft.meals, foods);
  const setMeals = (fn: (m: MenuDraft['meals']) => MenuDraft['meals']) => setDraft((d) => d && { ...d, meals: fn(d.meals) });

  return (
    <section className="space-y-4 pt-6">
      <h1 className="text-2xl font-semibold">{L.title}</h1>
      <p className="text-sm text-muted">{L.hint}</p>

      <div className="space-y-3 rounded-2xl border border-line bg-surface p-3">
        <label className="block"><span className="text-sm text-muted">{L.date}</span>
          <input type="date" value={date} min={todayISO()} onChange={(e) => { setDate(e.target.value); setDraft(null); }} className={field} /></label>
        <label className="block"><span className="text-sm text-muted">{L.wish}</span>
          <input value={wish} onChange={(e) => setWish(e.target.value)} placeholder={L.wishPh} maxLength={300} className={field} /></label>
        {!meta || !keys ? <p className="text-sm text-muted">{L.needsSync}</p> : consent && !meta.menuConsent ? (
          <div className="space-y-2 rounded-xl border border-accent/40 p-2 text-sm">
            <p>{L.consent}</p>
            <button type="button" onClick={async () => { await db.meta.update('sync', { menuConsent: true }); setConsent(false); }}
              className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface">{L.allow}</button>
          </div>
        ) : (
          <button type="button" onClick={() => void make()} disabled={busy}
            className="flex min-h-tap items-center gap-2 rounded-xl bg-accent px-3 font-medium text-surface disabled:opacity-40">
            <Sparkles size={18} aria-hidden />{draft ? L.again : L.make}</button>
        )}
        {busy && <p role="status" className="text-sm text-muted">{L.busy}</p>}
        {error && <p role="alert" className="text-sm text-warn">{error}</p>}
      </div>

      {draft && totals && (
        <>
          <p className="font-medium">{dm(draft.date)}</p>
          {draft.meals.map((m, i) => (
            <div key={i} className="rounded-2xl border border-line bg-surface p-3">
              <div className="mb-1 flex items-center gap-2">
                <h2 className="flex-1 font-semibold">{m.title}</h2>
                <input type="time" value={m.time} aria-label={`${m.title}: ${t.meal.time}`}
                  onChange={(e) => setMeals((ms) => ms.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))}
                  className="min-h-tap rounded-xl border border-line bg-bg px-2" />
              </div>
              <ul className="divide-y divide-line">
                {m.items.map((it, k) => (
                  <li key={k} className="flex min-h-tap items-center gap-2">
                    <span className="flex-1">{it.name} <span className="text-muted">· {amountText(it)}{it.unit || it.recipe ? ` ≈ ${it.grams} г` : ''}</span></span>
                    <span className="tabular text-sm text-muted">{round(lineNutrients(it, foods).kcal)} {t.units.kcal}</span>
                    <button type="button" aria-label={`${L.remove}: ${it.name}`} className="flex min-h-tap min-w-tap items-center justify-center text-muted"
                      onClick={() => setMeals((ms) => ms.map((x, j) => (j === i ? { ...x, items: x.items.filter((_, n) => n !== k) } : x)).filter((x) => x.items.length))}>
                      <X size={18} /></button>
                  </li>
                ))}
              </ul>
              {m.notes.length > 0 && <ul className="mt-1 text-sm text-warn">{m.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
            </div>
          ))}

          <div className="rounded-2xl border border-line bg-surface p-3 tabular">
            <p className="mb-1 font-semibold">{L.total}</p>
            <p>{round(totals.kcal)} {t.units.kcal}{targets.kcal ? ` / ${L.target} ${targets.kcal}` : ''}</p>
            <p className="text-sm text-muted">
              Б {round(totals.protein)}{targets.proteinG ? ` / ${targets.proteinG}` : ''} ·
              {' '}Ж {round(totals.fat)}{targets.fatG ? ` / ${targets.fatG}` : ''} ·
              {' '}В {round(totals.carbs)}{targets.carbsG?.max != null ? ` / до ${targets.carbsG.max}` : targets.carbsG?.min != null ? ` / ≥ ${targets.carbsG.min}` : ''} ·
              {' '}Ca {round(totals.calciumMg)}{targets.calciumMg ? ` / ${targets.calciumMg}` : ''} {t.units.mg}
            </p>
            <p className="mt-1 text-xs text-muted">✓ {L.checked}</p>
          </div>

          {draft.tips.length > 0 && (
            <div className="rounded-2xl border border-line bg-surface p-3">
              <p className="mb-1 font-semibold">{L.tips}</p>
              <ul className="list-disc space-y-1 pl-5">{draft.tips.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          )}

          {replacing && <p className="text-sm text-muted">{L.replaces}</p>}
          <button type="button" onClick={() => void accept()} disabled={draft.meals.length === 0}
            className="min-h-tap w-full rounded-xl bg-accent px-4 font-medium text-surface disabled:opacity-40">{L.accept(format(parseISO(draft.date), 'd MMMM', { locale: uk }))}</button>
        </>
      )}
    </section>
  );
}
