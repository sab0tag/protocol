import { SceneHeader } from '../components/SceneHeader';
// D91: «Журнал помічника» — the person's own concierge log: the consent to keep it (off by default, apart from the sync's
// and the AI's), what was asked, what was offered and what was done; one tap deletes all of it.
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { NeedsSync } from '../components/NeedsSync';
import { saved } from '../components/Toast';
import { db } from '../data/db';
import { t } from '../i18n/uk';
import { conciergeLog, deleteConciergeLog, type LogRecord } from '../sync/api';
import { currentKeys } from '../sync/runner';

const L = t.conciergeLog;

export function ConciergeLog() {
  const meta = useLiveQuery(async () => (await db.meta.get('sync')) ?? null, []);
  const [rows, setRows] = useState<LogRecord[] | null>(null);
  const keys = meta ? currentKeys() : undefined;
  useEffect(() => { if (keys) void conciergeLog(keys).then(setRows).catch(() => setRows([])); }, [keys]);
  if (meta === undefined) return null;
  return (
    <section className="space-y-4 pt-6">
      <SceneHeader title={L.title} />
      <p className="text-sm text-muted">{L.hint}</p>
      {!meta || !keys ? <NeedsSync text={L.needsSync} /> : (
        <>
          <label className="protocol-toggle-row min-h-tap protocol-card rounded-2xl border border-line bg-surface p-3">
            <input type="checkbox" checked={!!meta.conciergeLog} className="protocol-switch"
              onChange={(e) => void db.meta.update('sync', { conciergeLog: e.target.checked })} />
            <span>{L.consent}</span></label>
          {rows && (rows.length ? (
            <ul className="divide-y divide-line protocol-card rounded-2xl border border-line bg-surface text-sm">
              {rows.map((r) => (
                <li key={r.id} className="px-3 py-2">
                  <p><span className="text-muted">{r.ts.slice(0, 16).replace('T', ' ')} · </span>«{r.input}»</p>
                  <p className="text-muted">→ {r.output.items.map((i) => i.name).join(', ') || '—'} · {L.outcome[r.outcome ?? 'ignored']}</p>
                </li>
              ))}
            </ul>
          ) : <p className="text-muted">{L.empty}</p>)}
          {rows && rows.length > 0 && (
            <button type="button" className="min-h-tap rounded-xl border border-warn px-3 font-medium text-warn"
              onClick={() => void saved(deleteConciergeLog(keys), L.deleted(rows.length)).then(() => setRows([]))}>{L.delete}</button>
          )}
        </>
      )}
    </section>
  );
}
