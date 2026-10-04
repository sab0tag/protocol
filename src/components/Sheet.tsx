import { useEffect, useRef, type ReactNode } from 'react';

/** A bottom sheet on phones, a centred dialog on wider screens. Escape or a tap outside closes it. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    panel.current?.querySelector<HTMLElement>('button, input, select, textarea')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 md:items-center" onClick={onClose}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title}
        className="w-full max-w-md rounded-t-2xl bg-surface p-4 pb-safe shadow-xl md:rounded-2xl"
        onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-lg font-semibold">{title}</h2>
        {children}
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
