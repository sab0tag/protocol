import { useFeatures } from '../app/features';
// D92: «Білка 85 з 140 г. Добрати до вечора?» and «Вуглеводів 170 з 190 г — на вечерю краще без гарніру» on «День» — the
// numbers from the code, at most once a day for each target, with «Не сьогодні». A tap puts the choice in the evening's
// plan as a planned snack (to tick when eaten), never into what was eaten.
import { format } from 'date-fns';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../data/db';
import { keep, kept } from '../data/kept';
import { atLocal, newId } from '../domain/dates';
import { amountText, approxG } from '../domain/foodSearch';
import type { NearLimit, Topup } from '../domain/topup';
import type { DayEntry, Targets } from '../domain/types';
import { t } from '../i18n/uk';
import { saved } from './Toast';
import { count, countOnce } from '../data/tally';

const L = t.topup;
const DAY = 86_400_000;

export function TopupCard({ date, targets, tops, near }: { date: string; targets: Targets; tops: Topup[]; near: NearLimit | null }) {
  const { can } = useFeatures();
  const [, redraw] = useState(0);
  const done = (key: string) => kept<string>(`topup:${date}:${key}`, DAY) !== undefined;
  const answer = (key: string, what: string) => { keep(`topup:${date}:${key}`, what); redraw((n) => n + 1); };
  const showTops = tops.filter((x) => !done(x.goal)), showNear = near && !done('carbs') ? near : null;
  const shownGoals = showTops.map((x) => x.goal).join(',');
  useEffect(() => { for (const g of shownGoals.split(',').filter(Boolean)) void countOnce('topup_shown', `${date}:${g}`); }, [shownGoals, date]); // D119
  if (!showTops.length && !showNear) return null;
  const when = () => { // a quarter of an hour from now, never past «останній прийом до»
    const by = targets.lastMealBy ?? '20:00', now = new Date();
    const later = format(new Date(now.getTime() + 900_000), 'HH:mm');
    return later < by ? later : by;
  };
  const plan = async (x: Topup, i: number) => {
    const e: DayEntry = { id: newId(), at: atLocal(date, when()), kind: 'meal', status: 'planned', title: L.snack, items: [x.items[i]!] };
    await saved(db.entries.add(e), L.planned(x.items[i]!.name), () => db.entries.delete(e.id));
    void count('topup_taken'); // D119
    answer(x.goal, 'accepted');
  };
  return (
    <section aria-label={L.title} className="protocol-card mb-4 space-y-3 border-accent/30 p-4">
      {showTops.map((x) => (
        <div key={x.goal}>
          <p className="font-medium">{L.ask(L.goals[x.goal], x.have, x.target, L.units[x.goal])}</p>
          <div className="mt-1 space-y-1">
            {x.items.map((it, i) => (
              <button key={it.name} type="button" onClick={() => void plan(x, i)} data-item={it.name}
                className="block min-h-tap w-full rounded-xl border border-line px-3 py-1 text-left text-sm">
                <span className="font-medium">{it.name}</span><span className="text-muted"> · {amountText(it)}{it.unit ? ` ≈ ${approxG(it.grams)} г` : ''}</span></button>
            ))}
          </div>
          <button type="button" onClick={() => answer(x.goal, 'snoozed')} className="min-h-tap px-1 text-sm text-muted underline">{L.notToday}</button>
        </div>
      ))}
      {showTops.length > 0 && can('assistant.chat') && <Link to="/assistant" className="block min-h-tap text-sm text-accent underline">{L.other}</Link> /* D117 */}
      {showNear && (
        <div>
          <p className="font-medium">{L.near(showNear.have, showNear.max)}</p>
          <div className="flex gap-3">
            <button type="button" onClick={() => answer('carbs', 'accepted')} className="min-h-tap px-1 text-sm text-accent underline">{L.ok}</button>
            <button type="button" onClick={() => answer('carbs', 'snoozed')} className="min-h-tap px-1 text-sm text-muted underline">{L.notToday}</button>
          </div>
        </div>
      )}
    </section>
  );
}
