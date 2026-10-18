import { format, parseISO } from 'date-fns';
import { Loading } from '../components/Recovery';
import { saved } from '../components/Toast';
import { uk } from 'date-fns/locale';
import { Check, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { db } from '../data/db';
import { useWellbeing } from '../data/queries';
import type { Wellbeing as W } from '../domain/types';
import { t } from '../i18n/uk';
import { useUi } from '../store/ui';

const L = t.well;
type Score = 1 | 2 | 3 | 4 | 5;

/** «Самопочуття» (SPEC.md §5.5): one record a day, saved on every tap — and it says so, with the time (D74). */
export function Wellbeing() {
  const { date, shift } = useUi();
  const rec = useWellbeing(date);
  const [own, setOwn] = useState('');
  const [note, setNote] = useState<{ date: string; text: string } | null>(null); // a note being typed, not yet saved
  const [savedAt, setSavedAt] = useState<{ date: string; hm: string } | null>(null);
  if (rec === undefined) return <Loading />;
  const w: W = rec ?? { date, symptoms: [] };
  const put = async (patch: Partial<W>) => {
    const ok = await saved(db.wellbeing.put({ ...w, ...patch, date }), t.toast.wellbeing);
    if (ok !== undefined) setSavedAt({ date, hm: format(new Date(), 'HH:mm') });
  };
  const typed = note?.date === date ? note.text : (w.note ?? '');
  // D97: the typed note stays until it is written — closing the app right after the tap never loses it
  const saveNote = () => { const text = typed.trim() || undefined; if (text === w.note) { setNote(null); return; } void put({ note: text }).then(() => setNote(null)); };
  const chips = [...new Set([...L.defaults, ...w.symptoms])];
  const toggle = (s: string) => put({ symptoms: w.symptoms.includes(s) ? w.symptoms.filter((x) => x !== s) : [...w.symptoms, s] });

  return (
    <section className="space-y-4 pt-4">
      <header className="flex items-center gap-2">
        <button type="button" onClick={() => shift(-1)} aria-label={t.day.prev}
          className="flex min-h-tap min-w-tap items-center justify-center rounded-xl border border-line bg-surface"><ChevronLeft size={20} /></button>
        <div className="flex-1 text-center">
          <h1 className="text-xl font-semibold">{L.title}</h1>
          <p className="text-sm text-muted first-letter:uppercase">{format(parseISO(date), 'EEEE, d MMMM', { locale: uk })}</p>
        </div>
        <button type="button" onClick={() => shift(1)} aria-label={t.day.next}
          className="flex min-h-tap min-w-tap items-center justify-center rounded-xl border border-line bg-surface"><ChevronRight size={20} /></button>
      </header>
      <p role="status" className="flex items-center justify-center gap-1 text-sm text-muted">
        {savedAt?.date === date ? <><Check size={16} className="text-accent" aria-hidden />{L.savedAt(savedAt.hm)}</> : L.autosave}</p>

      {(['energy', 'mood', 'sleep'] as const).map((key) => (
        <fieldset key={key} className="rounded-2xl border border-line bg-surface p-3">
          <legend className="sr-only">{L[key]}</legend>
          <div className="mb-2 flex justify-between"><span className="font-medium">{L[key]}</span>
            <span className="text-sm text-muted">1 — {L.scaleLow}, 5 — {L.scaleHigh}</span></div>
          <div className="grid grid-cols-5 gap-2">
            {([1, 2, 3, 4, 5] as Score[]).map((n) => (
              <button key={n} type="button" aria-pressed={w[key] === n} aria-label={`${L[key]}: ${n}`}
                onClick={() => void put({ [key]: w[key] === n ? undefined : n })}
                className={`min-h-tap rounded-xl border text-lg font-semibold ${w[key] === n ? 'border-accent bg-accent text-surface' : 'border-line'}`}>{n}</button>
            ))}
          </div>
        </fieldset>
      ))}

      <fieldset className="rounded-2xl border border-line bg-surface p-3">
        <legend className="sr-only">{L.symptoms}</legend>
        <p className="mb-2 font-medium">{L.symptoms}</p>
        <div className="flex flex-wrap gap-2">
          {chips.map((s) => (
            <button key={s} type="button" aria-pressed={w.symptoms.includes(s)} onClick={() => void toggle(s)}
              className={`min-h-tap rounded-full border px-3 ${w.symptoms.includes(s) ? 'border-warn bg-warn-bg text-warn' : 'border-line'}`}>{s}</button>
          ))}
        </div>
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); const s = own.trim(); if (s && !w.symptoms.includes(s)) void put({ symptoms: [...w.symptoms, s] }); setOwn(''); }}>
          <label className="flex-1"><span className="sr-only">{L.own}</span>
            <input value={own} onChange={(e) => setOwn(e.target.value)} placeholder={L.own} className="block min-h-tap w-full rounded-xl border border-line bg-bg px-3" /></label>
          <button type="submit" className="flex min-h-tap items-center gap-1 rounded-xl border border-accent px-3 text-accent"><Plus size={18} />{L.add}</button>
        </form>
      </fieldset>

      <div className="rounded-2xl border border-line bg-surface p-3">
        <label className="block"><span className="font-medium">{L.note}</span>
          <textarea value={typed} rows={3} onChange={(e) => setNote({ date, text: e.target.value })} onBlur={saveNote}
            className="mt-2 block w-full rounded-xl border border-line bg-bg p-3" /></label>
        {typed.trim() !== (w.note ?? '') && (
          <button type="button" onPointerDown={(e) => e.preventDefault()} onClick={saveNote} className="mt-2 min-h-tap rounded-xl bg-accent px-3 font-medium text-surface">{L.saveNote}</button>
        )}
      </div>
    </section>
  );
}
