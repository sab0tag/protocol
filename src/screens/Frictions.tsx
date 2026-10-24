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
import { voiceSeconds } from '../components/VoiceSheet';
import { toast } from '../components/Toast';
import { scrubNames } from '../domain/pilot';
import { consented, sendNote } from '../sync/pilot';

const L = t.friction;
const KINDS: Friction['kind'][] = ['search', 'fix', 'skip', 'other'];

export function Frictions() {
  const list = useLiveQuery(() => db.frictions.orderBy('at').reverse().toArray(), []);
  const [kind, setKind] = useState<Friction['kind']>('search');
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  const pilot = useLiveQuery(() => db.pilot.get('pilot'), []);
  const [writing, setWriting] = useState<{ id: string; text: string } | null>(null); // D121: the text that would go, as the person sees and fixes it
  const send = async () => {
    if (!writing) return;
    try { await sendNote(writing.id, writing.text); toast(t.pilot.note.sent); setWriting(null); } catch { toast(t.pilot.note.failed); }
  };
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
      {(() => { const xs = voiceSeconds(); if (!xs.length) return null; const m = [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!; /* D95: the pilot's measure */
        return <p className="text-sm">{t.voice.median(m, xs.length)}</p>; })()}
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
          {!consented(pilot) && <p className="text-xs text-muted">{t.pilot.note.onlyPilot}</p>}
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
            {list.map((f) => (
              <li key={f.id} className="px-3 py-2"><div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 text-sm">
                  <span className="text-muted">{format(parseISO(f.at), 'EEEEEE d.MM, HH:mm', { locale: uk })} · </span>
                  <span className="font-medium">{L.kinds[f.kind]}</span>{f.text && <span> — {f.text}</span>}</span>
                <button type="button" aria-label={`${L.delete}: ${L.kinds[f.kind]}`} onClick={() => void saved(db.frictions.delete(f.id), t.toast.deleted(L.kinds[f.kind]), () => db.frictions.put(f))}
                  className="flex min-h-tap min-w-tap items-center justify-center text-muted"><Trash2 size={16} aria-hidden /></button></div>
                {consented(pilot) && (pilot?.notes?.includes(f.id) ? <p className="text-xs text-muted">{t.pilot.note.sent}</p>
                  : writing?.id === f.id ? (
                    <div className="mt-1 space-y-2">
                      <label className="block"><span className="text-xs text-muted">{t.pilot.note.edit}</span>
                        <textarea value={writing.text} onChange={(e) => setWriting({ id: f.id, text: e.target.value })} maxLength={1000} rows={3}
                          className="mt-1 block w-full rounded-xl border border-line bg-bg p-2 text-sm" /></label>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => void send()} disabled={!writing.text.trim()} className="min-h-tap flex-1 rounded-xl bg-accent px-3 font-medium text-surface disabled:opacity-40">{t.pilot.note.go}</button>
                        <button type="button" onClick={() => setWriting(null)} className="min-h-tap rounded-xl border border-line px-3">{t.pilot.note.cancel}</button>
                      </div>
                    </div>
                  ) : <button type="button" onClick={() => setWriting({ id: f.id, text: scrubNames(`${L.kinds[f.kind]}${f.text ? ` — ${f.text}` : ''}`) })}
                      className="min-h-tap text-sm text-accent underline">{t.pilot.note.send}</button>)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
