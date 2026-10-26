export type ProgressTone = 'accent' | 'water' | 'energy' | 'protein' | 'meds' | 'calcium' | 'carbs' | 'warn' | 'neutral';

/** A display-only meter. Text keeps the real value; the graphic and ARIA range stay bounded. */
export function ProgressTrack({ ratio, label, valueText, tone = 'accent' }: {
  ratio: number; label: string; valueText?: string; tone?: ProgressTone;
}) {
  const percent = Number.isFinite(ratio) ? Math.min(100, Math.max(0, ratio * 100)) : 0;
  return <div className={`protocol-progress-track protocol-progress-${tone}`} role="progressbar" aria-label={label}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} aria-valuetext={valueText}>
    <span className="protocol-progress-fill" style={{ width: `${percent}%` }} />
  </div>;
}
