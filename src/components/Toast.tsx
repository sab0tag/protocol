import { Check, TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';
import { create } from 'zustand';
import { t } from '../i18n/uk';

// D39: a small «✓ Записано» after every save — above the tab bar, by itself it goes after a few seconds;
// with «Скасувати» where a tap could have been a slip (a tick, a deletion).
interface ToastState {
  id: number;
  text: string;
  tone: 'ok' | 'warn';
  undo?: () => unknown;
}

const useToastStore = create<{ current: ToastState | null }>(() => ({ current: null }));
let seq = 0;

export function toast(text: string, opts: { undo?: () => unknown; tone?: 'ok' | 'warn' } = {}) {
  useToastStore.setState({ current: { id: ++seq, text, tone: opts.tone ?? 'ok', ...(opts.undo ? { undo: opts.undo } : {}) } });
}

/** Run a save and say so; a failure is said too (IndexedDB can refuse, e.g. a full disk). */
export async function saved<T>(work: Promise<T> | (() => Promise<T>), text: string, undo?: () => unknown): Promise<T | undefined> {
  try {
    const r = await (typeof work === 'function' ? work() : work);
    toast(text, undo ? { undo } : {});
    return r;
  } catch (e) {
    console.error(e);
    toast(t.toast.failed, { tone: 'warn' });
    return undefined;
  }
}

export function Toaster() {
  const current = useToastStore((s) => s.current);
  useEffect(() => {
    if (!current) return;
    const id = setTimeout(() => useToastStore.setState((s) => (s.current?.id === current.id ? { current: null } : s)), current.undo ? 5000 : 2500);
    return () => clearTimeout(id);
  }, [current]);
  if (!current) return null;
  const Icon = current.tone === 'ok' ? Check : TriangleAlert;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex justify-center px-4 md:bottom-6 print:hidden">
      <div key={current.id} role="status" aria-live="polite"
        className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl px-4 py-2.5 shadow-lg motion-safe:animate-[toast-in_160ms_ease-out]
          ${current.tone === 'ok' ? 'bg-ink text-bg' : 'bg-warn text-surface'}`}>
        <Icon size={18} aria-hidden className="shrink-0" />
        <span className="font-medium">{current.text}</span>
        {current.undo && (
          <button type="button" className="min-h-tap shrink-0 px-1 font-semibold underline underline-offset-2"
            onClick={() => { void current.undo?.(); useToastStore.setState({ current: null }); }}>{t.toast.undo}</button>
        )}
      </div>
    </div>
  );
}
