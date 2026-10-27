import type { ReactNode } from 'react';

/** Compact page heading; the woodland image is reserved for the Today screen. */
export function SceneHeader({ title, description, eyebrow, children }: {
  title: string; description?: string; eyebrow?: string; children?: ReactNode;
}) {
  return <header className="flex flex-col items-start gap-3 border-b border-line pb-3 sm:flex-row sm:items-end sm:pb-4">
    <div className="w-full min-w-0 flex-1 sm:w-auto">
      {eyebrow && <p className="protocol-eyebrow mb-1">{eyebrow}</p>}
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted">{description}</p>}
    </div>
    {children && <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">{children}</div>}
  </header>;
}
