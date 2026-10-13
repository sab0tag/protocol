// D57: «Містить» — the person ticks what the package names; nothing is ticked for them.
import { ALLERGENS, type Allergen } from '../domain/types';
import { t } from '../i18n/uk';

export function AllergenPicker({ value, onChange, legend = t.allergen.fromPackage }: { value: Allergen[]; onChange: (v: Allergen[]) => void; legend?: string }) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm text-muted">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {ALLERGENS.map((a) => {
          const on = value.includes(a);
          return (
            <button key={a} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== a) : ALLERGENS.filter((x) => x === a || value.includes(x)))}
              className={`min-h-tap rounded-full border px-2.5 text-sm ${on ? 'border-warn bg-warn-bg font-medium text-warn' : 'border-line'}`}>{t.allergen.name[a]}</button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** «Містить: молоко, глютен» — or «склад невідомий» for a free line. */
export function AllergenNote({ allergens, unknown, className = '' }: { allergens: Allergen[]; unknown?: boolean; className?: string }) {
  if (!allergens.length && !unknown) return null;
  const words = [...allergens.map((a) => t.allergen.name[a]), ...(unknown ? [t.allergen.unknown] : [])];
  return <span className={`text-sm text-muted ${className}`}>{t.allergen.contains}: {words.join(', ')}</span>;
}
