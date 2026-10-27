import type { ReactNode } from 'react';

/** Section heading with the route-specific image treatment supplied by the page shell. */
export function SceneHeader({ title, description, eyebrow, children }: {
  title: string; description?: string; eyebrow?: string; children?: ReactNode;
}) {
  return <header className="protocol-scene-header flex flex-col items-start gap-3 sm:flex-row sm:items-end">
    <div className="w-full min-w-0 flex-1 sm:w-auto">
      {eyebrow && <p className="protocol-eyebrow mb-1">{eyebrow}</p>}
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted">{description}</p>}
    </div>
    {children && <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">{children}</div>}
  </header>;
}
