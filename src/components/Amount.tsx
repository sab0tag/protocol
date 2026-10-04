import type { Food, MealItem } from '../domain/types';
import { t } from '../i18n/uk';

const field = 'mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3';

/** The amount of a line: grams, or a household measure of the food with its weight shown («≈ 100 г»). */
export function Amount({ item, food, onChange }: { item: MealItem; food?: Food; onChange: (patch: Partial<MealItem>) => void }) {
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
