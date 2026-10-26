import { TreePine } from 'lucide-react';
import type { ReactNode } from 'react';

/** The same local woodland image ties the working screens to the Today header. */
export function SceneHeader({ title, description, eyebrow, children }: {
  title: string; description?: string; eyebrow?: string; children?: ReactNode;
}) {
  return <header className="protocol-scene-header relative overflow-hidden rounded-[1.75rem] p-5 text-white sm:p-6">
    <div className="relative z-10">
      <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-emerald-200"><TreePine size={16} aria-hidden />{eyebrow ?? 'Протокол'}</p>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="mt-2 max-w-md text-sm leading-relaxed text-white/80">{description}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  </header>;
}
