import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { t } from '../i18n/uk';

/** A bottom sheet on phones, a centred dialog on wider screens. Escape, a tap outside or the visible × closes it (D74). */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    panel.current?.querySelector<HTMLElement>('[data-body] :is(button:not(summary *), input, select, textarea)')?.focus({ preventScroll: true });
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 md:items-center" onClick={onClose}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title}
        className="max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-4 pb-safe shadow-xl md:rounded-2xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start gap-2">
          <h2 className="flex-1 pt-2 text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t.rowActions.close}
            className="-mr-2 -mt-1 flex min-h-tap min-w-tap shrink-0 items-center justify-center rounded-xl text-muted hover:bg-bg"><X size={22} aria-hidden /></button>
        </div>
        <div data-body>{children}</div>
      </div>
    </div>
  );
}

export function SheetButton({ children, onClick, tone = 'default' }: {
  children: ReactNode; onClick: () => void; tone?: 'default' | 'accent' | 'danger';
}) {
  const color = tone === 'accent' ? 'text-accent' : tone === 'danger' ? 'text-warn' : 'text-ink';
  return (
    <button type="button" onClick={onClick}
      className={`flex min-h-tap w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-bg ${color}`}>
      {children}
    </button>
  );
}
