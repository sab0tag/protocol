import { addDays, format } from 'date-fns';
import { Copy, Share2 } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAllEntries, useFoods } from '../data/queries';
import { todayISO } from '../domain/dates';
import { shoppingList, shoppingText } from '../domain/shopping';
import { t } from '../i18n/uk';

const L = t.shop;
const field = 'mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3';
const STORE = 'protocol.shopping'; // per-device ticks — a convenience, fine to lose

function loadTicks(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(STORE) ?? '[]') as string[]); } catch { return new Set(); }
}

/** «Що купити» (SPEC.md D37): the planned meals of the chosen days as one list, ticked in the shop. */
export function Shopping() {
  const [params] = useSearchParams();
  const all = useAllEntries();
  const foods = useFoods();
  const [from, setFrom] = useState(params.get('from') ?? format(addDays(new Date(), 1), 'yyyy-MM-dd'));
  const [to, setTo] = useState(() => params.get('to') ?? format(addDays(new Date(), 3), 'yyyy-MM-dd'));
  const [ticks, setTicks] = useState(loadTicks);
  const [copied, setCopied] = useState(false);
  if (!all || !foods) return null;
  const rows = shoppingList(all, foods, from, to);
  const toggle = (key: string) => setTicks((s) => {
    const n = new Set(s);
    if (n.has(key)) n.delete(key); else n.add(key);
    try { localStorage.setItem(STORE, JSON.stringify([...n])); } catch { /* private mode */ }
    return n;
  });
  const text = `${L.title} ${from} — ${to}\n${shoppingText(rows, ticks)}`;
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* select by hand */ } };
  const left = rows.filter((r) => !ticks.has(r.key)).length;

  return (
    <section className="space-y-4 pt-6">
      <h1 className="text-2xl font-semibold">{L.title}</h1>
      <div className="grid grid-cols-2 gap-3 rounded-2xl border border-line bg-surface p-3">
        <label className="block"><span className="text-sm text-muted">{L.from}</span>
          <input type="date" value={from} min={todayISO()} onChange={(e) => setFrom(e.target.value)} className={field} /></label>
        <label className="block"><span className="text-sm text-muted">{L.to}</span>
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={field} /></label>
      </div>
      {rows.length === 0 ? <p className="text-muted">{L.empty}</p> : (
        <>
          <p className="font-medium">{L.left(left)}</p>
          {[false, true].map((pantry) => {
            const part = rows.filter((r) => r.pantry === pantry);
            return part.length > 0 && (
              <div key={String(pantry)} className="rounded-2xl border border-line bg-surface p-3">
                {pantry && <p className="mb-1 text-sm text-muted">{L.pantry}</p>}
                <ul className="divide-y divide-line">
                  {part.map((r) => (
                    <li key={r.key}>
                      <label className="flex min-h-tap items-center gap-3">
                        <input type="checkbox" checked={ticks.has(r.key)} onChange={() => toggle(r.key)} className="h-5 w-5 accent-[rgb(var(--accent))]" />
                        <span className={`flex-1 ${ticks.has(r.key) ? 'text-muted line-through' : ''}`}>{r.name}</span>
                        <span className="tabular text-muted">{r.amount}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void copy()} className="flex min-h-tap items-center gap-2 rounded-xl border border-line px-3">
              <Copy size={18} aria-hidden />{copied ? L.copied : L.copy}</button>
            {typeof navigator.share === 'function' && (
              <button type="button" onClick={() => void navigator.share({ text }).catch(() => undefined)} className="flex min-h-tap items-center gap-2 rounded-xl border border-line px-3">
                <Share2 size={18} aria-hidden />{L.share}</button>
            )}
          </div>
          <p className="text-sm text-muted">{L.hint}</p>
        </>
      )}
    </section>
  );
}
