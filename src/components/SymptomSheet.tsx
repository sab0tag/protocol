// «Мені погано» (SPEC.md D56): what is felt, since when, how strongly — and right below, what was eaten in the
// hours before, so the person sees it side by side. A danger sign shows «телефонуйте 103» at once, before anything
// is saved. The app records and shows; it never says what caused it.
import { format } from 'date-fns';
import { Phone, Plus, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { db } from '../data/db';
import { atLocal, newId, timeOf, todayISO } from '../domain/dates';
import { amountText } from '../domain/foodSearch';
import { BEFORE_HOURS, DANGER, eatenBefore, isDanger, SYMPTOMS } from '../domain/symptoms';
import { itemAllergens, mealAllergens } from '../domain/allergens';
import type { DayEntry, Food } from '../domain/types';
import { AllergenNote } from './AllergenPicker';
import { t } from '../i18n/uk';
import { Sheet } from './Sheet';
import { saved } from './Toast';

const L = t.symptom;
const chip = (on: boolean, danger = false) =>
  `min-h-tap rounded-full border px-3 text-sm ${on ? (danger ? 'border-warn bg-warn-bg font-medium text-warn' : 'border-accent bg-accent/10 font-medium text-accent') : 'border-line'}`;

export function SymptomSheet({ date, entry, all, foods, onClose }: { date: string; entry?: DayEntry; all: DayEntry[]; foods?: Map<string, Food>; onClose: () => void }) {
  const [picked, setPicked] = useState<string[]>(entry?.symptoms ?? []);
  const [own, setOwn] = useState('');
  const [time, setTime] = useState(entry ? timeOf(entry.at) : date === todayISO() ? format(new Date(), 'HH:mm') : '');
  const [severity, setSeverity] = useState<1 | 2 | 3 | undefined>(entry?.severity);
  const toggle = (s: string) => setPicked((xs) => (xs.includes(s) ? xs.filter((x) => x !== s) : [...xs, s]));
  const at = time ? atLocal(date, time) : undefined;
  const before = at ? eatenBefore(all.filter((e) => e.id !== entry?.id), at) : [];
  const danger = picked.some(isDanger);
  const extra = picked.filter((s) => !(SYMPTOMS as readonly string[]).includes(s) && !isDanger(s));

  const save = () => {
    if (!picked.length || !at) return;
    const { severity: _old, ...base } = entry ?? {};
    const row: DayEntry = { ...base, id: entry?.id ?? newId(), at, kind: 'symptom', status: 'done', title: picked.join(', '),
      symptoms: picked, ...(severity ? { severity } : {}) };
    onClose();
    void saved(db.entries.put(row), t.toast.symptomSaved(row.title), entry ? () => db.entries.put(entry) : () => db.entries.delete(row.id));
  };

  return (
    <Sheet title={L.title} onClose={onClose}>
      <div className="flex flex-wrap gap-2" role="group" aria-label={L.title}>
        {[...SYMPTOMS, ...extra].map((s) => <button key={s} type="button" aria-pressed={picked.includes(s)} onClick={() => toggle(s)} className={chip(picked.includes(s))}>{s}</button>)}
      </div>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); const s = own.trim(); if (s && !picked.includes(s)) setPicked([...picked, s]); setOwn(''); }}>
        <label className="flex-1"><span className="sr-only">{L.own}</span>
          <input value={own} onChange={(e) => setOwn(e.target.value)} placeholder={L.ownPh} className="block min-h-tap w-full rounded-xl border border-line bg-bg px-3" /></label>
        <button type="submit" disabled={!own.trim()} aria-label={L.addOwn} className="flex min-h-tap min-w-tap items-center justify-center rounded-xl border border-line text-accent disabled:opacity-40"><Plus size={18} aria-hidden /></button>
      </form>

      <p className="mb-1 mt-3 text-sm font-medium text-warn">{L.danger}</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label={L.danger}>
        {DANGER.map((s) => <button key={s} type="button" aria-pressed={picked.includes(s)} onClick={() => toggle(s)} className={chip(picked.includes(s), true)}>{s}</button>)}
      </div>
      {danger && (
        <div role="alert" className="mt-3 space-y-2 rounded-xl border border-warn bg-warn-bg p-3 text-warn">
          <p className="flex items-start gap-2 font-medium"><TriangleAlert size={20} className="mt-0.5 shrink-0" aria-hidden />{L.dangerAlert}</p>
          <a href="tel:103" className="flex min-h-tap items-center justify-center gap-2 rounded-xl bg-warn px-4 font-semibold text-surface"><Phone size={18} aria-hidden />{L.call}</a>
        </div>
      )}

      <div className="mt-3 grid grid-cols-[8rem_1fr] items-end gap-3">
        <label className="block"><span className="text-sm text-muted">{L.when}</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required className="mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3" /></label>
        <fieldset><legend className="text-sm text-muted">{L.severity}</legend>
          <div className="mt-1 flex flex-wrap gap-1">
            {L.levels.map((x, i) => { const n = (i + 1) as 1 | 2 | 3; return (
              <button key={x} type="button" aria-pressed={severity === n} onClick={() => setSeverity(severity === n ? undefined : n)} className={chip(severity === n)}>{x}</button>); })}
          </div></fieldset>
      </div>

      <section aria-label={L.before(BEFORE_HOURS)} className="mt-4">
        <p className="mb-1 text-sm font-medium">{L.before(BEFORE_HOURS)}</p>
        {before.length === 0 ? <p className="text-sm text-muted">{L.nothingBefore}</p> : (
          <ul className="space-y-1 text-sm">
            {before.map((m) => (
              <li key={m.id}><span className="tabular text-muted">{m.at.slice(0, 10) === date ? '' : `${m.at.slice(8, 10)}.${m.at.slice(5, 7)} `}{timeOf(m.at)}</span>{' '}
                <span className="font-medium">{m.title}</span>: {m.items?.map((x) => `${x.name} ${amountText(x)}`).join(', ')}
                {foods && m.items && <AllergenNote className="block" allergens={mealAllergens(m.items, foods)} unknown={m.items.some((x) => itemAllergens(x, foods).unknown)} />}</li>
            ))}
          </ul>
        )}
        {before.length > 0 && foods && <p className="mt-1 text-xs text-muted">{t.allergen.typical}</p>}
      </section>

      <button type="button" onClick={save} disabled={!picked.length || !at}
        className="mt-4 min-h-tap w-full rounded-xl bg-accent px-4 font-medium text-surface disabled:opacity-40">{picked.length ? L.save : L.pickSome}</button>
    </Sheet>
  );
}
