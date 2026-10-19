import { addDays, format, parseISO } from 'date-fns';
import { Loading } from '../components/Recovery';
import { saved } from '../components/Toast';
import { uk } from 'date-fns/locale';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, RefreshCw, ShoppingCart, Sparkles, Undo2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AiSpend } from '../components/AiSpend';
import { ItemPicker } from '../components/ItemPicker';
import { planAllergies } from '../domain/allergens';
import { db } from '../data/db';
import { keep, kept } from '../data/kept';
import { useAllEntries, useFoods, usePlan, useRecipes } from '../data/queries';
import { atLocal, dateOf, newId, todayISO } from '../domain/dates';
import { amountText, needsGrams } from '../domain/foodSearch';
import { frequentItems } from '../domain/habits';
import { acceptPlan, asResult, draftFrom, draftTotals, likeYesterday, menuRequest, nextAlternative, type MenuDraft, type MenuResult } from '../domain/menu';
import { effectiveTargets, lineNutrients, round } from '../domain/nutrition';
import { dishItem } from '../domain/recipes';
import type { MealItem } from '../domain/types';
import { t } from '../i18n/uk';
import { useUi } from '../store/ui';
import { ApiError, menu as askMenu } from '../sync/api';
import { currentKeys } from '../sync/runner';

const L = t.menu;
const field = 'mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3';
const tomorrow = () => format(addDays(new Date(), 1), 'yyyy-MM-dd');
const plus = (d: string, n: number) => format(addDays(parseISO(d), n), 'yyyy-MM-dd');
const dm = (d: string) => format(parseISO(d), 'd MMMM, EEEE', { locale: uk });

/** D87: an unaccepted menu, kept on the device until it is accepted or a day old. */
interface Kept { date: string; days: number; wish: string; drafts: MenuDraft[] }

/** «Меню на завтра» (SPEC.md D33, D37): the model proposes 1–3 days within the plan (or «Як учора» copies yesterday
 *  for free), the app checks and counts them, ↻ swaps a line for a similar one, the person accepts them as planned
 *  meals and later ticks what was eaten; «Що купити» sums them up. */
export function Menu() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const plan = usePlan();
  const foods = useFoods();
  const recipes = useRecipes();
  const all = useAllEntries();
  const meta = useLiveQuery(async () => (await db.meta.get('sync')) ?? null, []);
  // D87: a menu made but not accepted yet comes back after the phone was locked (the page may have been reloaded)
  const [back] = useState(() => {
    const k = kept<Kept>('menu'), asked = params.get('date');
    return k && k.drafts.length && k.drafts[0]!.date >= todayISO() && (!asked || asked === k.date) ? k : undefined;
  });
  const [date, setDate] = useState(() => { const d = params.get('date'); return back?.date ?? (d && d >= todayISO() ? d : tomorrow()); });
  const [days, setDays] = useState(back?.days ?? 1);
  const [wish, setWish] = useState(() => params.get('wish') ?? back?.wish ?? ''); // D74: kept across enabling sync
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<MenuDraft[]>(back?.drafts ?? []);
  useEffect(() => { keep<Kept>('menu', drafts.length ? { date, days, wish, drafts } : undefined); }, [date, days, wish, drafts]);
  const [consent, setConsent] = useState(false);
  const [adding, setAdding] = useState<string | null>(null); // D54: "day:meal" with the picker open

  if (!plan || !foods || !recipes || !all || meta === undefined) return <Loading />;
  const keys = currentKeys();
  const recentFor = (d: string) => all.filter((e) => dateOf(e.at) < d && dateOf(e.at) >= plus(d, -7));
  const build = (result: MenuResult, d: string, scale = true, keepEmpty = false) =>
    draftFrom(result, { plan, date: d, foods, recipes, recentEntries: recentFor(d), dishItem, scale, keepEmpty });
  const fail = (e: unknown) => {
    const code = e instanceof ApiError ? (e.status === 0 ? 'offline' : e.code) : 'other';
    setError((L.errors as Record<string, string>)[code] ?? L.errors.other);
  };

  const make = async (consented = !!meta?.menuConsent) => {
    if (!keys) return;
    if (!consented) { setConsent(true); return; }
    setError(''); setDrafts([]);
    const out: MenuDraft[] = [];
    try {
      const usual = frequentItems(all, todayISO(), 30, 20).map((f) => f.item.name);
      for (let i = 0; i < days; i++) {
        const d = plus(date, i);
        setBusy(days > 1 ? L.busyDay(i + 1, days) : L.busy);
        const { targets, rules } = menuRequest(plan, d);
        const avoid = [...new Set(out.flatMap((x) => x.meals.flatMap((m) => m.items.map((it) => it.name))))];
        const result = await askMenu(keys, { date: d, targets, rules, wish, usual, avoid,
          foods: [...foods.values()].map((f) => f.name), dishes: recipes.map((r) => r.name) });
        const draft = build(result, d);
        if (draft.meals.length) out.push(draft);
        setDrafts([...out]);
      }
      if (!out.length) setError(L.empty);
    } catch (e) { fail(e); } finally { setBusy(''); }
  };

  const yesterday = () => {
    setError('');
    const r = likeYesterday(all, date);
    if (!r) { setError(L.noYesterday); return; }
    setDrafts([build(r, date, false)]);
  };

  /** An edit, then the app's check again (swaps and warnings), without rescaling the portions; an emptied meal stays (D54). */
  const edit = (di: number, mi: number, fn: (items: MealItem[]) => MealItem[]) => setDrafts((ds) => ds.map((d, i) => {
    if (i !== di) return d;
    const meals = d.meals.map((m, j) => (j === mi ? { ...m, items: fn(m.items) } : m));
    return build(asResult(meals, d.tips), d.date, false, true);
  }));
  const setTime = (di: number, mi: number, time: string) =>
    setDrafts((ds) => ds.map((d, i) => (i === di ? { ...d, meals: d.meals.map((m, j) => (j === mi ? { ...m, time } : m)) } : d)));

  const accept = async () => {
    const removed = all.filter((e) => drafts.some((d) => dateOf(e.at) === d.date) && e.menu && e.status === 'planned');
    const added: string[] = [];
    const ok = await saved(() => db.transaction('rw', db.entries, async () => {
      for (const d of drafts) {
        const { remove, add } = acceptPlan(d, all.filter((e) => dateOf(e.at) === d.date), newId, atLocal);
        await db.entries.bulkDelete(remove);
        await db.entries.bulkPut(add);
        added.push(...add.map((e) => e.id));
      }
      return true;
    }), t.toast.menu(drafts.length), () => db.transaction('rw', db.entries, async () => {
      await db.entries.bulkDelete(added);
      await db.entries.bulkPut(removed);
    }));
    if (!ok) return;
    keep('menu', undefined); // in the plan now — nothing to bring back
    useUi.getState().setDate(drafts[0]!.date);
    navigate('/');
  };

  const replacing = drafts.some((d) => all.some((e) => dateOf(e.at) === d.date && e.menu && e.status === 'planned'));
  const last = drafts.at(-1)?.date ?? date;
  const likeYesterdayButton = (
    <button type="button" onClick={yesterday} disabled={!!busy}
      className="flex min-h-tap items-center gap-2 rounded-xl border border-accent px-3 font-medium text-accent disabled:opacity-40">
      <Undo2 size={18} aria-hidden />{L.likeYesterday}</button>
  );

  return (
    <section className="space-y-4 pt-6">
      <div className="flex items-start justify-between gap-2">
        <h1 className="text-2xl font-semibold">{L.titleFor(date === todayISO() ? L.today : date === tomorrow() ? L.tomorrow
          : format(parseISO(date), 'd MMMM', { locale: uk }))}</h1>
        <Link to={`/shopping?from=${date}&to=${last}`} className="flex min-h-tap items-center gap-1 text-accent underline">
          <ShoppingCart size={18} aria-hidden />{t.shop.title}</Link>
      </div>
      <p className="text-sm text-muted">{L.hint}</p>

      <div className="space-y-3 rounded-2xl border border-line bg-surface p-3">
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <label className="block"><span className="text-sm text-muted">{L.date}</span>
            <input type="date" value={date} min={todayISO()} onChange={(e) => { setDate(e.target.value); setDrafts([]); }} className={field} /></label>
          <div><span className="text-sm text-muted">{L.days}</span>
            <div className="mt-1 flex gap-1" role="group" aria-label={L.days}>
              {[1, 2, 3].map((n) => (
                <button key={n} type="button" onClick={() => setDays(n)} aria-pressed={days === n}
                  className={`min-h-tap min-w-tap rounded-xl border px-3 ${days === n ? 'border-accent bg-accent/10 font-semibold text-accent' : 'border-line'}`}>{n}</button>
              ))}
            </div></div>
        </div>
        <label className="block"><span className="text-sm text-muted">{L.wish}</span>
          <input value={wish} onChange={(e) => setWish(e.target.value)} placeholder={L.wishPh} maxLength={300} className={field} /></label>
        {!meta || !keys ? (
          <div className="space-y-2">
            <p className="text-sm text-muted">{L.needsSync}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => navigate(`/sync?back=${encodeURIComponent(`/menu?date=${date}${wish ? `&wish=${encodeURIComponent(wish)}` : ''}`)}`)}
                className="flex min-h-tap items-center gap-2 rounded-xl bg-accent px-3 font-medium text-surface">{L.enableSync}</button>
              {likeYesterdayButton}
            </div>
          </div>
        ) : consent && !meta.menuConsent ? (
          <div className="space-y-2 rounded-xl border border-accent/40 p-2 text-sm">
            <p>{L.consent}</p>
            <button type="button" onClick={async () => { await db.meta.update('sync', { menuConsent: true }); setConsent(false); void make(true); }}
              className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface">{L.allow}</button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void make()} disabled={!!busy}
              className="flex min-h-tap items-center gap-2 rounded-xl bg-accent px-3 font-medium text-surface disabled:opacity-40">
              <Sparkles size={18} aria-hidden />{drafts.length ? L.again : L.make}</button>
            {likeYesterdayButton}
          </div>
        )}
        {busy && <p role="status" className="text-sm text-muted">{busy}</p>}
        {error && <p role="alert" className="text-sm text-warn">{error}</p>}
        <AiSpend />
      </div>

      {drafts.map((draft, di) => {
        const totals = draftTotals(draft.meals, foods);
        const targets = effectiveTargets(plan, draft.date);
        return (
          <div key={draft.date} className="space-y-3">
            <p className="text-lg font-semibold">{dm(draft.date)}</p>
            {draft.meals.map((m, mi) => (
              <div key={mi} className="rounded-2xl border border-line bg-surface p-3">
                <div className="mb-1 flex items-center gap-2">
                  <h2 className="flex-1 font-semibold">{m.title}</h2>
                  <input type="time" value={m.time} aria-label={`${m.title}: ${t.meal.time}`} onChange={(e) => setTime(di, mi, e.target.value)}
                    className="min-h-tap rounded-xl border border-line bg-bg px-2" />
                </div>
                <ul className="divide-y divide-line">
                  {m.items.map((it, k) => {
                    const alt = nextAlternative(it, foods, recipes, dishItem);
                    return (
                      <li key={k} className="flex min-h-tap items-center gap-1">
                        <span className="flex-1">{it.name} <span className="text-muted">· {amountText(it)}{needsGrams(it) ? ` ≈ ${it.grams} г` : ''}</span></span>
                        <span className="tabular text-sm text-muted">{round(lineNutrients(it, foods).kcal)}</span>
                        {alt && <button type="button" aria-label={`${L.swap}: ${it.name}`} title={L.swap} className="flex min-h-tap min-w-tap items-center justify-center text-accent"
                          onClick={() => edit(di, mi, (xs) => xs.map((x, n) => (n === k ? alt : x)))}><RefreshCw size={17} /></button>}
                        <button type="button" aria-label={`${L.remove}: ${it.name}`} className="flex min-h-tap min-w-tap items-center justify-center text-muted"
                          onClick={() => edit(di, mi, (xs) => xs.filter((_, n) => n !== k))}><X size={18} /></button>
                      </li>
                    );
                  })}
                </ul>
                {m.items.length === 0 && <p className="py-2 text-sm text-muted">{L.emptyMeal}</p>}
                {m.notes.length > 0 && <ul className="mt-1 text-sm text-warn">{m.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
                {adding === `${di}:${mi}`
                  ? <ItemPicker foods={foods} recipes={recipes} all={all} allergies={planAllergies(plan)} onClose={() => setAdding(null)}
                      onAdd={(xs) => edit(di, mi, (items) => [...items, ...xs])} />
                  : <button type="button" onClick={() => setAdding(`${di}:${mi}`)} aria-label={L.addTo(m.title)}
                      className="mt-1 flex min-h-tap items-center gap-1 px-1 text-accent"><Plus size={18} aria-hidden />{L.add}</button>}
              </div>
            ))}
            <div className="rounded-2xl border border-line bg-surface p-3 tabular">
              <p className="mb-1 font-semibold">{L.total}</p>
              <p>{round(totals.kcal)} {t.units.kcal}{targets.kcal ? ` / ${L.target} ${targets.kcal}` : ''}</p>
              <p className="text-sm text-muted">
                Б {round(totals.protein)}{targets.proteinG ? ` / ${targets.proteinG}` : ''} ·
                {' '}Ж {round(totals.fat)}{targets.fatG ? ` / ${targets.fatG}` : ''} ·
                {' '}<span className={(targets.carbsG?.max != null && totals.carbs > targets.carbsG.max) || (targets.carbsG?.min != null && totals.carbs < targets.carbsG.min)
                  ? 'font-semibold text-warn' : ''}>В {round(totals.carbs)}{targets.carbsG?.max != null ? ` / до ${targets.carbsG.max}` : targets.carbsG?.min != null ? ` / ≥ ${targets.carbsG.min}` : ''}</span> ·
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
          </div>
        );
      })}

      {drafts.length > 0 && !busy && (
        <>
          {replacing && <p className="text-sm text-muted">{L.replaces}</p>}
          {!meta?.reminders?.on && <p className="text-sm text-muted">{t.remind.menuHint}</p>}
          <button type="button" onClick={() => void accept()}
            className="min-h-tap w-full rounded-xl bg-accent px-4 font-medium text-surface">
            {L.accept(drafts.length > 1 ? `${format(parseISO(drafts[0]!.date), 'd')}–${format(parseISO(last), 'd MMMM', { locale: uk })}`
              : format(parseISO(last), 'd MMMM', { locale: uk }))}</button>
        </>
      )}
    </section>
  );
}
