import type { ReactNode } from 'react';

/** Compact page heading; the woodland image is reserved for the Today screen. */
export function SceneHeader({ title, description, eyebrow, children }: {
  title: string; description?: string; eyebrow?: string; children?: ReactNode;
}) {
  return <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3 sm:pb-4">
    <div className="min-w-0 flex-1">
      {eyebrow && <p className="protocol-eyebrow mb-1">{eyebrow}</p>}
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted">{description}</p>}
    </div>
    {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
  </header>;
}
