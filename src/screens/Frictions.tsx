// «Що заважало» (D67): for the week of trying the app on oneself — one tap for what got in the way, a line of words if
// wanted; the list, newest first, and «Скопіювати все» to send it on. These are notes about the app, not health data.
import { format, parseISO } from 'date-fns';
import { uk } from 'date-fns/locale';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Copy, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { saved } from '../components/Toast';
import { db } from '../data/db';
import { atLocal, newId, todayISO } from '../domain/dates';
import type { Friction } from '../domain/types';
import { t } from '../i18n/uk';

const L = t.friction;
const KINDS: Friction['kind'][] = ['search', 'fix', 'skip', 'other'];

export function Frictions() {
  const list = useLiveQuery(() => db.frictions.orderBy('at').reverse().toArray(), []);
  const [kind, setKind] = useState<Friction['kind']>('search');
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  const add = async () => {
    const f: Friction = { id: newId(), at: atLocal(todayISO(), format(new Date(), 'HH:mm')), kind, text: text.trim() };
    await saved(db.frictions.put(f), L.saved, () => db.frictions.delete(f.id));
    setText('');
  };
  const asText = (xs: Friction[]) => xs.map((f) => `${format(parseISO(f.at), 'dd.MM HH:mm')} · ${L.kinds[f.kind]}${f.text ? ` — ${f.text}` : ''}`).join('\n');

  return (
    <section className="space-y-4 pt-4">
      <h1 className="text-2xl font-semibold">{L.title}</h1>
      <p className="text-sm text-muted">{L.hint}</p>
      <form className="space-y-3 rounded-2xl border border-line bg-surface p-3" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <div className="flex flex-wrap gap-2" role="group" aria-label={L.what}>
          {KINDS.map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
              className={`min-h-tap rounded-full border px-3 text-sm ${kind === k ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-line'}`}>{L.kinds[k]}</button>
          ))}
        </div>
        <label className="block"><span className="text-sm text-muted">{L.words}</span>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={L.wordsPh} maxLength={300}
            className="mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3" /></label>
        <button type="submit" className="min-h-tap w-full rounded-xl bg-accent px-4 font-medium text-surface">{L.save}</button>
      </form>

      {list && list.length > 0 && (
        <section aria-label={L.list} className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{L.list} · {list.length}</h2>
            <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(asText(list)); setCopied(true); } catch { setCopied(false); } }}
              className="flex min-h-tap items-center gap-1 px-1 text-sm text-accent">{copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}{L.copy}</button>
          </div>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
            {list.map((f) => (
              <li key={f.id} className="flex items-start gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 text-sm">
                  <span className="text-muted">{format(parseISO(f.at), 'EEEEEE d.MM, HH:mm', { locale: uk })} · </span>
                  <span className="font-medium">{L.kinds[f.kind]}</span>{f.text && <span> — {f.text}</span>}</span>
                <button type="button" aria-label={`${L.delete}: ${L.kinds[f.kind]}`} onClick={() => void saved(db.frictions.delete(f.id), t.toast.deleted(L.kinds[f.kind]), () => db.frictions.put(f))}
                  className="flex min-h-tap min-w-tap items-center justify-center text-muted"><Trash2 size={16} aria-hidden /></button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
