// D195: after a time zone change — «перенести час прийому?» on «Сьогодні»; nothing moves without an answer. The first time the app
// sees a zone it remembers it as home, silently.
import { useEffect } from 'react';
import { db } from '../data/db';
import { answerZone, deviceZone, zoneQuestion } from '../domain/timeZone';
import type { Plan } from '../domain/types';
import { t } from '../i18n/uk';
import { saved } from './Toast';

const L = t.zone;
const moved = (time: string, minutes: number) => { const [h, m] = time.split(':').map(Number); const x = (((h! * 60 + m! + minutes) % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
const hours = (minutes: number) => `${minutes > 0 ? '+' : '−'}${String(Math.abs(minutes) / 60).replace('.', ',')}`;

export function ZoneCard({ plan }: { plan: Plan }) {
  const here = deviceZone();
  useEffect(() => { if (!plan.zone?.home) void db.plan.update('main', { zone: { home: here } }); }, [plan.zone?.home, here]);
  const q = zoneQuestion(plan.zone, here, new Date());
  if (!q) return null;
  const first = plan.prescriptions.find((p) => (p.kind === 'medication' || p.kind === 'supplement') && p.schedule?.times.length)?.schedule?.times[0] ?? '08:00';
  const write = (answer: 'local' | 'home' | 'back' | 'keep') => void saved(db.plan.update('main', answerZone(plan, here, answer, q.minutes)), L.saved);
  const button = 'min-h-tap rounded-xl border-2 px-3 py-2 text-left';
  return (
    <section aria-label={q.kind === 'away' ? L.away(hours(q.minutes)) : L.back} className="protocol-card mb-3 space-y-2 p-3" data-testid="zone-card">
      {q.kind === 'away' ? <>
        <p className="font-medium">{L.away(hours(q.minutes))}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={() => write('local')} className={`${button} border-line`}><span className="block font-semibold">{L.local}</span><span className="block text-sm text-muted">{L.localHint(first)}</span></button>
          <button type="button" onClick={() => write('home')} className={`${button} border-accent text-accent`}><span className="block font-semibold">{L.home}</span><span className="block text-sm">{L.homeHint(first, moved(first, q.minutes))}</span></button>
        </div>
      </> : <>
        <p className="font-medium">{L.back}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => write('back')} className="min-h-tap rounded-full bg-accent px-4 font-semibold text-on-accent">{L.backYes}</button>
          <button type="button" onClick={() => write('keep')} className="min-h-tap rounded-full border-2 border-line px-4 font-semibold">{L.keep}</button>
        </div>
      </>}
      <p className="text-xs text-muted">{L.hint}</p>
    </section>
  );
}
