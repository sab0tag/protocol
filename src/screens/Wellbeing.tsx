import { format, parseISO } from 'date-fns';
import { Loading } from '../components/Recovery';
import { saved } from '../components/Toast';
import { uk } from 'date-fns/locale';
import { Check, ChevronLeft, ChevronRight, Moon, Plus, Smile, Zap } from 'lucide-react';
import { useState } from 'react';
import { db } from '../data/db';
import { useWellbeing } from '../data/queries';
import type { Wellbeing as W } from '../domain/types';
import { t } from '../i18n/uk';
import { useUi } from '../store/ui';
import { Link } from 'react-router-dom';

const L = t.well;
type Score = 1 | 2 | 3 | 4 | 5;
const scoreIcons = { energy: Zap, mood: Smile, sleep: Moon };
const scoreWords: Record<'energy' | 'mood' | 'sleep', readonly [string, string, string, string, string]> = {
  energy: ['Без сил', 'Мало сил', 'Звично', 'Є сили', 'Багато сил'],
  mood: ['Дуже важко', 'Нелегко', 'Спокійно', 'Добре', 'Чудово'],
  sleep: ['Не відпочив', 'Погано', 'Посередньо', 'Добре', 'Відновився'],
};

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
      <header className="protocol-scene-header flex items-center gap-2">
        <button type="button" onClick={() => shift(-1)} aria-label={t.day.prev}
          className="flex min-h-tap min-w-tap items-center justify-center rounded-xl border border-line text-muted"><ChevronLeft size={20} /></button>
        <div className="flex-1 text-center">
          <h1 className="text-xl font-semibold">{L.title}</h1>
          <p className="mt-1 text-sm text-muted first-letter:uppercase">{format(parseISO(date), 'EEEE, d MMMM', { locale: uk })}</p>
        </div>
        <button type="button" onClick={() => shift(1)} aria-label={t.day.next}
          className="flex min-h-tap min-w-tap items-center justify-center rounded-xl border border-line text-muted"><ChevronRight size={20} /></button>
      </header>
      <p role="status" className="flex items-center justify-center gap-1 text-sm text-muted">
        {savedAt?.date === date ? <><Check size={16} className="text-accent" aria-hidden />{L.savedAt(savedAt.hm)}</> : L.autosave}</p>
      <Link to="/wellbeing/journal" className="flex min-h-tap items-center justify-between rounded-xl border border-line bg-surface px-3 font-medium">
        <span>{L.journal}</span><span aria-hidden className="text-muted">›</span>
      </Link>

      <div className="protocol-card space-y-2 p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-accent">Коротка відмітка</p>
        <h2 className="text-2xl font-semibold tracking-tight">Як ви сьогодні?</h2>
        <p className="text-sm text-muted">Оберіть те, що найближче до вашого стану. Кожна відповідь зберігається одразу; можна змінити її пізніше.</p>
      </div>
      {(['energy', 'mood', 'sleep'] as const).map((key) => { const Icon = scoreIcons[key]; return (
        <fieldset key={key} className="protocol-card rounded-2xl border border-line bg-surface p-5">
          <legend className="sr-only">{L[key]}</legend>
          <div className="mb-3 flex items-center gap-2"><Icon size={19} className="text-accent" aria-hidden /><span className="font-semibold">{L[key]}</span><span className="ml-auto text-sm font-medium text-accent" aria-live="polite">{w[key] ? scoreWords[key][w[key] - 1] : 'Не обрано'}</span></div>
          <div className="grid grid-cols-5 gap-1.5 rounded-2xl bg-bg p-1.5">
            {([1, 2, 3, 4, 5] as Score[]).map((n) => (
              <button key={n} type="button" aria-pressed={w[key] === n} aria-label={`${L[key]}: ${n} — ${scoreWords[key][n - 1]}`}
                onClick={() => void put({ [key]: w[key] === n ? undefined : n })}
                className={`min-h-tap rounded-xl border text-base font-semibold transition-colors ${w[key] === n ? 'border-accent bg-accent text-surface shadow-sm' : 'border-transparent text-muted hover:bg-surface'}`}>{n}</button>
            ))}
          </div>
          <p className="mt-2 flex justify-between gap-2 text-xs text-muted"><span>{scoreWords[key][0]}</span><span>{scoreWords[key][4]}</span></p>
        </fieldset>
      ); })}

      <fieldset className="protocol-card rounded-2xl border border-line bg-surface p-5">
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

      <div className="protocol-card rounded-2xl border border-line bg-surface p-5">
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
