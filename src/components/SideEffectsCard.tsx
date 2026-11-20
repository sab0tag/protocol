// D194: «Є побічні від «…»? День N з 14» — one tap «Ні», or «Так» and a word; danger words bring the 103 card (D130).
import { useState } from 'react';
import { db } from '../data/db';
import { atLocal, newId, todayISO } from '../domain/dates';
import { sideAsk, sideKey } from '../domain/sideEffects';
import { crisisInText, dangerInText } from '../domain/symptoms';
import type { DayEntry, Plan } from '../domain/types';
import { t } from '../i18n/uk';
import { CrisisCard } from './CrisisCard';
import { DangerCard } from './DangerCard';
import { saved } from './Toast';
import { format } from 'date-fns';

const L = t.side;
export function SideEffectsCard({ plan, day }: { plan: Plan; day: DayEntry[] }) {
  const today = todayISO();
  const [yes, setYes] = useState(false);
  const [text, setText] = useState('');
  const [alarm, setAlarm] = useState<'danger' | 'crisis' | null>(null);
  const ask = sideAsk(plan, day, today);
  if (alarm) return alarm === 'crisis' ? <CrisisCard className="mb-3" /> : <DangerCard className="mb-3" />;
  if (!ask) return null;
  const write = (answer: boolean, words?: string) => {
    const w = words?.trim();
    const entry: DayEntry = { id: newId(), at: atLocal(today, format(new Date(), 'HH:mm')), kind: 'note', status: 'done', title: `${ask.p.title}: побічні — ${answer ? w || 'так' : 'ні'}`,
      checkKey: sideKey(ask.p.id), side: { yes: answer, ...(w ? { text: w.slice(0, 120) } : {}) } };
    if (w && crisisInText(w)) setAlarm('crisis'); else if (w && dangerInText(w)) setAlarm('danger');
    void saved(db.entries.put(entry), L.saved);
    setYes(false); setText('');
  };
  return (
    <section aria-label={L.ask(ask.p.title, ask.day)} className="protocol-card mb-3 space-y-2 p-3" data-testid="side-effects">
      <p className="font-medium">{L.ask(ask.p.title, ask.day)}</p>
      {!yes ? <div className="flex gap-2">
        <button type="button" onClick={() => write(false)} className="min-h-tap rounded-full border-2 border-line px-4 font-semibold">{L.no}</button>
        <button type="button" onClick={() => setYes(true)} className="min-h-tap rounded-full border-2 border-accent px-4 font-semibold text-accent">{L.yes}</button>
      </div> : <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); write(true, text); }}>
        <label className="min-w-0 flex-1"><span className="sr-only">{L.which}</span>
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} maxLength={120} placeholder={L.which} className="min-h-tap w-full rounded-xl border border-line bg-bg px-3" /></label>
        <button type="submit" className="min-h-tap rounded-xl bg-accent px-3 font-semibold text-on-accent">{L.save}</button>
      </form>}
      <p className="text-xs text-muted">{L.hint}</p>
    </section>
  );
}
