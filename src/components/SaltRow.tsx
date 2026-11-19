// D188: the plan limits salt — the line is always shown, free (unlike paid trackers): «сіль ~3,8 г з 5», a bar to the limit when
// the plan says the grams, «не менше» when a line of the day did not know its sodium.
import { ProgressTrack } from './ProgressTrack';
import { gramsText, saltG, saltLine, type Sum } from '../domain/nutrition';
import { t } from '../i18n/uk';

const N = t.nutrients;
export function SaltRow({ totals, limit, hint = true }: { totals: Pick<Sum, 'sodiumMg' | 'partial'>; limit: { maxG?: number } | null; hint?: boolean }) {
  if (!limit) return null;
  const g = saltG(totals.sodiumMg), over = limit.maxG !== undefined && g > limit.maxG;
  return <div className="space-y-2" data-testid="salt-row">
    <p className={`tabular text-sm ${over ? 'text-warn' : 'text-muted'}`}>{saltLine(totals, limit, N.saltLine)}{over ? ` · ${N.saltOver(gramsText(g - limit.maxG!))}` : ''}</p>
    {limit.maxG !== undefined && <ProgressTrack ratio={g / limit.maxG} label={N.salt} valueText={saltLine(totals, limit, N.saltLine)} tone={over ? 'warn' : 'carbs'} />}
    {hint && <p className="text-xs text-muted">{N.saltHint}</p>}
  </div>;
}
