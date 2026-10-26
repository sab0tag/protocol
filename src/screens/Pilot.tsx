// «Ще → Пілот» (D119): take part or not, the doctor's code, the weeks sent — each as it went — and «Видалити надіслане».
import { format, parseISO } from 'date-fns';
import { uk } from 'date-fns/locale';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { PilotConsent, SummaryView } from '../components/PilotConsent';
import { toast } from '../components/Toast';
import { db, inDemo } from '../data/db';
import type { Summary } from '../domain/pilot';
import { consented, leave, setSource, turnOff } from '../sync/pilot';
import { t } from '../i18n/uk';

const L = t.pilot;

export function Pilot() {
  const m = useLiveQuery(async () => (await db.pilot.get('pilot')) ?? { key: 'pilot' as const }, []);
  const [asking, setAsking] = useState(false);
  const [erasing, setErasing] = useState(false);
  if (inDemo()) return <section className="pt-6"><h1 className="mb-3 text-2xl font-semibold">{L.title}</h1><p className="text-sm text-muted">{L.demo}</p></section>;
  if (!m) return null;
  const on = consented(m);
  const sent = Object.values(m.sent ?? {}) as Summary[];
  const erase = async () => {
    try { await leave(); toast(L.erased); } catch { toast(L.eraseFailed); }
    setErasing(false);
  };
  return (
    <section className="space-y-4 pt-6">
      <h1 className="text-2xl font-semibold">{L.title}</h1>
      <p className="text-sm">{on && m.consent ? L.on(format(parseISO(m.consent.at), 'd MMMM yyyy', { locale: uk })) : L.off}</p>
      {!on && (asking ? <PilotConsent onDone={() => setAsking(false)} />
        : <button type="button" onClick={() => setAsking(true)} className="min-h-tap w-full rounded-xl bg-accent px-4 font-medium text-surface">{L.join}</button>)}
      {on && <button type="button" onClick={() => void turnOff().then(() => toast(L.stopped))} className="min-h-tap w-full rounded-xl border border-line px-4">{L.stop}</button>}
      <SourceField current={m.src} />
      <section aria-label={L.sent} className="space-y-2">
        <h2 className="font-semibold">{L.sent}</h2>
        {sent.length ? [...sent].sort((a, b) => b.week.localeCompare(a.week)).map((s) => (
          <div key={s.week} className="protocol-card rounded-2xl border border-line bg-surface p-3" data-week={s.week}><SummaryView s={s} /></div>
        )) : <p className="text-sm text-muted">{L.nothingSent}</p>}
      </section>
      {(m.pid || sent.length > 0) && (erasing ? (
        <div role="alertdialog" aria-label={L.erase} className="space-y-2 rounded-2xl border border-warn bg-surface p-3 text-sm">
          <p>{L.eraseAsk}</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => void erase()} className="min-h-tap flex-1 rounded-xl bg-warn px-3 font-medium text-surface">{L.eraseYes}</button>
            <button type="button" onClick={() => setErasing(false)} className="min-h-tap flex-1 rounded-xl border border-line px-3">{t.example.confirmNo}</button>
          </div>
        </div>
      ) : <button type="button" onClick={() => setErasing(true)} className="min-h-tap text-warn underline">{L.erase}</button>)}
    </section>
  );
}

/** «Код від лікаря» — checked on the server, kept only when known; the person may go on without it. */
export function SourceField({ current, onKnown }: { current?: string; onKnown?: () => void }) {
  const [code, setCode] = useState(current ?? '');
  const [state, setState] = useState<'known' | 'unknown' | 'offline' | 'busy' | null>(current ? 'known' : null);
  const check = async () => {
    setState('busy');
    const r = await setSource(code);
    setState(r);
    if (r === 'known') onKnown?.();
  };
  return (
    <div className="space-y-1">
      <label className="block"><span className="text-sm text-muted">{L.code}</span>
        <span className="mt-1 flex gap-2">
          <input value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setState(null); }} placeholder={L.codePh} autoCapitalize="characters"
            className="block min-h-tap w-full rounded-xl border border-line bg-bg px-3" />
          <button type="button" onClick={() => void check()} disabled={!code.trim() || state === 'busy'}
            className="min-h-tap shrink-0 rounded-xl border border-accent px-3 text-accent disabled:opacity-40">{L.check}</button>
        </span></label>
      {state === 'known' && <p role="status" className="text-sm text-accent">{L.codeOk(code.trim())}</p>}
      {state === 'unknown' && <p role="status" className="text-sm text-warn">{L.codeUnknown}</p>}
      {state === 'offline' && <p role="status" className="text-sm text-muted">{L.codeOffline}</p>}
      <p className="text-xs text-muted">{L.codeNote}</p>
    </div>
  );
}
