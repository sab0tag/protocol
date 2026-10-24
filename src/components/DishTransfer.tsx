import { useState } from 'react';
import { db, inDemo } from '../data/db';
import { newId, todayISO } from '../domain/dates';
import { lineItem, recipeItems } from '../domain/dishBreakdown';
import { dishListLines, dishName, exportDishList, MAX_DISH_FILE, MAX_DISH_TEXT, readDishList } from '../domain/dishTransfer';
import { amountText } from '../domain/foodSearch';
import { mealNutrients, round } from '../domain/nutrition';
import { checkMeal } from '../domain/rules';
import type { Food, Plan, Recipe } from '../domain/types';
import { ApiError, dishListBreakdown } from '../sync/api';
import { currentKeys } from '../sync/runner';
import { t } from '../i18n/uk';
import { toast } from './Toast';

const field = 'block min-h-tap w-full rounded-xl border border-line bg-bg px-3';
const button = 'min-h-tap rounded-xl border border-line px-3 disabled:opacity-40';
type Draft = ReturnType<typeof dishListLines>[number] & { key: string; selected: boolean };
function download(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DishTransfer({ foods, plan, recipes }: { foods: Map<string, Food>; plan?: Plan; recipes: Recipe[] }) {
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const own = recipes.filter((r) => !r.builtIn);
  const known = new Set(recipes.map((r) => dishName(r.name)));
  const prepare = (value: unknown) => {
    const rows = readDishList(value);
    const names = new Set(known);
    setDrafts(dishListLines(rows, [...foods.values()]).map((row) => {
      const name = dishName(row.name), selected = !names.has(name); names.add(name);
      return { ...row, key: newId(), selected };
    }));
  };
  const loadJson = (value: string) => {
    if (new TextEncoder().encode(value).length > MAX_DISH_FILE) { setError('Файл завеликий: максимум 2 МБ.'); return; }
    try { prepare(JSON.parse(value.replace(/^\uFEFF/, ''))); setNote('Файл прочитано на пристрої, без ІІ. Перевірте склад і ваги.'); }
    catch (e) { setError(e instanceof SyntaxError ? 'Некоректний JSON. Завантажте файл за зразком або експорт із «Мої страви».' : (e as Error).message); }
  };
  const readFile = async (file?: File) => {
    if (!file) return;
    setError(''); setNote(''); setText(''); setDrafts([]); setConsent(false);
    if (file.size > MAX_DISH_FILE) { setError('Файл завеликий: максимум 2 МБ.'); return; }
    if (!/\.(json|txt|md)$/i.test(file.name)) { setError('Оберіть JSON, TXT або MD.'); return; }
    try {
      const value = await file.text();
      if (/\.json$/i.test(file.name)) { loadJson(value); return; }
      if (value.length > MAX_DISH_TEXT) { setError('Список задовгий: максимум 12 000 символів. Розділіть його.'); return; }
      setText(value); setNote('Текст завантажено. Натисніть «Розібрати список», щоб перевірити страви.');
    } catch { setError('Не вдалося прочитати файл. Спробуйте ще раз.'); }
  };
  const ask = async (allow = false) => {
    setError(''); setNote('');
    if (text.trim().startsWith('{') || text.trim().startsWith('[')) { loadJson(text); return; }
    if (inDemo()) { setError(t.dishes.breakdown.demo); return; }
    if (text.length > MAX_DISH_TEXT) { setError('Максимум 12 000 символів. Розділіть список.'); return; }
    if (!allow) { setConsent(true); return; }
    setBusy(true);
    try {
      const r = await dishListBreakdown(currentKeys() ?? null, text.trim(), [...foods.values()].map((f) => f.name));
      if (!r.dishes.length) { setError(r.note || 'Страв не знайдено. Додайте назви та склад.'); return; }
      const skipped = r.dishes.filter((d) => !d.readable || !d.items.length);
      const good = r.dishes.filter((d) => d.readable && d.items.length);
      setNote([r.note, ...skipped.map((d) => `Не розібрано: ${d.name || 'без назви'} — ${d.note || 'додайте склад'}`)].filter(Boolean).join('\n'));
      if (good.length) prepare(good);
      else setError('Додайте склад до кожної страви. Рецепти лише за назвами не вигадуються.');
    } catch (e) {
      const code = e instanceof ApiError ? e.status === 0 ? 'offline' : e.code : 'other';
      setError((t.dishes.breakdown.errors as Record<string, string>)[code] ?? t.dishes.breakdown.errors.other);
    } finally { setBusy(false); }
  };
  const update = (key: string, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d) => d.key === key ? { ...d, ...patch } : d));
  const selected = drafts.filter((d) => d.selected);
  const names = selected.map((d) => dishName(d.name));
  const invalid = selected.some((d) => !d.name.trim() || !d.lines.some((l) => l.grams > 0) || !Number.isFinite(d.portions) || d.portions < 1 || known.has(dishName(d.name))) || new Set(names).size !== names.length;
  const save = async () => {
    if (invalid || !selected.length || busy) return;
    setBusy(true); setError('');
    const rows = selected.map((d) => ({ id: newId(), name: d.name.trim(), items: recipeItems(d.lines.filter((l) => l.grams > 0), d.portions) }));
    try {
      await db.transaction('rw', db.recipes, async () => {
        const existing = new Set((await db.recipes.toArray()).map((r) => dishName(r.name)));
        if (rows.some((r) => existing.has(dishName(r.name)))) throw new Error('Така назва вже є. Перейменуйте страву або зніміть позначку.');
        await db.recipes.bulkAdd(rows);
      });
      toast(`Збережено страв: ${rows.length}`, { undo: () => db.recipes.bulkDelete(rows.map((r) => r.id)) });
      setDrafts([]); setText(''); setNote('');
    } catch (e) { setError(`Не збережено жодної страви. ${(e as Error).message}`); }
    finally { setBusy(false); }
  };
  const example = () => download(JSON.stringify({ format: 'protocol-dishes', version: 1, dishes: [{ readable: true, name: 'Кабачок на парі', portions: 1,
    note: 'КБЖУ на 100 г — орієнтовні.', items: [{ said: 'Кабачок на парі', base: '', grams: 150, amountSaid: true, kcal: 17, protein: 1.2, fat: 0.3, carbs: 3.1, tags: [], allergens: [] }] }] }, null, 2), 'dishes-example.json', 'application/json');
  return <details className="space-y-3 rounded-2xl border border-line bg-surface p-3">
    <summary className="min-h-tap cursor-pointer font-semibold">Імпорт та експорт списку страв</summary>
    <section aria-label="Імпорт списку страв" className="space-y-3">
      <p className="text-sm text-muted">Вставте до 20 рецептів зі складом, розділяючи їх порожнім рядком, або завантажте TXT / MD. JSON (до 200 страв) за зразком чи з експорту імпортується без ІІ. Збереження — після перевірки.</p>
      <div className="flex flex-wrap gap-2">
        <label className={button + ' flex cursor-pointer items-center'}>Завантажити файл
          <input aria-label="Файл зі списком страв" type="file" accept=".json,.txt,.md" disabled={busy} className="sr-only" onChange={(e) => { void readFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
        <button type="button" className={button} onClick={example}>Зразок JSON</button>
      </div>
      {!drafts.length && <>
        <label className="block"><span className="text-sm">Список страв</span><textarea rows={6} className={field + ' py-2'} disabled={busy} value={text} onChange={(e) => { setText(e.target.value); setConsent(false); }} placeholder={'Омлет з кабачком, 1 порція: яйце 50 г, кабачок 150 г…\n\nСуп з індичкою, 2 порції: …'} /></label>
        <button type="button" className={button} disabled={busy || text.trim().length < 3} onClick={() => void ask()}>{busy ? 'Розбираю список…' : 'Розібрати список'}</button>
        {consent && !busy && <div className="space-y-2 rounded-xl border border-line p-2 text-sm"><p>Текст списку та назви продуктів з бази підуть через наш сервер до Claude (Anthropic). План лікаря не надсилається. Усі рецепти розбираються одним запитом.</p>
          <button type="button" className={button} onClick={() => void ask(true)}>Дозволити й розібрати список</button></div>}
      </>}
      {note && <p role="status" className="whitespace-pre-line text-sm text-warn">{note}</p>}
      {drafts.length > 0 && <>
        <p className="text-sm">Перевірте грами готових інгредієнтів. КБЖУ оцінені, якщо продукту немає в базі. Дублі не позначено для збереження.</p>
        {drafts.map((d) => {
          const items = recipeItems(d.lines.filter((l) => l.grams > 0), d.portions), n = mealNutrients(items, foods);
          const checks = plan ? checkMeal({ plan, date: todayISO(), foods, dayEntries: [], recentEntries: [], meal: d.lines.map(lineItem) }) : [];
          return <fieldset key={d.key} disabled={busy} className="space-y-2 rounded-xl border border-line p-2">
            <label className="flex min-h-tap items-center gap-2"><input type="checkbox" checked={d.selected} onChange={(e) => update(d.key, { selected: e.target.checked })} />Зберегти: {d.name}</label>
            <label className="block">Назва страви<input className={field} value={d.name} onChange={(e) => update(d.key, { name: e.target.value })} /></label>
            {known.has(dishName(d.name)) && <p className="text-sm text-warn">Назва вже є. Перейменуйте або не зберігайте цей пункт.</p>}
            <label className="block">Порцій<input className={field} type="number" min={1} max={100} step={1} value={d.portions} onChange={(e) => update(d.key, { portions: Math.min(100, Math.max(1, Number(e.target.value) || 1)) })} /></label>
            {d.note && <p className="text-sm text-warn">{d.note}</p>}
            {d.lines.map((l, i) => <div key={l.key} className="space-y-1 border-t border-line py-1 text-sm">
              <label className="flex items-center gap-2"><span className="flex-1">{l.food?.name ?? l.said}<small className="block text-muted">{l.food ? 'з бази' : 'оцінка — не з бази'}{!l.amountSaid && ' · кількість оцінено'}</small></span>
                <input aria-label={`Грами: ${d.name}: ${l.food?.name ?? l.said}`} className={field + ' max-w-20'} type="number" min={0} max={3000} value={l.grams} onChange={(e) => update(d.key, { lines: d.lines.map((x) => x.key === l.key ? { ...x, grams: Math.min(3000, Math.max(0, Number(e.target.value) || 0)) } : x) })} />г</label>
              {checks[i]?.hits.map((h, j) => <p key={j} className="text-warn">{h.message}</p>)}
            </div>)}
            <p className="tabular text-sm">На порцію: {round(items.reduce((s, x) => s + x.grams, 0))} г · {round(n.kcal)} ккал · Б {round(n.protein)} · Ж {round(n.fat)} · В {round(n.carbs)}</p>
          </fieldset>;
        })}
        {invalid && <p className="text-sm text-warn">Перевірте назви: без порожніх і повторних; у кожній страві має бути хоча б один інгредієнт.</p>}
        <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || invalid || !selected.length} onClick={() => void save()}>Зберегти вибрані ({selected.length})</button>
          <button type="button" className={button} disabled={busy} onClick={() => { setDrafts([]); setError(''); }}>Скасувати імпорт</button></div>
      </>}
      {error && <p role="alert" className="text-sm text-warn">{error}</p>}
      <div className="space-y-2 border-t border-line pt-3"><p className="text-sm text-muted">Експорт власних страв: {own.length}. Вбудовані страви не включено.</p><div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={!own.length} onClick={() => download(exportDishList(own, foods), 'my-dishes.json', 'application/json')}>Експорт JSON</button>
        <button type="button" className={button} disabled={!own.length} onClick={() => download(own.map((r) => `${r.name}, 1 порція:\n${r.items.map((i) => `${i.name} ${amountText(i)}`).join(', ')}`).join('\n\n'), 'my-dishes.txt', 'text/plain;charset=utf-8')}>Експорт списком (TXT)</button>
      </div></div>
    </section>
  </details>;
}
