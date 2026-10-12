import { format } from 'date-fns';
import { FavoritesList, pinMeal } from '../components/Favorites';
import { LabelScan } from '../components/LabelScan';
import { Loading } from '../components/Recovery';
import { saved } from '../components/Toast';
import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, ChevronDown, Plus, Star, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../data/db';
import { useAllEntries, useDayEntries, useFoods, usePlan, useRecentEntries, useRecipes } from '../data/queries';
import { earlierMeals, frequentItems } from '../domain/habits';
import { Amount } from '../components/Amount';
import { dishItem, foodFromLine, recipeFrom, setPortions, withComponents } from '../domain/recipes';
import { atLocal, dateOf, newId, timeOf, todayISO } from '../domain/dates';
import { activeMode, dayTotals, effectiveTargets, lineNutrients, mealNutrients, round } from '../domain/nutrition';
import { applySwaps, checkMeal, hasSwaps, mealVerdict, type ItemCheck } from '../domain/rules';
import { amountText, itemFor, measureWord, parseQuery, recognize, searchFoods, splitPhrase, type Query, type Recognized } from '../domain/foodSearch';
import { fromPhoto } from '../domain/photo';
import { ApiError, photo as recognizePhoto } from '../sync/api';
import { currentKeys } from '../sync/runner';
import { shrink } from '../sync/shrink';
import { Mic } from 'lucide-react';
import type { Cooking, DayEntry, Food, MealItem, Nutrients } from '../domain/types';
import { t } from '../i18n/uk';
import { useUi } from '../store/ui';

const COOKING: Cooking[] = ['raw', 'boiled', 'baked', 'airfryer', 'steamed', 'stewed', 'fried'];
const field = 'mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3';

function defaultMealName(time: string): string {
  const h = Number(time.slice(0, 2));
  return h < 11 ? t.meal.names[0] : h < 16 ? t.meal.names[1] : t.meal.names[2];
}

/** Add or edit a meal: food base search with grams and cooking, or a free line with hand-entered nutrients.
 *  The dish check against the doctor's plan arrives in M2 — here the meal is written as is. */
export function AddMeal() {
  const { id } = useParams();
  const navigate = useNavigate();
  const uiDate = useUi((s) => s.date);
  const foods = useFoods();
  const recipes = useRecipes();
  const all = useAllEntries();
  const plan = usePlan();
  const [dishName, setDishName] = useState<string | null>(null);
  const [dishSaved, setDishSaved] = useState('');

  const [loaded, setLoaded] = useState(id === undefined);
  const [date, setDate] = useState(uiDate);
  const [time, setTime] = useState(uiDate === todayISO() ? format(new Date(), 'HH:mm') : '13:00');
  const [title, setTitle] = useState(() => defaultMealName(time));
  const [eaten, setEaten] = useState(uiDate <= todayISO());
  const [items, setItems] = useState<MealItem[]>([]);
  const [query, setQuery] = useState('');
  const [free, setFree] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [pinName, setPinName] = useState<string | null>(null);

  useEffect(() => {
    if (id === undefined) return;
    void db.entries.get(id).then((e) => {
      if (!e) return navigate('/', { replace: true });
      setDate(dateOf(e.at)); setTime(timeOf(e.at)); setTitle(e.title);
      setEaten(e.status === 'done'); setItems(e.items ?? []); setLoaded(true);
    });
  }, [id, navigate]);

  const others = useDayEntries(date)?.filter((e) => e.id !== id);
  const recent = useRecentEntries(date)?.filter((e) => e.id !== id);
  const parsed = useMemo(() => parseQuery(query), [query]);
  const matches = useMemo(() => (foods ? searchFoods([...foods.values()], parsed.text, 8, usualIds(all)) : []), [foods, parsed, all]);
  const dishMatches = useMemo(() => (recipes ? searchFoods(recipes, parsed.text, 4) : []), [recipes, parsed]);
  // D30: what this person usually eats wins among similar foods («кефір» = their kefir)
  const usual = useMemo(() => new Set(all ? frequentItems(all, todayISO(), 60, 50).map((f) => f.item.recipe?.id ?? f.item.foodId ?? '') : []), [all]);
  const phrase = useMemo(() => (foods && recipes && splitPhrase(query).length > 1
    ? recognize(query, [...foods.values()], recipes, dishItem, usual) : null), [foods, recipes, query, usual]);
  const [photo, setPhoto] = useState<PhotoState>({ state: 'none' });
  const photoInput = useRef<HTMLInputElement>(null);
  const syncMeta = useLiveQuery(async () => (await db.meta.get('sync')) ?? null, []);

  if (!loaded || !foods) return <Loading />;

  // D32: a photo of the plate → a «Розпізнано» draft to confirm
  const pickPhoto = () => {
    if (!syncMeta || !currentKeys()) return setPhoto({ state: 'nosync' });
    if (!syncMeta.photoConsent) return setPhoto({ state: 'consent' });
    photoInput.current?.click();
  };
  const onPhoto = async (file: File | undefined) => {
    if (photoInput.current) photoInput.current.value = '';
    const keys = currentKeys();
    if (!file || !keys) return;
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

  const meal = mealNutrients(items, foods);
  const before = others ? dayTotals(others, foods) : undefined;
  const targets = effectiveTargets(plan, date);
  const after = before && (eaten ? { ...before, carbs: before.carbs + meal.carbs, protein: before.protein + meal.protein,
    calciumMg: before.calciumMg + meal.calciumMg, kcal: before.kcal + meal.kcal } : before);

  const checks: ItemCheck[] = plan && others && recent
    ? checkMeal({ plan, activeMode: activeMode(plan, date)?.mode, dayEntries: others, date, meal: items, recentEntries: recent, foods })
    : [];
  const swapped = hasSwaps(checks) ? applySwaps(checks, foods) : null;
  const anyActive = plan?.constraints.some((c) => c.active) ?? false;

  const setItem = (i: number, patch: Partial<MealItem>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = async (what: MealItem[] = items) => {
    if (what.length === 0) return;
    const entry: DayEntry = { id: id ?? newId(), at: atLocal(date, time), kind: 'meal', status: eaten ? 'done' : 'planned',
      title: title.trim() || defaultMealName(time), items: what };
    if (!await saved(db.entries.put(entry).then(() => true), (entry.status === 'done' ? t.toast.meal : t.toast.planned)(entry.title))) return;
    useUi.getState().setDate(date);
    navigate('/');
  };

  return (
    <section className="pt-4">
      <h1 className="mb-3 text-2xl font-semibold">{id ? t.meal.editTitle : t.meal.title}</h1>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="rounded-2xl border border-line bg-surface p-3">
          <div className="flex items-end gap-2">
            <label className="block flex-1"><span className="text-sm text-muted">{t.meal.search}</span>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.meal.searchHint}
                className={field} autoComplete="off" autoFocus={!id} /></label>
            <button type="button" onClick={pickPhoto} disabled={photo.state === 'busy'} aria-label={t.meal.photo}
              className="flex min-h-tap items-center gap-1 rounded-xl border border-accent px-3 font-medium text-accent disabled:opacity-40">
              <Camera size={18} aria-hidden /><span className="hidden min-[380px]:inline">{t.meal.photo}</span></button>
            <input ref={photoInput} type="file" accept="image/*" className="hidden" onChange={(e) => void onPhoto(e.target.files?.[0])} />
          </div>
          {photo.state === 'consent' && (
            <div className="mt-2 space-y-2 rounded-xl border border-accent/40 p-2 text-sm">
              <p>{t.meal.photoConsent}</p>
              <button type="button" onClick={() => { void db.meta.update('sync', { photoConsent: true }); setPhoto({ state: 'none' }); photoInput.current?.click(); }}
                className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface">{t.meal.photoAllow}</button>
            </div>
          )}
          {photo.state === 'nosync' && <p className="mt-2 text-sm text-muted">{t.meal.photoNeedsSync}</p>}
          {!query && <p className="mt-1 flex items-start gap-1 text-xs text-muted"><Mic size={14} className="mt-0.5 shrink-0" aria-hidden />{t.meal.dictate}</p>}
          {phrase && <RecognizedPanel key={query} title={t.meal.recognized} rows={phrase}
            onAdd={(picked) => { setItems((xs) => [...xs, ...picked]); setQuery(''); }} />}
          {photo.state === 'busy' && <p role="status" className="mt-2 text-sm text-muted">{t.meal.photoBusy}</p>}
          {photo.state === 'error' && <p role="alert" className="mt-2 text-sm text-warn">{photo.message}</p>}
          {photo.state === 'done' && (photo.rows.length > 0
            ? <RecognizedPanel title={t.meal.photoTitle} rows={photo.rows} note={photo.note}
                onAdd={(picked) => { setItems((xs) => [...xs, ...picked]); setPhoto({ state: 'none' }); }} />
            : <p role="status" className="mt-2 text-sm text-muted">{photo.note ?? t.meal.photoEmpty}</p>)}
          {!phrase && (matches.length > 0 || dishMatches.length > 0) && (
            <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
              {dishMatches.map((r) => {
                const portions = parsed.qty ?? 1;
                const dish = dishItem(r, portions);
                return (
                  <li key={r.id}>
                    <button type="button" className="flex min-h-tap w-full items-center justify-between gap-2 px-3 text-left"
                      onClick={() => { setItems((xs) => [...xs, dish]); setQuery(''); }}>
                      <span><span className="mr-1 rounded-full bg-accent/10 px-2 text-xs font-medium text-accent">{t.meal.dish}</span>{r.name}</span>
                      <span className="tabular shrink-0 text-right text-sm text-muted">{fmt(portions)} {measureWord('порція', portions)} ≈ {dish.grams} г</span>
                    </button>
                  </li>
                );
              })}
              {matches.map((f) => (
                <li key={f.id}>
                  <button type="button" className="flex min-h-tap w-full items-center justify-between gap-2 px-3 text-left"
                    onClick={() => { setItems((xs) => [...xs, itemFor(f, parsed)]); setQuery(''); }}>
                    <span>{f.name}</span>
                    <span className="tabular shrink-0 text-right text-sm text-muted">{matchHint(f, parsed)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!query && <FavoritesList onAdd={(xs) => setItems((ys) => [...ys, ...xs])} />}
          {!query && !id && items.length === 0 && all && (() => {
            const before = earlierMeals(all, title, date);
            return before.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-sm text-muted">{t.meal.likeBefore(title)}</p>
                <ul className="space-y-2">
                  {before.map((e) => (
                    <li key={e.id}>
                      <button type="button" onClick={() => setItems(e.items!.map((x) => ({ ...x })))}
                        className="flex min-h-tap w-full items-center gap-2 rounded-xl border border-line px-3 py-2 text-left">
                        <span className="flex-1 text-sm">{e.items!.map((x) => `${x.name} ${amountText(x)}`).join(', ')}</span>
                        <span className="shrink-0 text-sm font-medium text-accent">{t.meal.repeat}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}
          {!query && all && (() => {
            const freq = frequentItems(all, todayISO()).filter((f) => !items.some((it) => it.name === f.item.name));
            return freq.length > 0 && (
              <div className="mt-2">
                <p className="mb-1 text-sm text-muted">{t.meal.frequent}</p>
                <div className="flex flex-wrap gap-2">
                  {freq.map((f) => (
                    <button key={f.item.name} type="button" onClick={() => setItems((xs) => [...xs, f.item])}
                      className="min-h-tap rounded-full border border-line px-3 text-sm">
                      {f.item.name} <span className="text-muted">· {amountText(f.item)}</span></button>
                  ))}
                </div>
              </div>
            );
          })()}
          <button type="button" onClick={() => setFree((v) => !v)} className="mt-2 min-h-tap text-accent underline">{t.meal.free}</button>
          {free && <FreeItemForm onAdd={(it) => { setItems((xs) => [...xs, it]); setFree(false); }} />}
          <LabelScan onAdd={(it) => setItems((xs) => [...xs, it])} />
        </div>

        <div className="rounded-2xl border border-line bg-surface p-3">
          <h2 className="mb-2 font-semibold">{t.meal.items}</h2>
          {items.length === 0 && <p className="text-muted">{t.meal.noItems}</p>}
          <ul className="space-y-3">
            {items.map((it, i) => {
              const n = lineNutrients(it, foods);
              if (it.components) return (
                <li key={i} className="rounded-xl border border-line p-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium"><span className="mr-1 rounded-full bg-accent/10 px-2 text-xs font-medium text-accent">{t.meal.dish}</span>{it.name}</span>
                    <button type="button" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}
                      className="flex min-h-tap min-w-tap items-center justify-center text-warn" aria-label={`${t.meal.remove}: ${it.name}`}>
                      <Trash2 size={18} /></button>
                  </div>
                  <label className="block w-40"><span className="text-sm text-muted">{t.meal.portions}</span>
                    <input type="number" inputMode="decimal" min={0.5} step={0.5} value={it.recipe?.portions ?? 1} className={field}
                      onChange={(e) => { const v = Number(e.target.value); if (v > 0) setItems((xs) => xs.map((x, j) => (j === i ? setPortions(x, v) : x))); }} /></label>
                  <span className="text-xs text-muted">≈ {it.grams} г</span>
                  <details className="mt-1">
                    <summary className="min-h-tap cursor-pointer py-2 text-sm text-accent">{t.meal.composition(it.components.length)}</summary>
                    <ul className="space-y-2">
                      {it.components.map((c, k) => (
                        <li key={k} className="rounded-lg bg-bg p-2">
                          <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{c.name}</span>
                            <button type="button" aria-label={`${t.meal.remove}: ${c.name}`} className="flex min-h-tap min-w-tap items-center justify-center text-warn"
                              onClick={() => setItems((xs) => xs.map((x, j) => (j === i ? withComponents(x, x.components!.filter((_, m) => m !== k)) : x)))}>
                              <Trash2 size={16} /></button></div>
                          <Amount item={c} food={c.foodId ? foods.get(c.foodId) : undefined}
                            onChange={(patch) => setItems((xs) => xs.map((x, j) => (j === i ? withComponents(x, x.components!.map((y, m) => (m === k ? { ...y, ...patch } : y))) : x)))} />
                        </li>
                      ))}
                    </ul>
                  </details>
                  <p className="mt-1 tabular text-sm text-muted">
                    {round(n.kcal)} {t.units.kcal} · Б {fmt(n.protein)} · Ж {fmt(n.fat)} · В {fmt(n.carbs)} · Ca {round(n.calciumMg)} {t.units.mg}
                  </p>
                </li>
              );
              return (
                <li key={i} className="rounded-xl border border-line p-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{it.name}
                      {it.manual && it.grams > 0 && (
                        <button type="button" className="ml-2 text-sm font-normal text-accent underline"
                          onClick={async () => { const f = foodFromLine(it, `u-${newId()}`); if (f && await saved(db.foods.put(f).then(() => true), t.toast.food(f.name))) setItem(i, { foodId: f.id, manual: undefined }); }}>
                          {t.meal.toBase}</button>
                      )}</span>
                    <button type="button" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}
                      className="flex min-h-tap min-w-tap items-center justify-center text-warn" aria-label={`${t.meal.remove}: ${it.name}`}>
                      <Trash2 size={18} /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Amount item={it} food={it.foodId ? foods.get(it.foodId) : undefined} onChange={(patch) => setItem(i, patch)} />
                    <label className="block"><span className="text-sm text-muted">{t.meal.cooking}</span>
                      <select value={it.cooking ?? ''} onChange={(e) => setItem(i, { cooking: (e.target.value || undefined) as Cooking | undefined })}
                        className={field}>
                        <option value="">—</option>
                        {COOKING.map((c) => <option key={c} value={c}>{t.cooking[c]}</option>)}
                      </select></label>
                  </div>
                  <p className="mt-1 tabular text-sm text-muted">
                    {round(n.kcal)} {t.units.kcal} · Б {fmt(n.protein)} · Ж {fmt(n.fat)} · В {fmt(n.carbs)} · Ca {round(n.calciumMg)} {t.units.mg}
                  </p>
                </li>
              );
            })}
          </ul>
          {items.length > 0 && pinName === null && dishName === null && (
            <button type="button" onClick={() => setPinName(title)} className="mt-2 mr-4 inline-flex min-h-tap items-center gap-1 text-accent underline">
              <Star size={16} aria-hidden />{t.meal.pin}</button>
          )}
          {pinName !== null && (
            <div className="mt-2 flex gap-2">
              <label className="flex-1"><span className="sr-only">{t.meal.pinName}</span>
                <input value={pinName} onChange={(e) => setPinName(e.target.value)} placeholder={t.meal.pinName} autoFocus
                  className="block min-h-tap w-full rounded-xl border border-line bg-bg px-3" /></label>
              <button type="button" disabled={!pinName.trim()} onClick={() => void pinMeal(pinName, items).then(() => setPinName(null))}
                className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface disabled:opacity-40">{t.dishes.save}</button>
            </div>
          )}
          {items.length > 0 && pinName === null && (dishName === null
            ? <button type="button" onClick={() => { setDishName(items.length === 1 && items[0]!.components ? '' : title); setDishSaved(''); }}
                className="mt-2 min-h-tap text-accent underline">{t.meal.saveAsDish}</button>
            : (
              <div className="mt-2 flex gap-2">
                <label className="flex-1"><span className="sr-only">{t.meal.dishName}</span>
                  <input value={dishName} onChange={(e) => setDishName(e.target.value)} placeholder={t.meal.dishName}
                    className="block min-h-tap w-full rounded-xl border border-line bg-bg px-3" /></label>
                <button type="button" disabled={!dishName.trim()}
                  onClick={async () => { await saved(db.recipes.put(recipeFrom(dishName, items, newId())), t.toast.dish(dishName.trim())); setDishSaved(t.meal.dishSaved(dishName.trim())); setDishName(null); }}
                  className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface disabled:opacity-40">{t.dishes.save}</button>
              </div>
            ))}
          {dishSaved && <p role="status" className="mt-1 text-sm text-accent">{dishSaved}</p>}
        </div>

        {items.length > 0 && <CheckPanel checks={checks} anyActive={anyActive} swapped={swapped} />}

        <div className="rounded-2xl border border-line bg-surface p-3 tabular">
          <p><span className="text-muted">{t.meal.mealTotal}: </span>
            {round(meal.kcal)} {t.units.kcal} · Б {round(meal.protein)} · Ж {round(meal.fat)} · В {round(meal.carbs)} · Ca {round(meal.calciumMg)} {t.units.mg}</p>
          {after && (
            <p className="mt-1"><span className="text-muted">{t.meal.dayLeft}: </span>
              {t.day.carbs.toLowerCase()} {round(after.carbs)} {t.units.g}
              {targets.carbsG?.min != null ? ` (${t.day.atLeast(targets.carbsG.min)})`
                : targets.carbsG?.max != null ? ` (${t.summary.limit(targets.carbsG.max)})` : ''}
              {targets.proteinG != null && ` · білок ${round(after.protein)} з ${targets.proteinG} ${t.units.g}`}
              {targets.calciumMg != null && ` · кальцій ${round(after.calciumMg)} з ${targets.calciumMg} ${t.units.mg}`}
            </p>
          )}
        </div>

        {/* D51: the food comes first; name, time and «з'їдено» are one line to check before saving */}
        <div className="rounded-2xl border border-line bg-surface">
          <button type="button" onClick={() => setMetaOpen((v) => !v)} aria-expanded={metaOpen} aria-label={t.meal.mealLine}
            className="flex min-h-tap w-full items-center gap-2 px-3 py-2 text-left">
            <span className="flex-1"><span className="font-medium">{title.trim() || defaultMealName(time)}</span>
              <span className="tabular text-muted"> · {time} · {eaten ? t.meal.eatenShort : t.meal.plannedShort}</span></span>
            <ChevronDown size={18} className={`shrink-0 text-muted transition-transform ${metaOpen ? 'rotate-180' : ''}`} aria-hidden />
          </button>
          {metaOpen && (
            <div className="border-t border-line p-3">
              <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label={t.meal.name}>
                {t.meal.names.map((n) => (
                  <button key={n} type="button" onClick={() => setTitle(n)} aria-pressed={title === n}
                    className={`min-h-tap rounded-full border px-3 ${title === n ? 'border-accent bg-accent/10 text-accent' : 'border-line'}`}>{n}</button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="text-sm text-muted">{t.meal.name}</span>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} className={field} /></label>
                <label className="block"><span className="text-sm text-muted">{t.meal.time}</span>
                  <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required className={field} /></label>
              </div>
              <label className="mt-2 flex min-h-tap items-center gap-3">
                <input type="checkbox" checked={eaten} onChange={(e) => setEaten(e.target.checked)} className="h-5 w-5 accent-[rgb(var(--accent))]" />
                <span>{t.meal.eaten}</span>
              </label>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {swapped ? (
            <>
              <button type="button" onClick={() => void save(swapped)} disabled={swapped.length === 0}
                className="min-h-tap flex-1 rounded-xl bg-accent px-4 font-medium text-surface disabled:opacity-40">{t.check.saveSwap}</button>
              <button type="submit" className="min-h-tap flex-1 rounded-xl border border-accent px-4 font-medium text-accent">{t.check.saveAsIs}</button>
            </>
          ) : (
            <button type="submit" disabled={items.length === 0}
              className="min-h-tap flex-1 rounded-xl bg-accent px-4 font-medium text-surface disabled:opacity-40">{t.meal.save}</button>
          )}
          <button type="button" onClick={() => navigate(-1)} className="min-h-tap rounded-xl border border-line px-4">{t.meal.cancel}</button>
        </div>
      </form>
    </section>
  );
}

type PhotoState = { state: 'none' | 'busy' | 'consent' | 'nosync' } | { state: 'error'; message: string }
  | { state: 'done'; rows: Recognized[]; note?: string };

/** Lines recognized from a dictated phrase (D30) or a photo (D32), each with a tick; nothing is added until «Додати». */
function RecognizedPanel({ title, rows, note, onAdd }: { title: string; rows: Recognized[]; note?: string; onAdd: (items: MealItem[]) => void }) {
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const picked = rows.filter((r, k) => r.item && !skip.has(k)).map((r) => r.item!);
  return (
    <div className="mt-2 rounded-xl border border-accent/40 p-2">
      <p className="mb-1 text-sm font-medium">{title}</p>
      {note && <p className="mb-1 text-sm text-muted">{note}</p>}
      <ul className="space-y-1">
        {rows.map((r, k) => (
          <li key={k}>
            {r.item ? (
              <label className="flex min-h-tap items-center gap-3">
                <input type="checkbox" checked={!skip.has(k)} className="h-5 w-5 accent-[rgb(var(--accent))]"
                  onChange={(e) => setSkip((s) => { const n = new Set(s); if (e.target.checked) n.delete(k); else n.add(k); return n; })} />
                <span className="flex-1">{r.item.name} <span className="text-muted">· {amountText(r.item)}{r.item.unit || r.item.recipe ? ` ≈ ${r.item.grams} г` : ''}</span>
                  {(r.unsure || r.estimate) && <span className="block text-xs text-warn">{[r.unsure && t.meal.photoUnsure, r.estimate && t.meal.photoEstimate].filter(Boolean).join(' · ')}</span>}
                </span>
              </label>
            ) : <p className="py-2 text-sm text-muted">«{r.text}» — {t.meal.notFound}</p>}
          </li>
        ))}
      </ul>
      {picked.length > 0 && (
        <button type="button" onClick={() => onAdd(picked)}
          className="mt-1 min-h-tap w-full rounded-xl bg-accent px-3 font-medium text-surface">{t.meal.addRecognized(picked.length)}</button>
      )}
    </div>
  );
}

function FreeItemForm({ onAdd }: { onAdd: (item: MealItem) => void }) {
  const [save, setSave] = useState(true);
  const [name, setName] = useState('');
  const [grams, setGrams] = useState('');
  const [n, setN] = useState<Record<keyof Nutrients, string>>({ kcal: '', protein: '', fat: '', carbs: '', calciumMg: '' });
  const num = (s: string) => Math.max(0, Number(s.replace(',', '.')) || 0);
  const labels: [keyof Nutrients, string][] = [['kcal', t.units.kcal], ['protein', 'Б, г'], ['fat', 'Ж, г'], ['carbs', 'В, г'], ['calciumMg', 'Ca, мг']];
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-line p-2">
      <div className="grid grid-cols-[1fr_6rem] gap-2">
        <label className="block"><span className="text-sm text-muted">{t.meal.freeName}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={field} /></label>
        <label className="block"><span className="text-sm text-muted">{t.meal.grams}</span>
          <input type="number" inputMode="decimal" min={0} value={grams} onChange={(e) => setGrams(e.target.value)} className={field} /></label>
      </div>
      <p className="text-sm text-muted">{t.meal.manualHint}</p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {labels.map(([k, label]) => (
          <label key={k} className="block"><span className="text-sm text-muted">{label}</span>
            <input type="text" inputMode="decimal" value={n[k] ?? ''} onChange={(e) => setN((x) => ({ ...x, [k]: e.target.value }))} className={field} /></label>
        ))}
      </div>
      <label className="flex min-h-tap items-center gap-3 text-sm">
        <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} className="h-5 w-5 accent-[rgb(var(--accent))]" />
        <span>{t.meal.saveToBase}</span>
      </label>
      <button type="button" disabled={!name.trim() || !grams}
        onClick={async () => {
          const item: MealItem = { name: name.trim(), grams: num(grams),
            manual: { kcal: num(n.kcal), protein: num(n.protein), fat: num(n.fat), carbs: num(n.carbs), calciumMg: num(n.calciumMg ?? '') } };
          const food = save ? foodFromLine(item, `u-${newId()}`) : null;
          if (food) await saved(db.foods.put(food), t.toast.food(food.name));
          onAdd(food ? { foodId: food.id, name: food.name, grams: item.grams } : item);
        }}
        className="flex min-h-tap items-center gap-2 rounded-xl border border-accent px-3 text-accent disabled:opacity-40">
        <Plus size={18} />{t.meal.add}</button>
    </div>
  );
}

/** «Перевірка»: each item's verdict with the reason, the meal as a whole, and what «Записати заміну» would write. */
function CheckPanel({ checks, anyActive, swapped }: { checks: ItemCheck[]; anyActive: boolean; swapped: MealItem[] | null }) {
  if (!anyActive) return <p className="rounded-2xl border border-line bg-surface p-3 text-muted">{t.check.noPlan}</p>;
  const v = mealVerdict(checks);
  return (
    <section aria-live="polite" className={`rounded-2xl border p-3 ${v.fits ? 'border-accent/40 bg-accent/5' : 'border-warn/30 bg-warn-bg'}`}>
      <h2 className="font-semibold">{t.check.title}</h2>
      <p className={`mb-2 font-medium ${v.fits ? 'text-accent' : 'text-warn'}`}>{v.fits ? t.check.fits : t.check.partly(v.okCount, v.total)}</p>
      <ul className="space-y-2">
        {checks.map(({ item, hits }, i) => (
          <li key={i} className="rounded-xl bg-surface p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{item.name}</span>
              <Badge verdict={hits[0]?.verdict ?? 'ok'} />
            </div>
            {hits.map((h, j) => (
              <p key={j} className="text-sm">
                {j > 0 && <Badge verdict={h.verdict} small />} {h.itemName !== item.name && <span className="font-medium">{h.itemName}: </span>}{h.message}{h.suggestion && <span className="text-muted"> → {h.suggestion}</span>}
              </p>
            ))}
          </li>
        ))}
      </ul>
      {swapped && (
        <p className="mt-2 text-sm"><span className="text-muted">{t.check.swapTo}: </span>
          {swapped.length ? swapped.map((it) => `${it.name} ${it.grams} г${it.cooking ? ` (${t.cooking[it.cooking].toLowerCase()})` : ''}`).join(', ') : '—'}</p>
      )}
    </section>
  );
}

function Badge({ verdict, small }: { verdict: 'ok' | 'replace' | 'remove' | 'adjust'; small?: boolean }) {
  const look = verdict === 'ok' ? 'bg-accent/10 text-accent' : 'bg-warn-bg text-warn';
  return <span className={`shrink-0 rounded-full px-2 ${small ? 'text-xs' : 'py-0.5 text-sm'} font-medium ${look}`}>{t.check.verdict[verdict]}</span>;
}

const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

/** What tapping a search result adds: «2 шт ≈ 100 г», or the food's first measure, or carbs per 100 g. */
function matchHint(food: Food, q: Query): string {
  if (q.qty !== undefined || q.measure) {
    const it = itemFor(food, q);
    return it.unit ? `${fmt(it.unit.qty)} ${measureWord(it.unit.name, it.unit.qty)} ≈ ${it.grams} г` : `${it.grams} г`;
  }
  const u = food.units?.[0];
  return u ? `1 ${u.name} ≈ ${u.grams} г` : `${food.per100g.carbs} г В / 100 г`;
}


/** Ids of the foods and dishes this person ate in the last two months (search prefers them — D30). */
function usualIds(all: DayEntry[] | undefined): Set<string> {
  return new Set(all ? frequentItems(all, todayISO(), 60, 50).map((f) => f.item.recipe?.id ?? f.item.foodId ?? '') : []);
}
