// D42: never a blank screen. iOS may drop a home-screen app's IndexedDB connection while it is in the background
// (or reload the page and then fail to open the database); the app checks the database when it comes back,
// reconnects or reloads, and says so instead of waiting for data that will not come.
import { RefreshCw } from 'lucide-react';
import { Component, useEffect, useState, type ReactNode } from 'react';
import { db } from '../data/db';
import { t } from '../i18n/uk';

const RELOADED = 'protocol.reloadedAt';

/** Read something tiny within `ms`; false if the database does not answer. */
export async function dbAlive(ms = 2500): Promise<boolean> {
  try {
    return await Promise.race([db.plan.count().then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);
  } catch { return false; }
}

/** Reconnect once; if the database still does not answer, reload the page (not more than once a minute). */
export async function heal(): Promise<boolean> {
  if (await dbAlive()) return true;
  try { db.close(); await db.open(); } catch { /* reload below */ }
  if (await dbAlive()) return true;
  let last = 0;
  try { last = Number(sessionStorage.getItem(RELOADED) ?? 0); sessionStorage.setItem(RELOADED, String(Date.now())); } catch { /* private */ }
  if (Date.now() - last > 60_000) location.reload();
  return false;
}

/** On return from the background (unlock, app switch, back/forward cache) — check the database. */
export function watchResume() {
  const check = () => { if (document.visibilityState === 'visible') void heal(); };
  document.addEventListener('visibilitychange', check);
  window.addEventListener('pageshow', (e) => { if (e.persisted) void heal(); });
  window.addEventListener('unhandledrejection', (e) => {
    const name = (e.reason as { name?: string } | undefined)?.name ?? '';
    if (/DatabaseClosed|InvalidState|UnknownError|Abort/.test(name)) void heal();
  });
}

function Panel({ text, detail }: { text: string; detail?: string }) {
  return (
    <div role="alert" className="mx-auto mt-10 max-w-sm space-y-3 rounded-2xl border border-line bg-surface p-4 text-center">
      <p>{text}</p>
      <button type="button" onClick={() => location.reload()}
        className="mx-auto flex min-h-tap items-center gap-2 rounded-xl bg-accent px-4 font-medium text-surface"><RefreshCw size={18} aria-hidden />{t.recovery.reload}</button>
      {detail && <p className="break-words text-xs text-muted">{detail}</p>}
    </div>
  );
}

/** Instead of `return null` while data loads: nothing for a moment, then «Завантажую…», then a way out. */
export function Loading() {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const a = setTimeout(() => setStage(1), 500);
    const b = setTimeout(() => { setStage(2); void heal(); }, 5000);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);
  if (stage === 0) return null;
  if (stage === 1) return <p role="status" className="mt-10 text-center text-muted">{t.recovery.loading}</p>;
  return <Panel text={t.recovery.stuck} />;
}

/** A screen that throws shows a way out instead of an empty page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(error); }
  render() {
    return this.state.error ? <Panel text={t.recovery.crashed} detail={this.state.error.message} /> : this.props.children;
  }
}

/** Before the first render: open the database within a few seconds, or show the way out. */
export function Boot({ start, children }: { start: () => Promise<void>; children: ReactNode }) {
  const [state, setState] = useState<'wait' | 'ok' | 'fail'>('wait');
  const [detail, setDetail] = useState('');
  useEffect(() => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { setState('fail'); void heal(); } }, 8000);
    start().then(() => { done = true; setState('ok'); }, (e: Error) => { done = true; setDetail(e.message); setState('fail'); void heal(); })
      .finally(() => clearTimeout(timer));
  }, [start]);
  if (state === 'ok') return <>{children}</>;
  if (state === 'fail') return <div className="px-4"><Panel text={t.recovery.stuck} detail={detail} /></div>;
  return <Loading />;
}
