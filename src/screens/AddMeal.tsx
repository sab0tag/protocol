import { format } from 'date-fns';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../data/db';
import { useDayEntries, useFoods, usePlan, useRecentEntries } from '../data/queries';
import { atLocal, dateOf, newId, timeOf, todayISO } from '../domain/dates';
import { activeMode, dayTotals, effectiveTargets, itemNutrients, mealNutrients, round } from '../domain/nutrition';
import { applySwaps, checkMeal, hasSwaps, mealVerdict, type ItemCheck } from '../domain/rules';
import { itemFor, measureWord, parseQuery, searchFoods, type Query } from '../domain/foodSearch';
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
  const plan = usePlan();

  const [loaded, setLoaded] = useState(id === undefined);
  const [date, setDate] = useState(uiDate);
  const [time, setTime] = useState(uiDate === todayISO() ? format(new Date(), 'HH:mm') : '13:00');
  const [title, setTitle] = useState(() => defaultMealName(time));
  const [eaten, setEaten] = useState(uiDate <= todayISO());
  const [items, setItems] = useState<MealItem[]>([]);
  const [query, setQuery] = useState('');
  const [free, setFree] = useState(false);

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
  const matches = useMemo(() => (foods ? searchFoods([...foods.values()], parsed.text) : []), [foods, parsed]);

  if (!loaded || !foods) return null;

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
    await db.entries.put(entry);
    useUi.getState().setDate(date);
    navigate('/');
  };

  return (
    <section className="pt-4">
      <h1 className="mb-3 text-2xl font-semibold">{id ? t.meal.editTitle : t.meal.title}</h1>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="rounded-2xl border border-line bg-surface p-3">
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

        <div className="rounded-2xl border border-line bg-surface p-3">
          <label className="block"><span className="text-sm text-muted">{t.meal.search}</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.meal.searchHint}
              className={field} autoComplete="off" /></label>
          {matches.length > 0 && (
            <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
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
          <button type="button" onClick={() => setFree((v) => !v)} className="mt-2 min-h-tap text-accent underline">{t.meal.free}</button>
          {free && <FreeItemForm onAdd={(it) => { setItems((xs) => [...xs, it]); setFree(false); }} />}
        </div>

        <div className="rounded-2xl border border-line bg-surface p-3">
          <h2 className="mb-2 font-semibold">{t.meal.items}</h2>
          {items.length === 0 && <p className="text-muted">{t.meal.noItems}</p>}
          <ul className="space-y-3">
            {items.map((it, i) => {
              const n = itemNutrients(it, it.foodId ? foods.get(it.foodId) : undefined);
              return (
                <li key={i} className="rounded-xl border border-line p-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{it.name}</span>
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
        </div>

        {items.length > 0 && <CheckPanel checks={checks} anyActive={anyActive} swapped={swapped} />}

        <div className="rounded-2xl border border-line bg-surface p-3 tabular">
          <p><span className="text-muted">{t.meal.mealTotal}: </span>
            {round(meal.kcal)} {t.units.kcal} · Б {round(meal.protein)} · Ж {round(meal.fat)} · В {round(meal.carbs)} · Ca {round(meal.calciumMg)} {t.units.mg}</p>
          {after && (
            <p className="mt-1"><span className="text-muted">{t.meal.dayLeft}: </span>
              {t.day.carbs.toLowerCase()} {round(after.carbs)}
              {targets.carbsG?.min != null ? ` (${t.day.atLeast(targets.carbsG.min)})`
                : targets.carbsG?.max != null ? ` / ${targets.carbsG.max} ${t.units.g}` : ''}
              {targets.proteinG != null && ` · білок ${round(after.protein)} / ${targets.proteinG}`}
              {targets.calciumMg != null && ` · кальцій ${round(after.calciumMg)} / ${targets.calciumMg}`}
            </p>
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

function FreeItemForm({ onAdd }: { onAdd: (item: MealItem) => void }) {
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
      <button type="button" disabled={!name.trim() || !grams}
        onClick={() => onAdd({ name: name.trim(), grams: num(grams),
          manual: { kcal: num(n.kcal), protein: num(n.protein), fat: num(n.fat), carbs: num(n.carbs), calciumMg: num(n.calciumMg ?? '') } })}
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
                {j > 0 && <Badge verdict={h.verdict} small />} {h.message}{h.suggestion && <span className="text-muted"> → {h.suggestion}</span>}
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

/** The amount of a line: grams, or a household measure of the food with its weight shown («≈ 100 г»). */
function Amount({ item, food, onChange }: { item: MealItem; food?: Food; onChange: (patch: Partial<MealItem>) => void }) {
  const units = item.manual ? [] : food?.units ?? [];
  const pick = (name: string) => {
    const u = units.find((x) => x.name === name);
    if (!u) return onChange({ unit: undefined });
    const qty = Math.max(0.5, Math.round((item.grams / u.grams) * 2) / 2);
    onChange({ unit: { name: u.name, qty, grams: u.grams }, grams: Math.round(qty * u.grams) });
  };
  return (
    <div className="grid grid-cols-[1fr_auto] items-end gap-1">
      <label className="block"><span className="text-sm text-muted">{item.unit ? t.meal.qty : t.meal.grams}</span>
        <input type="number" inputMode="decimal" min={0} step={item.unit ? 0.5 : 1} readOnly={!!item.manual}
          value={item.unit ? item.unit.qty : item.grams}
          onChange={(e) => {
            const v = Math.max(0, Number(e.target.value) || 0);
            onChange(item.unit ? { unit: { ...item.unit, qty: v }, grams: Math.round(v * item.unit.grams) } : { grams: v });
          }}
          className={field} /></label>
      {units.length > 0 && (
        <label className="block"><span className="sr-only">{t.meal.unit}</span>
          <select value={item.unit?.name ?? 'г'} onChange={(e) => pick(e.target.value)} className={`${field} w-auto`}>
            <option value="г">г</option>
            {units.map((u) => <option key={u.name} value={u.name}>{u.name}</option>)}
          </select></label>
      )}
      {item.unit && <span className="col-span-2 text-xs text-muted">≈ {item.grams} г</span>}
    </div>
  );
}
