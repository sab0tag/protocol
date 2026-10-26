import { useId, type ReactNode } from 'react';
import type { ProgressTone } from './ProgressTrack';

const R = 29, C = 2 * Math.PI * R;

/** The value stays literal; only the painted arc is capped. Unknown targets have no completion arc. */
export function ProgressRing({ ratio, tone, label, valueText, children, decorative = false, className = '' }: {
  ratio?: number; tone: ProgressTone; label: string; valueText: string; children: ReactNode; decorative?: boolean; className?: string;
}) {
  const gradient = `meter-${useId().replaceAll(':', '')}`;
  const known = ratio != null && Number.isFinite(ratio);
  const progress = known ? Math.min(1, Math.max(0, ratio)) : 0;
  const accessible = known && !decorative;
  return <span className={`protocol-ring protocol-progress-${tone} ${className}`} role={accessible ? 'progressbar' : undefined}
    aria-label={accessible ? label : undefined} aria-valuemin={accessible ? 0 : undefined} aria-valuemax={accessible ? 100 : undefined}
    aria-valuenow={accessible ? Math.round(progress * 100) : undefined} aria-valuetext={accessible ? valueText : undefined}
    aria-hidden={!accessible ? true : undefined}>
    <svg viewBox="0 0 72 72" className="pointer-events-none absolute inset-0 -rotate-90" aria-hidden>
      <defs><linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" className="protocol-meter-start" /><stop offset="100%" className="protocol-meter-end" />
      </linearGradient></defs>
      {known && <circle cx="36" cy="36" r={R} fill="none" strokeWidth="6" className="stroke-line" />}
      {progress > 0 && <circle cx="36" cy="36" r={R} fill="none" strokeWidth="6" strokeLinecap="round"
        stroke={`url(#${gradient})`} strokeDasharray={C} strokeDashoffset={C * (1 - progress)} />}
    </svg>
    {children}
  </span>;
}
