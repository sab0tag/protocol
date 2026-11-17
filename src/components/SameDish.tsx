import type { Recipe } from '../domain/types';
import { t } from '../i18n/uk';

/** D164: before a second dish with nearly the same name — «Це те саме?». «Так» updates the one that is there (its name and
 *  id kept, so its history and pins stay); «Ні» saves a new one. Asked once per save, never silently merged. */
export function SameDish({ similar, onSame, onNew }: { similar: Recipe; onSame: () => void; onNew: () => void }) {
  const L = t.dishes.same;
  return (
    <div role="alertdialog" aria-label={L.ask(similar.name)} className="mt-2 space-y-2 rounded-xl border border-accent/40 bg-surface p-3 text-sm">
      <p className="font-medium">{L.ask(similar.name)}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onSame} className="min-h-tap rounded-full bg-accent px-4 font-semibold text-on-accent">{L.yes(similar.name)}</button>
        <button type="button" onClick={onNew} className="min-h-tap rounded-full border-2 border-line px-4 font-semibold">{L.no}</button>
      </div>
    </div>
  );
}
