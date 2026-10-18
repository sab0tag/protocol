// D91: the concierge, scenario 1 — a line the base did not find. A danger sign in the words goes straight to the 103 card
// (no model). Otherwise the model picks up to 3 of the base's own names; the app counts the grams from the person's words
// («2 пиріжки» → 2), checks each against the plan, and adds one only on a tap. Logged only with its own consent.
import { useLiveQuery } from 'dexie-react-hooks';
import { Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { db } from '../data/db';
import { appVersion, planVersion } from '../domain/concierge';
import { approxG, amountText, itemFor, parseQuery } from '../domain/foodSearch';
import { dishItem } from '../domain/recipes';
import { checkMeal } from '../domain/rules';
import { dangerInText } from '../domain/symptoms';
import type { Food, MealItem, Plan, Recipe } from '../domain/types';
import { t } from '../i18n/uk';
import { ApiError, conciergeNotFound, conciergeOutcome } from '../sync/api';
import { currentKeys } from '../sync/runner';
import { DangerCard } from './DangerCard';
import { NeedsSync } from './NeedsSync';

const L = t.concierge;

export interface Suggested { logId?: string; item: MealItem }

export function ConciergeNotFound({ text, plan, foods, recipes, date, onAdd }: {
  text: string; plan: Plan | undefined; foods: Map<string, Food>; recipes: Recipe[]; date: string; onAdd: (s: Suggested) => void;
}) {
  const meta = useLiveQuery(async () => (await db.meta.get('sync')) ?? null, []);
  const [state, setState] = useState<'none' | 'nosync' | 'consent' | 'busy' | 'done'>('none');
  const [items, setItems] = useState<MealItem[]>([]);
  const [error, setError] = useState('');
  const [log, setLog] = useState(false);
  const logId = useRef<string | undefined>(undefined);
  const answered = useRef(false);
  // closed without a tap — «ignored»
  useEffect(() => () => { const k = currentKeys(); if (logId.current && !answered.current && k) void conciergeOutcome(k, logId.current, 'ignored').catch(() => undefined); }, []);

  if (dangerInText(text)) return <DangerCard className="mt-2" />; // boundary 4: hard code before any model

  const ask = async (consented = !!meta?.conciergeConsent, logNow = !!meta?.conciergeLog) => { // the consent just given, not the stale one
    setError('');
    const keys = currentKeys();
    if (!meta || !keys) return setState('nosync');
    if (!consented) return setState('consent');
    setState('busy');
    try {
      const names = [...[...foods.values()].map((f) => f.name), ...recipes.map((r) => r.name)];
      const r = await conciergeNotFound(keys, { text, names, log: logNow, versions: { app: appVersion(), plan: planVersion(plan) },
        context: { restrictions: (plan?.constraints ?? []).filter((c) => c.active).map((c) => c.diet ?? c.tag) } });
      logId.current = r.id;
      const q = parseQuery(text); // the amount from the person's own words; the name from the base
      setItems(r.candidates.flatMap((name) => {
        const f = [...foods.values()].find((x) => x.name === name), d = recipes.find((x) => x.name === name);
        return f ? [itemFor(f, q)] : d ? [dishItem(d, q.qty ?? 1)] : [];
      }));
      setState('done');
    } catch (e) {
      const code = e instanceof ApiError ? (e.status === 0 ? 'offline' : e.code) : 'other';
      setError((t.meal.photoErrors as Record<string, string>)[code] ?? t.meal.photoErrors.other); setState('none');
    }
  };
  const pick = (item: MealItem) => { answered.current = true; onAdd({ ...(logId.current ? { logId: logId.current } : {}), item }); };
  const no = () => {
    answered.current = true; setState('none'); setItems([]);
    const k = currentKeys(); if (logId.current && k) void conciergeOutcome(k, logId.current, 'dismissed').catch(() => undefined);
  };

  return (
    <div className="mt-1">
      {state !== 'done' && (
        <button type="button" onClick={() => void ask()} disabled={state === 'busy'} className="flex min-h-tap items-center gap-2 text-sm text-accent underline disabled:opacity-40">
          <Sparkles size={16} aria-hidden />{state === 'busy' ? L.busy : L.ask}</button>
      )}
      {state === 'nosync' && <NeedsSync text={L.needsSync} />}
      {state === 'consent' && (
        <div className="space-y-2 rounded-xl border border-accent/40 p-2 text-sm">
          <p>{L.consent}</p>
          <label className="flex min-h-tap items-center gap-3">
            <input type="checkbox" checked={log} onChange={(e) => setLog(e.target.checked)} className="h-5 w-5 shrink-0 accent-[rgb(var(--accent))]" />
            <span>{L.logAsk}</span></label>
          <button type="button" onClick={async () => { await db.meta.update('sync', { conciergeConsent: true, conciergeLog: log }); void ask(true, log); }}
            className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface">{L.allow}</button>
        </div>
      )}
      {state === 'done' && (
        <div className="space-y-1 rounded-xl border border-accent/40 p-2" role="group" aria-label={L.like}>
          {items.length === 0 && <p className="text-sm text-muted">{L.none}</p>}
          {items.map((it) => {
            const hits = plan ? checkMeal({ plan, date, foods, dayEntries: [], recentEntries: [], meal: [it] }).flatMap((c) => c.hits) : [];
            return (
              <button key={it.name} type="button" onClick={() => pick(it)} data-item={it.name}
                className="block min-h-tap w-full rounded-xl border border-line px-3 py-1 text-left">
                <span className="block text-sm"><span className="text-muted">{L.like}: </span><span className="font-medium">{it.name}</span>
                  <span className="text-muted"> · {amountText(it)}{it.unit || it.recipe ? ` ≈ ${approxG(it.grams)} г` : ''}</span></span>
                {hits.length > 0 && <span className="block text-xs text-warn">{[...new Set(hits.map((h) => h.message))].join(' · ')}</span>}
                <span className="block text-xs text-accent">{L.yes}</span>
              </button>
            );
          })}
          <button type="button" onClick={no} className="min-h-tap px-1 text-sm text-muted underline">{L.no}</button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-warn">{error}</p>}
    </div>
  );
}
