// D188: the numbers of an own food, a label or a free line — one set of fields. Calories are checked against the macros
// (≈ 4 × Б + 9 × Ж + 4 × В): not given — counted; more than 20 % off — «Перевірте» beside the field, never a block (alcohol
// and fibre make an honest difference). Salt, sugars, fibre and saturated fat — in «Більше нутрієнтів», folded; salt is
// typed in grams as a label says it and kept as sodium (÷ 2.5).
import type { Nutrients } from '../domain/types';
import { kcalFromMacros, kcalOff } from '../domain/nutrition';
import { t } from '../i18n/uk';

export type FieldKey = 'kcal' | 'protein' | 'fat' | 'carbs' | 'calciumMg' | 'saltG' | 'sugarsG' | 'fiberG' | 'satFatG';
export type Fields = Record<FieldKey, string>;
export const EMPTY_FIELDS: Fields = { kcal: '', protein: '', fat: '', carbs: '', calciumMg: '', saltG: '', sugarsG: '', fiberG: '', satFatG: '' };

const num = (s: string) => Math.max(0, Number(s.replace(',', '.')) || 0);
const given = (s: string) => s.trim() !== '' && Number.isFinite(Number(s.replace(',', '.')));
const r1 = (x: number) => Math.round(x * 10) / 10;

/** The fields as numbers: an empty kcal is the macros' count; an empty extra stays unknown (not 0). */
export function fieldsToNutrients(n: Fields): Nutrients {
  const p = num(n.protein), f = num(n.fat), c = num(n.carbs);
  return {
    kcal: given(n.kcal) ? num(n.kcal) : Math.round(kcalFromMacros(p, f, c)), protein: p, fat: f, carbs: c,
    ...(given(n.calciumMg) ? { calciumMg: num(n.calciumMg) } : {}),
    ...(given(n.saltG) ? { sodiumMg: Math.round((num(n.saltG) * 1000) / 2.5) } : {}),
    ...(given(n.sugarsG) ? { sugarsG: num(n.sugarsG) } : {}),
    ...(given(n.fiberG) ? { fiberG: num(n.fiberG) } : {}),
    ...(given(n.satFatG) ? { satFatG: num(n.satFatG) } : {}),
  };
}

/** Numbers (a label's reading) as fields; sodium shown back as salt. */
export function nutrientsToFields(p: Partial<Record<keyof Nutrients, number | null>>): Fields {
  const s = (x: number | null | undefined) => (x == null ? '' : String(r1(x)));
  return { kcal: s(p.kcal), protein: s(p.protein), fat: s(p.fat), carbs: s(p.carbs), calciumMg: s(p.calciumMg),
    saltG: p.sodiumMg == null ? '' : String(Math.round((p.sodiumMg * 2.5) / 100) / 10), sugarsG: s(p.sugarsG), fiberG: s(p.fiberG), satFatG: s(p.satFatG) };
}

const L = t.nutrients;
export function NutrientFields({ value, onChange, field, kcalLabel }: { value: Fields; onChange: (next: Fields) => void; field: string; kcalLabel: string }) {
  const set = (k: FieldKey, v: string) => onChange({ ...value, [k]: v });
  const macros = [value.protein, value.fat, value.carbs].some(given);
  const expected = Math.round(kcalFromMacros(num(value.protein), num(value.fat), num(value.carbs)));
  const off = given(value.kcal) && macros ? kcalOff(num(value.kcal), num(value.protein), num(value.fat), num(value.carbs)) : null;
  const core: [FieldKey, string][] = [['kcal', kcalLabel], ['protein', 'Б, г'], ['fat', 'Ж, г'], ['carbs', 'В, г'], ['calciumMg', 'Ca, мг']];
  const more: [FieldKey, string][] = [['saltG', L.saltField], ['sugarsG', L.sugarsField], ['fiberG', L.fiberField], ['satFatG', L.satFatField]];
  const input = ([k, label]: [FieldKey, string]) => (
    <label key={k} className="block"><span className="text-sm text-muted">{label}</span>
      <input type="text" inputMode="decimal" value={value[k]} onChange={(e) => set(k, e.target.value)} className={field} data-field={k} /></label>
  );
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">{core.map(input)}</div>
      {off !== null && <p role="status" className="text-sm text-warn" data-testid="kcal-check">{L.kcalCheck(off)}</p>}
      {!given(value.kcal) && macros && expected > 0 && <p className="text-sm text-muted" data-testid="kcal-from-macros">{L.kcalFromMacros(expected)}</p>}
      <details open={more.some(([k]) => given(value[k]))}>
        <summary className="min-h-tap cursor-pointer py-2 text-sm text-accent">{L.more}</summary>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{more.map(input)}</div>
      </details>
    </div>
  );
}
