// «Підтвердити прийом» (SPEC.md §14.3, D55): a planned meal — the menu's proposal or the person's own plan — becomes
// a fact only by ticks. Nothing is ticked beforehand; a ticked line can be corrected right here (amount, portions),
// a changed one says what the plan had. «Коли?» is asked the way D52 asks: chosen, never assumed — only when the
// meal is due right now is «Щойно» chosen already (and can be changed). Lines left unticked are not «пропущено» —
// they were replaced, left out or just not eaten; they are simply not written as eaten.
import { differenceInMinutes, format } from 'date-fns';
import { Pencil, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { amountText } from '../domain/foodSearch';
import { lineNutrients, round } from '../domain/nutrition';
import { setPortions } from '../domain/recipes';
import { NOW_AFTER_MIN } from '../domain/reminders';
import { timeOf, todayISO } from '../domain/dates';
import type { DayEntry, Food, MealItem } from '../domain/types';
import { t } from '../i18n/uk';
import { Amount } from './Amount';
import { markMeal, type When } from './MarkTime';
import { Sheet } from './Sheet';

const L = t.confirm;
const M = t.mark;
type Choice = 'now' | 'planned' | 'other' | 'unknown';

export function ConfirmMeal({ entry, date, foods, onClose, onEdit, onPin, onDelete }: {
  entry: DayEntry; date: string; foods?: Map<string, Food>; onClose: () => void; onEdit: () => void; onPin: () => void; onDelete: () => void;
}) {
  const planned = timeOf(entry.at);
  const now = format(new Date(), 'HH:mm');
  const isToday = date === todayISO();
  const dueNow = isToday && Math.abs(differenceInMinutes(new Date(), new Date(`${date}T${planned}:00`))) <= NOW_AFTER_MIN;
  const [items, setItems] = useState<MealItem[]>(() => (entry.items ?? []).map((x) => ({ ...x })));
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [choice, setChoice] = useState<Choice | null>(dueNow ? 'now' : null);
  const [other, setOther] = useState(planned);
  const original = entry.items ?? [];

  const when = (): When | null => (choice === 'now' ? { time: now } : choice === 'planned' ? { time: planned }
    : choice === 'other' ? (other ? { time: other } : null) : choice === 'unknown' ? { unknown: true } : null);
  const save = () => {
    const w = when();
    if (!w || !ticked.size) return;
    onClose();
    void markMeal(entry, date, 'done', w, { items: items.filter((_, i) => ticked.has(i)) });
  };
  const none = () => { onClose(); void markMeal(entry, date, 'skipped', { time: planned }); };
  const set = (i: number, x: MealItem) => setItems((xs) => xs.map((y, j) => (j === i ? x : y)));
  const chip = (c: Choice, label: string) => (
    <button key={c} type="button" onClick={() => setChoice(c)} aria-pressed={choice === c}
      className={`min-h-tap rounded-full border px-3 text-sm ${choice === c ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-line'}`}>{label}</button>
  );

  return (
    <Sheet title={L.title(entry.title)} onClose={onClose}>
      <p className="mb-2 text-sm text-muted">{L.hint}</p>
      <ul className="divide-y divide-line border-y border-line">
        {items.map((it, i) => {
          const on = ticked.has(i);
          const was = original[i] && amountText(original[i]!) !== amountText(it) ? L.was(amountText(original[i]!)) : null;
          return (
            <li key={i} className="py-1">
              <label className="flex min-h-tap items-center gap-3">
                <input type="checkbox" checked={on} className="h-5 w-5 shrink-0 accent-[rgb(var(--accent))]"
                  onChange={(e) => setTicked((s) => { const n = new Set(s); if (e.target.checked) n.add(i); else n.delete(i); return n; })} />
                <span className="min-w-0 flex-1"><span className="block font-medium">{it.name}</span>
                  <span className="block text-sm text-muted">{amountText(it)}{it.unit || it.recipe ? ` ≈ ${it.grams} г` : ''}
                    {foods ? ` · ${round(lineNutrients(it, foods).kcal)} ${t.units.kcal}` : ''}{was ? ` · ${was}` : ''}</span></span>
              </label>
              {on && (it.recipe && it.components
                ? <label className="ml-8 block w-40"><span className="text-sm text-muted">{t.meal.portions}</span>
                    <input type="number" inputMode="decimal" min={0.5} step={0.5} value={it.recipe.portions}
                      onChange={(e) => { const v = Number(e.target.value); if (v > 0) set(i, setPortions(it, v)); }}
                      className="mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3" /></label>
                : <div className="ml-8"><Amount item={it} food={it.foodId ? foods?.get(it.foodId) : undefined} onChange={(p) => set(i, { ...it, ...p })} /></div>)}
            </li>
          );
        })}
      </ul>

      <fieldset className="mt-3">
        <legend className="mb-1 text-sm font-medium">{L.when}</legend>
        <div className="flex flex-wrap gap-2">
          {isToday && chip('now', M.justNow(now))}
          {chip('planned', M.asPlanned(planned))}
          {chip('other', M.other)}
          {chip('unknown', M.unknown)}
        </div>
        {choice === 'other' && (
          <label className="mt-2 block w-40"><span className="sr-only">{M.other}</span>
            <input type="time" value={other} onChange={(e) => setOther(e.target.value)} className="block min-h-tap w-full rounded-xl border border-line bg-bg px-3" /></label>
        )}
      </fieldset>

      <button type="button" onClick={save} disabled={!ticked.size || !when()}
        className="mt-4 min-h-tap w-full rounded-xl bg-accent px-4 font-medium text-surface disabled:opacity-40">
        {!ticked.size ? L.pickSome : !when() ? L.pickWhen : L.save(ticked.size)}</button>
      <button type="button" onClick={none} className="mt-2 min-h-tap w-full rounded-xl border border-line px-4">{L.none}</button>

      <div className="mt-3 flex flex-wrap justify-center gap-x-5 text-sm">
        <button type="button" onClick={onEdit} className="flex min-h-tap items-center gap-1 text-muted"><Pencil size={16} aria-hidden />{t.rowActions.edit}</button>
        <button type="button" onClick={onPin} className="flex min-h-tap items-center gap-1 text-muted"><Star size={16} aria-hidden />{t.meal.pin}</button>
        <button type="button" onClick={onDelete} className="flex min-h-tap items-center gap-1 text-warn"><Trash2 size={16} aria-hidden />{t.rowActions.delete}</button>
      </div>
    </Sheet>
  );
}
