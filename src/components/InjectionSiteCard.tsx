// D189: «Куди був укол?» — after a prescribed injection (insulin, GLP-1) is marked, on «Сьогодні»; last time's place as a hint.
// One tap writes the place to that dose's entry; «Не зараз» hides it for this dose on this device.
import { useState } from 'react';
import { db } from '../data/db';
import { lastSite, siteAsked } from '../domain/injection';
import type { DayEntry, InjectionSite, Prescription } from '../domain/types';
import { t } from '../i18n/uk';
import { saved } from './Toast';

const L = t.injection;
const PARTS: InjectionSite['part'][] = ['belly', 'thigh', 'arm'];
const SIDES: InjectionSite['side'][] = ['left', 'right'];
const where = (s: InjectionSite) => L.place(L.parts[s.part]!, L.sides[s.side]!);

export function InjectionSiteCard({ day, all, prescriptions }: { day: DayEntry[]; all: DayEntry[]; prescriptions: Prescription[] }) {
  const [later, setLater] = useState<string[]>([]);
  const e = siteAsked(day, prescriptions).find((x) => !later.includes(x.id));
  if (!e) return null;
  const last = lastSite(all, e.prescriptionId!, e.id);
  const pick = (site: InjectionSite) => void saved(db.entries.put({ ...e, site }), L.saved);
  return (
    <section aria-label={L.ask(e.title)} className="protocol-card mb-3 space-y-2 p-3" data-testid="injection-site">
      <p className="font-medium">{L.ask(e.title)}</p>
      {last && <p className="text-sm text-muted">{L.last(where(last))}</p>}
      <div className="grid grid-cols-2 gap-2">
        {PARTS.flatMap((part) => SIDES.map((side) => (
          <button key={`${part}-${side}`} type="button" onClick={() => pick({ part, side })}
            className={`min-h-tap rounded-xl border px-2 text-sm ${last?.part === part && last.side === side ? 'border-line text-muted' : 'border-accent text-accent'}`}>
            {where({ part, side })}</button>)))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">{L.hint}</p>
        <button type="button" onClick={() => setLater((x) => [...x, e.id])} className="min-h-tap px-2 text-sm text-muted underline">{L.later}</button>
      </div>
    </section>
  );
}
