import { format } from 'date-fns';
import { Loading } from '../components/Recovery';
import { Copy, RefreshCw, Share2 } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import qrcode from 'qrcode-generator';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../data/db';
import { t } from '../i18n/uk';
import { ApiError } from '../sync/api';
import { newCode, parseCode, parsePairCode } from '../sync/crypto';
import { useUi } from '../store/ui';
import { codeFromPairing, disableSync, enableSync, offerPairing, requestSync, useSync } from '../sync/runner';
import { saved } from '../components/Toast';

const L = t.sync;
const field = 'mt-1 block min-h-tap w-full rounded-xl border border-line bg-bg px-3 font-mono uppercase tracking-wider';
const errorText = (e: unknown) => {
  const code = e instanceof ApiError ? (e.status === 0 ? 'offline' : e.code) : 'other';
  return (L.errors as Record<string, string>)[code] ?? L.errors.other;
};

/** «Синхронізація» (SPEC.md D31): turn on with a new code, join with a code from another device, see the state. */
export function Sync() {
  const meta = useLiveQuery(async () => (await db.meta.get('sync')) ?? null, []);
  if (meta === undefined) return <Loading />;
  return (
    <section className="space-y-4 pt-6">
      <h1 className="text-2xl font-semibold">{L.title}</h1>
      {meta ? <On code={meta.code} photo={!!meta.photoConsent} /> : <Off />}
    </section>
  );
}

function Off() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const linked = params.get('pair') ?? ''; // D40: the QR of another device
  const raw = params.get('back') ?? ''; // D74: where sync was asked for (the menu, with its wish) — back there once on
  const back = raw.startsWith('/') && !raw.startsWith('//') ? raw : '';
  const [mode, setMode] = useState<'none' | 'new' | 'join'>(linked ? 'join' : 'none');
  const [code, setCode] = useState(linked);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async (c: string, how: 'create' | 'join') => {
    setBusy(true); setError('');
    try {
      if (how === 'join' && !parseCode(c)) c = await codeFromPairing(c); // the short one-time code (D40)
      await enableSync(c, how);
      if (how === 'join') { // the plan and the days have arrived
        if ((await db.plan.get('main'))?.onboardedAt) useUi.getState().setOnboarded();
        navigate(back || '/', { replace: true });
      } else if (back) navigate(back, { replace: true });
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-surface p-3">
      <p>{L.text}</p>
      {mode === 'none' && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => { setCode(newCode()); setMode('new'); }}
            className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface">{L.start}</button>
          <button type="button" onClick={() => { setCode(''); setMode('join'); }}
            className="min-h-tap rounded-xl border border-accent px-3 font-medium text-accent">{L.haveCode}</button>
        </div>
      )}
      {mode === 'new' && (
        <div className="space-y-2">
          <p className="text-sm text-muted">{L.yourCode}</p>
          <CodeBox code={code} />
          <p className="rounded-xl bg-warn-bg p-2 text-sm text-warn">{L.codeWarn}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void go(code, 'create')}
              className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface disabled:opacity-40">{L.confirmStart}</button>
            <button type="button" onClick={() => setMode('none')} className="min-h-tap rounded-xl border border-line px-3">{L.cancel}</button>
          </div>
        </div>
      )}
      {mode === 'join' && (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void go(code, 'join'); }}>
          <label className="block"><span className="text-sm text-muted">{L.enterCode}</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false}
              placeholder="XXXX-XXXX" className={field} /></label>
          <p className="text-sm text-muted">{L.enterHint}</p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || !(parseCode(code) || parsePairCode(code))}
              className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface disabled:opacity-40">{L.join}</button>
            <button type="button" onClick={() => setMode('none')} className="min-h-tap rounded-xl border border-line px-3">{L.cancel}</button>
          </div>
        </form>
      )}
      {busy && <p role="status" className="text-sm text-muted">{L.status.syncing}</p>}
      {error && <p role="alert" className="text-sm text-warn">{error}</p>}
    </div>
  );
}

function CodeBox({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* select by hand */ }
  };
  return (
    <div className="space-y-2">
      <p className="select-all rounded-xl border border-line bg-bg p-3 text-center font-mono text-lg tracking-wider">
        {code.split('-').map((g, i) => <span key={i} className="inline-block">{i > 0 && '-'}{g}</span>)}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void copy()} className="flex min-h-tap items-center gap-2 rounded-xl border border-line px-3">
          <Copy size={18} aria-hidden />{copied ? L.copied : L.copy}</button>
        {typeof navigator.share === 'function' && (
          <button type="button" onClick={() => void navigator.share({ text: code }).catch(() => undefined)}
            className="flex min-h-tap items-center gap-2 rounded-xl border border-line px-3"><Share2 size={18} aria-hidden />{L.share}</button>
        )}
      </div>
    </div>
  );
}

/** D40: «Підключити ще пристрій» — a short code for 10 minutes and its QR. */
function Pairing() {
  const [pair, setPair] = useState<{ code: string; until: number } | null>(null);
  const [error, setError] = useState('');
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!pair) return;
    const tick = () => { const s = Math.max(0, Math.round((pair.until - Date.now()) / 1000)); setLeft(s); if (!s) setPair(null); };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [pair]);
  const start = async () => {
    setError('');
    try { setPair({ code: await offerPairing(), until: Date.now() + 10 * 60_000 }); } catch (e) { setError(errorText(e)); }
  };
  const link = pair ? `${location.origin}${location.pathname}#/sync?pair=${pair.code.replace('-', '')}` : '';
  const svg = (() => { if (!link) return ''; const q = qrcode(0, 'M'); q.addData(link); q.make(); return q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }); })();
  return (
    <div className="space-y-3 rounded-2xl border border-line bg-surface p-3">
      <h2 className="font-semibold">{L.pairTitle}</h2>
      {!pair ? (
        <>
          <p className="text-sm text-muted">{L.pairText}</p>
          <button type="button" onClick={() => void start()} className="min-h-tap rounded-xl bg-accent px-3 font-medium text-surface">{L.pairStart}</button>
        </>
      ) : (
        <>
          <p className="select-all text-center font-mono text-4xl font-semibold tracking-widest">{pair.code}</p>
          <p className="text-center text-sm text-muted">{L.pairLeft(`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`)}</p>
          <p className="text-sm">{L.pairHow}</p>
          {/* the QR is drawn by qrcode-generator from our own link — no user input inside */}
          <div className="mx-auto w-48 rounded-xl bg-white p-2 [&>svg]:h-auto [&>svg]:w-full" aria-label={L.pairQr} role="img" dangerouslySetInnerHTML={{ __html: svg }} />
          <p className="text-xs text-muted">{L.pairIphone}</p>
        </>
      )}
      {error && <p role="alert" className="text-sm text-warn">{error}</p>}
    </div>
  );
}

function On({ code, photo }: { code: string; photo: boolean }) {
  const { status, lastAt, error } = useSync();
  const [show, setShow] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const bad = status === 'error' && error ? (L.errors as Record<string, string>)[error] ?? error : '';
  return (
    <>
      <div className="space-y-3 rounded-2xl border border-line bg-surface p-3">
        <p className="font-medium">{L.status[status]}</p>
        {lastAt && <p className="text-sm text-muted">{L.last(format(lastAt, 'dd.MM HH:mm'))}</p>}
        {bad && <p role="alert" className="text-sm text-warn">{bad}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => requestSync()} disabled={status === 'syncing'}
            className="flex min-h-tap items-center gap-2 rounded-xl bg-accent px-3 font-medium text-surface disabled:opacity-40">
            <RefreshCw size={18} aria-hidden />{L.now}</button>
          <button type="button" onClick={() => setShow((v) => !v)} className="min-h-tap rounded-xl border border-line px-3">{show ? L.hideCode : L.showCode}</button>
        </div>
        {show && <><CodeBox code={code} /><p className="text-sm text-muted">{L.codeWarn}</p>
          <button type="button" onClick={() => void saved(db.meta.update('sync', { codeCheckedAt: Date.now() }), L.codeKept)}
            className="min-h-tap rounded-xl border border-line px-3">{L.codeKeptBtn}</button></>}
      </div>

      <Pairing />

      <div className="space-y-2 rounded-2xl border border-line bg-surface p-3">
        <h2 className="font-semibold">{L.photoTitle}</h2>
        <p className="text-sm text-muted">{t.meal.photoConsent}</p>
        <label className="flex min-h-tap items-center gap-3">
          <input type="checkbox" checked={photo} onChange={(e) => void db.meta.update('sync', { photoConsent: e.target.checked })}
            className="h-5 w-5 accent-[rgb(var(--accent))]" />
          <span>{L.photoOn}</span>
        </label>
      </div>

      {confirm ? (
        <div role="alertdialog" aria-label={L.off} className="rounded-xl border border-warn/40 bg-warn-bg p-3">
          <p className="mb-2 text-warn">{L.offConfirm}</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => void disableSync()} className="min-h-tap rounded-xl bg-warn px-3 font-medium text-surface">{L.offYes}</button>
            <button type="button" onClick={() => setConfirm(false)} className="min-h-tap rounded-xl border border-line bg-surface px-3">{L.cancel}</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirm(true)} className="min-h-tap text-warn underline">{L.off}</button>
      )}
    </>
  );
}
