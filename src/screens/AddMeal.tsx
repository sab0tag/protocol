import { foodPlanStatus } from '../domain/foodPlanStatus';
import { SceneHeader } from '../components/SceneHeader';
import { ExampleNotice } from '../components/ExampleNotice';
import { MedFoodPanel } from '../components/MedFoodPanel';
import { DangerCard } from '../components/DangerCard';
import { crisisInText, dangerInText } from '../domain/symptoms';
import { medFoodNotes } from '../domain/medFood';
import { ConciergeNotFound, type Suggested } from '../components/ConciergeNotFound';
import { whyFlagged } from '../domain/concierge';
import { conciergeOutcome } from '../sync/api';
import { format } from 'date-fns';
import { AllergenNote } from '../components/AllergenPicker';
import { pinMeal } from '../components/Favorites';
import { allergyHits, itemAllergens, planAllergies } from '../domain/allergens';
import { LabelScan } from '../components/LabelScan';
import { Loading } from '../components/Recovery';
import { saved } from '../components/Toast';
import { Camera, Check, ChevronDown, Mic, Plus, ScanText, Search, Star, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { db } from '../data/db';
import { useAllEntries, useDayEntries, useFoods, usePlan, useRecentEntries, useRecipes } from '../data/queries';
import { frequentItems } from '../domain/habits';
import { Amount } from '../components/Amount';
import { dishItem, foodFromLine, recipeFrom, setPortions, withComponents } from '../domain/recipes';
import { atLocal, dateOf, newId, timeOf, todayISO } from '../domain/dates';
import { dayTotals, effectiveTargets, lineNutrients, mealNutrients, round } from '../domain/nutrition';
import { hasSwaps, mealVerdict, type ItemCheck } from '../domain/rules';
import { approxG, measureWord, readMeal } from '../domain/foodSearch';
import { RecognizedPanel } from '../components/RecognizedPanel';
import { PhotoStatus, usePlatePhoto } from '../components/PlatePhoto';
import { slotTime, type Slot } from '../domain/mealSlots';
import { count, countOnce } from '../data/tally';
import { keep, kept } from '../data/kept';
import { dietCoverage } from '../domain/diets';
import { evaluate, safeSwaps } from '../domain/evaluate';
import { currentKeys } from '../sync/runner';
import type { Cooking, DayEntry, Food, MealItem, Nutrients, Plan } from '../domain/types';
import { t } from '../i18n/uk';
import { CrisisCard } from '../components/CrisisCard';
import { useUi } from '../store/ui';

const COOKING: Cooking[] = ['raw', 'boiled', 'baked', 'airfryer', 'steamed', 'stewed', 'fried'];
const field = 'mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3';

function defaultMealName(time: string): string {
  const h = Number(time.slice(0, 2));
  return h < 11 ? t.meal.names[0] : h < 16 ? t.meal.names[1] : t.meal.names[2];
}

/** The full meal form: editing a record (/meal/:id), or every way in for one meal tile (/meal/new?slot=N — D159: the label,
 *  a free line, composition). Which meal and when are the tile's — nothing here asks them for a new meal. */
const DRAFT = 'meal:new';
interface MealDraft { date: string; time: string; title: string; eaten: boolean; items: MealItem[] }

export function AddMeal() {
  const { id } = useParams();
  const navigate = useNavigate();
  const slot = Number(useSearchParams()[0].get('slot') ?? 0) as Slot;
  const uiDate = useUi((s) => s.date);
  const foods = useFoods();
  const recipes = useRecipes();
  const all = useAllEntries();
  const plan = usePlan();
  const [dishName, setDishName] = useState<string | null>(null);
  const [dishSaved, setDishSaved] = useState('');

  const [loaded, setLoaded] = useState(id === undefined);
  // D131: a new meal not yet written survives a reload (a locked phone, a new version) — kept on this device for a day
  const [draft] = useState(() => (id === undefined ? kept<MealDraft>(DRAFT) : undefined));
  const [date, setDate] = useState(draft?.date ?? uiDate);
  const [time, setTime] = useState(draft?.time ?? (uiDate === todayISO() ? format(new Date(), 'HH:mm') : '13:00'));
  const [title, setTitle] = useState(() => draft?.title ?? (id === undefined ? t.meal.names[slot] ?? defaultMealName(time) : defaultMealName(time)));
  const [eaten, setEaten] = useState(draft?.eaten ?? true); // D159: a new meal is eaten; planning ahead is the menu's
  const [items, setItems] = useState<MealItem[]>(draft?.items ?? []);
  useEffect(() => { if (id === undefined) keep<MealDraft>(DRAFT, items.length ? { date, time, title, eaten, items } : undefined); }, [id, date, time, title, eaten, items]);
  const suggested = useRef<Suggested[]>([]); // D91: what the concierge offered and was tapped — its outcome is told on save
  const prior = useRef<DayEntry | undefined>(undefined);
  const concierge = (s: Suggested) => { setItems((xs) => [...xs, s.item]); suggested.current.push(s); };
  const [query, setQuery] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const [labelOpen, setLabelOpen] = useState(false);
  const [free, setFree] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [pinName, setPinName] = useState<string | null>(null);

  useEffect(() => {
    if (id === undefined) return;
    void db.entries.get(id).then((e) => {
      if (!e) return navigate('/', { replace: true });
      prior.current = e;
      setDate(dateOf(e.at)); setTime(timeOf(e.at)); setTitle(e.title);
      setEaten(e.status === 'done'); setItems(e.items ?? []); setLoaded(true); viaPhoto.current = e.via;
    });
  }, [id, navigate]);

  const others = useDayEntries(date)?.filter((e) => e.id !== id);
  const recent = useRecentEntries(date, 8)?.filter((e) => e.id !== id); // R03: the day and the week before it
  // D30: what this person usually eats wins among similar foods («кефір» = their kefir)
  const usual = useMemo(() => usualIds(all), [all]);
  // D85: one reading of the text for the screen and for the phrase corpus (tests/fixtures/meal-phrases.yaml)
  const read = useMemo(() => (foods && recipes && query.trim() ? readMeal(query, { foods: [...foods.values()], recipes, dishItem, prefer: usual }) : null),
    [foods, recipes, query, usual]);
  const phrase = read && !read.list ? read.rows : null;
  const crisis = crisisInText(query); // D130
  const danger = crisis || dangerInText(query);
  const list = read?.list ?? [];
  const { photo, setPhoto, pick: pickPhoto, allow: allowPhoto, fileInput } = usePlatePhoto({ foods, recipes, usual });
  const viaPhoto = useRef<DayEntry['via']>(undefined); // D119: lines from a photo of the plate went into this meal

  if (!loaded || !foods) return <Loading />;

  const meal = mealNutrients(items, foods);
  const before = others ? dayTotals(others, foods) : undefined;
  const targets = effectiveTargets(plan, date);
  const after = before && (eaten ? { ...before, carbs: before.carbs + meal.carbs, protein: before.protein + meal.protein,
    calciumMg: before.calciumMg + meal.calciumMg, kcal: before.kcal + meal.kcal } : before);

  // R03: one evaluation — what was eaten against what else was eaten; a planned meal as a forecast with the day's plans too
  const ectx = plan && foods && recent ? { plan, date, foods, entries: recent, ...(id ? { exclude: id } : {}) } : null;
  const raw: ItemCheck[] = ectx ? evaluate({ ...ectx, intent: eaten ? 'recorded' : 'proposed', meal: items }).checks : [];
  // a swap only if the meal with it passes as a whole; D77: for an eaten meal it is a hint for next time, never applied
  const safe = ectx && hasSwaps(raw) ? safeSwaps({ ...ectx, intent: 'proposed' }, raw) : null;
  const checks = safe?.checks ?? raw;
  const swapped = !eaten && safe && hasSwaps(checks) ? safe.swapped : null;
  const anyActive = plan?.constraints.some((c) => c.active) ?? false;
  const allergies = planAllergies(plan); // D58

  const setItem = (i: number, patch: Partial<MealItem>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = async (what: MealItem[] = items) => {
    if (what.length === 0) return;
    const entry: DayEntry = { ...(prior.current?.scheduleChanges?.length ? {
      scheduleChanges: prior.current.scheduleChanges, ...(prior.current.menu ? { menu: prior.current.menu } : {}), ...(prior.current.demo ? { demo: true as const } : {}),
    } : {}), id: id ?? newId(), at: atLocal(date, id === undefined && !draft ? slotTime({ slot, date, now: new Date(), entries: all ?? [] }) : time), kind: 'meal', status: eaten ? 'done' : 'planned',
      title: title.trim() || defaultMealName(time), items: what, ...(viaPhoto.current ? { via: viaPhoto.current } : {}) };
    if (!await saved(db.entries.put(entry).then(() => true), (entry.status === 'done' ? t.toast.meal : t.toast.planned)(entry.title))) return;
    const keys = currentKeys(); // D91: accepted as offered, the grams corrected, or taken out again
    for (const s of suggested.current) {
      if (!s.logId || !keys) continue;
      const now = what.find((x) => x.name === s.item.name);
      void conciergeOutcome(keys, s.logId, !now ? 'dismissed' : now.grams === s.item.grams ? 'accepted' : 'edited',
        now && now.grams !== s.item.grams ? { field: 'grams', from: s.item.grams, to: now.grams } : undefined).catch(() => undefined);
    }
    if (id === undefined) keep(DRAFT, undefined); // written — the draft goes
    useUi.getState().setDate(date);
    navigate('/');
  };

  return (
    <section className="space-y-4 pt-4">
      <SceneHeader title={id ? t.meal.editTitle : t.meal.title} description={id ? t.meal.editHint : t.meal.entryHint} />
      <ExampleNotice plan={plan} />
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <section aria-label={t.meal.addFood} className="protocol-card p-4 sm:p-5">
          <details className="mb-3 rounded-xl border border-line px-3">
            <summary className="min-h-tap cursor-pointer py-3 text-sm text-muted">{t.meal.moreEntryMethods}</summary>
            <div className="flex flex-wrap gap-2 pb-3">
              <button type="button" onClick={() => navigate('/?open=voice')} className="protocol-action-secondary"><Mic size={18} aria-hidden />{t.meal.modeVoice}</button>
              <button type="button" aria-expanded={labelOpen} onClick={() => setLabelOpen(v => !v)} className="protocol-action-secondary"><ScanText size={18} aria-hidden />{t.meal.modeLabel}</button>
            </div>
          </details>
          <label htmlFor="meal-search" className="block text-sm text-muted">{t.meal.search}</label>
          <div className="mt-1 flex items-end gap-2">
            <div className="relative min-w-0 flex-1">
              <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
              <input ref={searchInput} id="meal-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.meal.searchHint}
                className={`${field} min-w-0 pl-10`} autoComplete="off" />
            </div>
            <button type="button" onClick={pickPhoto} disabled={photo.state === 'busy'} aria-label={t.meal.photo}
              className="flex min-h-tap min-w-tap shrink-0 items-center justify-center rounded-xl border border-line text-accent disabled:opacity-40"><Camera size={20} aria-hidden /></button>
            {fileInput}
          </div>
          <PhotoStatus photo={photo} allow={allowPhoto} />
          {!query && <p className="mt-1 flex items-start gap-1 text-xs text-muted"><Mic size={14} className="mt-0.5 shrink-0" aria-hidden />{t.meal.dictate}</p>}
          {danger && (crisis ? <CrisisCard className="mt-2" /> : <DangerCard className="mt-2" />) /* D97: one card for a danger sign, nothing else about those words */}
          {!danger && phrase && <RecognizedPanel key={query} title={t.meal.recognized} rows={phrase}
            onAdd={(picked, missing) => { setItems((xs) => [...xs, ...picked]); setQuery(''); for (const m of missing) void countOnce('nf', m); }}
            notFound={(text) => recipes && <ConciergeNotFound text={text} plan={plan} foods={foods} recipes={recipes} date={date} onAdd={concierge} />} />}
          {photo.state === 'done' && photo.rows.length > 0 && <RecognizedPanel title={t.meal.photoTitle} rows={photo.rows} note={photo.note}
                onAdd={(picked, missing) => { setItems((xs) => [...xs, ...picked]); setPhoto({ state: 'none' }); if (picked.length) viaPhoto.current = 'photo'; for (const m of missing) void countOnce('nf', m); }} />}
          {!danger && !phrase && list.length > 0 && (
            <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
              {list.map(({ item: dish, recipe: r, food: f }) => r ? (() => {
                const portions = dish.recipe?.portions ?? 1; // D106: what the dish was made of, not the number said («250 г»)
                return (
                  <li key={r.id}>
                    <button type="button" data-item={dish.name} className="flex min-h-tap w-full items-center justify-between gap-2 px-3 text-left"
                      onClick={() => { setItems((xs) => [...xs, dish]); setQuery(''); }}>
                      <span><span className="mr-1 rounded-full bg-accent/10 px-2 text-xs font-medium text-accent">{t.meal.dish}</span>{r.name}</span>
                      <span className="tabular shrink-0 text-right text-sm text-muted">{dish.recipe?.byGrams ? `${dish.grams} г` : <>{fmt(portions)} {measureWord('порція', portions)} ≈ {approxG(dish.grams)} г</>}</span>
                    </button>
                  </li>
                );
              })() : f && (
                <li key={f.id}>
                  <button type="button" data-item={dish.name} className="flex min-h-tap w-full items-center justify-between gap-2 px-3 text-left"
                    onClick={() => { setItems((xs) => [...xs, dish]); setQuery(''); }}>
                    <span>{f.name}{(() => { const h = allergyHits(f, allergies); return h.length ? <span className="ml-2 text-sm font-medium text-warn">{t.allergen.badge(h.map((a) => t.allergen.name[a]).join(', '))}</span> : null; })()}</span>
                    <span className="tabular shrink-0 text-right text-sm text-muted">{matchHint(dish)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {/* D83: nothing found is said — never a silent empty space under the field */}
          {!danger && !phrase && query.trim().length >= 2 && list.length === 0 && (
            <><p role="status" className="mt-2 text-sm text-muted">«{query.trim()}» — {t.meal.notFound}</p>
              {recipes && <ConciergeNotFound key={query.trim()} text={query.trim()} plan={plan} foods={foods} recipes={recipes} date={date}
                onAdd={(s) => { concierge(s); setQuery(''); }} />}
              {/* D110: a dish of one's own — described, it is broken into ingredients */}
              <Link to={`/dishes?describe=${encodeURIComponent(query.trim())}`} className="mt-1 inline-flex min-h-tap items-center text-sm text-accent underline">{t.dishes.breakdown.fromMeal}</Link></>
          )}
          <button type="button" onClick={() => setFree((v) => !v)} aria-expanded={free} className="mt-2 min-h-tap text-accent underline">{t.meal.free}</button>
          {free && <FreeItemForm onAdd={(it) => { setItems((xs) => [...xs, it]); setFree(false); }} />}
          {labelOpen && <LabelScan onAdd={(it) => setItems((xs) => [...xs, it])} />}
        </section>

        {items.length > 0 && <CheckPanel foods={foods} checks={checks} anyActive={anyActive} swapped={swapped} eaten={eaten && hasSwaps(checks)} plan={plan} />}

        <section aria-label={t.meal.items} className={`protocol-card p-4 sm:p-5 ${items.length ? '' : 'hidden'}`}>{/* D78: appears with the first line */}
          <h2 className="mb-2 font-semibold">{t.meal.items}</h2>
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
                    <PortionsInput value={it.recipe?.portions ?? 1} onCommit={(v) => setItems((xs) => xs.map((x, j) => (j === i ? setPortions(x, v) : x)))} /></label>
                  <span className="text-xs text-muted">≈ {approxG(it.grams)} г</span>
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
                  {(() => { const a = itemAllergens(it, foods); return <AllergenNote className="block" allergens={a.allergens} unknown={a.unknown} />; })()}
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
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Amount item={it} food={it.foodId ? foods.get(it.foodId) : undefined} onChange={(patch) => setItem(i, patch)} />
                    {(it.cooking || cookable(it.foodId ? foods.get(it.foodId) : undefined)) && <label className="block"><span className="text-sm text-muted">{t.meal.cooking}</span>
                      <select value={it.cooking ?? ''} onChange={(e) => setItem(i, { cooking: (e.target.value || undefined) as Cooking | undefined })}
                        className={field}>
                        <option value="">—</option>
                        {COOKING.map((c) => <option key={c} value={c}>{t.cooking[c]}</option>)}
                      </select></label>}
                  </div>
                  <p className="mt-1 tabular text-sm text-muted">
                    {round(n.kcal)} {t.units.kcal} · Б {fmt(n.protein)} · Ж {fmt(n.fat)} · В {fmt(n.carbs)} · Ca {round(n.calciumMg)} {t.units.mg}
                  </p>
                  {(() => { const a = itemAllergens(it, foods); return <AllergenNote className="block" allergens={a.allergens} unknown={a.unknown} />; })()}
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
        </section>

        {items.length > 0 && plan && <MedFoodPanel notes={medFoodNotes(plan.prescriptions, items, foods, { mealAt: atLocal(date, time),
          doses: new Map(plan.prescriptions.map((p) => [p.id, (others ?? []).filter((e) => e.kind === 'med' && e.status === 'done' && e.prescriptionId === p.id && !e.timeUnknown).map((e) => e.at)])) })} />}

        {/* D78: the totals only once there is something to add up — no «0 ккал» on an empty meal */}
        {items.length > 0 && <div className="protocol-card p-4 tabular sm:p-5">
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
        </div>}

        {/* D51, D159: an existing record keeps its name and time to correct; a new one takes them from its tile */}
        {id !== undefined && <div className="protocol-card overflow-hidden">
          <button type="button" onClick={() => setMetaOpen((v) => !v)} aria-expanded={metaOpen} aria-label={t.meal.mealLine}
            className="flex min-h-tap w-full items-center gap-2 px-3 py-2 text-left">
            <span className="flex-1"><span className="font-medium">{title.trim() || defaultMealName(time)}</span>
              <span className="tabular text-muted"> · {time}{eaten ? '' : ` · ${t.meal.plannedShort}`}</span></span>
            <ChevronDown size={18} className={`shrink-0 text-muted transition-transform ${metaOpen ? 'rotate-180' : ''}`} aria-hidden />
          </button>
          {metaOpen && (
            <div className="border-t border-line p-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="text-sm text-muted">{t.meal.name}</span>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} className={field} /></label>
                <label className="block"><span className="text-sm text-muted">{t.meal.time}</span>
                  <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required className={field} /></label>
              </div>
            </div>
          )}
        </div>}

        <div data-testid="meal-save-actions" className={`${items.length ? 'sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-4' : ''} z-10 protocol-card rounded-2xl border border-line bg-surface p-3 shadow-lg`}>
          <p aria-live="polite" aria-atomic="true" className="mb-2 text-sm text-muted">{items.length ? t.meal.selectedCount(items.length) : t.meal.chooseFirst}</p>
          <div className="flex flex-wrap gap-2">
          {swapped ? (
            <>
              <button type="button" onClick={() => void save(swapped)} disabled={swapped.length === 0}
                className="protocol-action min-w-[9rem] flex-1 disabled:opacity-40">{t.check.saveSwap}</button>
              <button type="submit" className="protocol-action-secondary min-w-[9rem] flex-1">{t.check.saveAsIs}</button>
            </>
          ) : (
            <button type="submit" disabled={items.length === 0}
              className="protocol-action flex-1 disabled:opacity-40"><Check size={18} aria-hidden />{id ? t.meal.saveChanges : t.meal.save}</button>
          )}
          <button type="button" onClick={() => { if (id === undefined) keep(DRAFT, undefined); navigate(-1); }} className="protocol-action-secondary">{t.meal.cancel}</button>
          </div>
        </div>
      </form>
    </section>
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
      <label className="protocol-toggle-row min-h-tap text-sm">
        <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} className="protocol-switch" />
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

/** D77: «Як приготовано» only where it can matter — not for tea, bread, kefir or an apple. A line without a base food keeps it. */
const COOKED = new Set(['veg', 'meat', 'fish', 'egg', 'grain', 'legume', 'liver']);
const RAW = new Set(['drink', 'bread', 'dairy', 'cheese', 'sweet', 'nuts', 'seeds', 'condiment', 'alcohol', 'soup']);
/** D88: a name that already says how it was cooked («Гречка варена», «Хек запечений», «Пшоняна каша») has no choice to make. */
const COOKED_NAME = /(варен|запечен|печен|смажен|тушкован|на пару|гриль|копчен|відвар|(^|\s)каша(?=\s|$)|пюре)/iu;
function cookable(food: Food | undefined): boolean {
  return !food || (food.tags.some((x) => COOKED.has(x)) && !food.tags.some((x) => RAW.has(x)) && !COOKED_NAME.test(food.name));
}

/** «Перевірка»: each item's verdict with the reason, the meal as a whole, and what «Записати заміну» would write. */
function CheckPanel({ foods, checks, anyActive, swapped, eaten, plan }: { foods: Map<string, Food>; checks: ItemCheck[]; anyActive: boolean; swapped: MealItem[] | null; eaten: boolean; plan: Plan | undefined }) {
  const [why, setWhy] = useState<string | null>(null); // D91: «Чому?» — open for one flag at a time
  if (!anyActive) return <p className="protocol-card rounded-2xl border border-line bg-surface p-3 text-muted">{t.check.noPlan}</p>;
  const v = mealVerdict(checks);
  // R02: a diet chosen but none of its rules set up — no green «Підходить» as if it were checked
  const unset = dietCoverage(plan).filter((c) => !c.configured);
  const status = foodPlanStatus(checks, foods, plan);
  const full = v.fits && !unset.length && status.state === 'clear';
  return (
    <section data-plan-status={status.state} aria-live="polite" className={`food-plan-check rounded-2xl border p-3 ${full ? 'border-accent/40 bg-accent/5' : 'border-warn/30 bg-warn-bg'}`}>
      <h2 className="font-semibold">{t.check.title}</h2>
      <p className={`mb-2 font-medium ${full ? 'text-accent' : 'text-warn'}`}>{status.state === 'allergen' ? t.meal.planAllergen : full ? t.meal.planClear : status.state === 'incomplete' ? t.meal.planIncomplete : t.meal.planAttention}</p>
      {!v.fits && <p className="mb-2 text-sm">{attentionText(checks)}</p>}
      <p className="mb-2 text-sm text-muted">{t.meal.planLimit}</p>
      {unset.map((c) => <p key={c.code} className="mb-2 text-sm text-muted">{t.diet.checkNote(c.code)}</p>)}
      <ul className="space-y-2">
        {checks.map(({ item, hits }, i) => (
          <li key={i} className="rounded-xl bg-surface p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{item.name}</span>
              {foodPlanStatus([{ item, hits }], foods, plan).state === 'incomplete' ? <span className="text-xs font-medium text-warn">{t.meal.partialBadge}</span> : <Badge verdict={hits[0]?.verdict ?? 'ok'} />}
            </div>
            {hits.map((h, j) => (
              <div key={j} className="text-sm">
                <p>{j > 0 && <Badge verdict={h.verdict} small />} {h.itemName !== item.name && <span className="font-medium">{h.itemName}: </span>}{h.message}{h.suggestion && <span className="text-muted"> → {h.suggestion}</span>}{h.noSwap && <span className="text-muted"> · {t.check.noSwap}</span>}
                  {plan && <button type="button" onClick={() => { if (why !== `${i}:${j}`) void count('why'); setWhy(why === `${i}:${j}` ? null : `${i}:${j}`); }} aria-expanded={why === `${i}:${j}`}
                    className="ml-2 min-h-[2rem] px-1 text-accent underline">{t.why.ask}</button>}</p>
                {plan && why === `${i}:${j}` && (
                  <p className="mt-1 rounded-lg bg-bg p-2">{whyFlagged(h, plan).text} <Link to="/plan" className="text-accent underline">{t.why.openPlan}</Link></p>
                )}
              </div>
            ))}
          </li>
        ))}
      </ul>
      {eaten && <p className="mt-2 text-sm text-muted">{t.check.nextTime}</p>}
      {swapped && (
        <p className="mt-2 text-sm"><span className="text-muted">{t.check.swapTo}: </span>
          {swapped.length ? swapped.map((it) => `${it.name} ${it.grams} г${it.cooking ? ` (${t.cooking[it.cooking].toLowerCase()})` : ''}`).join(', ') : '—'}</p>
      )}
    </section>
  );
}

function attentionText(checks: ItemCheck[]): string {
  const off = checks.filter((c) => c.hits.some((h) => h.verdict !== 'ok'));
  const one = off.length === 1 ? off[0] : undefined;
  const why = one?.hits.find((x) => x.verdict !== 'ok');
  if (one && why) return t.check.attentionOne(one.item.name, why.message);
  return t.check.attention(off.length, checks.length);
}

function Badge({ verdict, small }: { verdict: 'ok' | 'replace' | 'remove' | 'adjust'; small?: boolean }) {
  const look = verdict === 'ok' ? 'bg-accent/10 text-accent' : 'bg-warn-bg text-warn';
  return <span className={`shrink-0 rounded-full px-2 ${small ? 'text-xs' : 'py-0.5 text-sm'} font-medium ${look}`}>{t.check.verdict[verdict]}</span>;
}

const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

/** What tapping a search result adds: «2 шт ≈ 100 г», or the food's first measure, or carbs per 100 g. */
/** D88: the line shows exactly what a tap adds — «1 порція ≈ 200 г» for «гречка», not the food's first measure. */
function matchHint(it: MealItem): string {
  return it.unit ? `${fmt(it.unit.qty)} ${measureWord(it.unit.name, it.unit.qty)} ≈ ${approxG(it.grams)} г` : `${it.grams} г`;
}


/** Ids of the foods and dishes this person ate in the last two months (search prefers them — D30). */
function usualIds(all: DayEntry[] | undefined): Set<string> {
  return new Set(all ? frequentItems(all, todayISO(), 60, 50).map((f) => f.item.recipe?.id ?? f.item.foodId ?? '') : []);
}

/** Allow the user to clear and replace a number without immediately restoring the old value. */
function PortionsInput({ value, onCommit }: { value: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const next = Number(draft.replace(',', '.'));
    if (draft.trim() && Number.isFinite(next) && next >= 0.5) onCommit(next);
    setDraft(null);
  };
  return <input type="text" inputMode="decimal" className={field} value={draft ?? String(value)}
    onChange={(e) => setDraft(e.target.value)} onBlur={commit}
    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
    aria-label={t.meal.portions} />;
}
