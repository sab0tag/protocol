// D60: the exercise card — «Початок» and «Рух» side by side (the bell's path as an arrow, the start as a ghost),
// then the words: start, movement, range and direction, cues, common mistakes, and a caution where one is due.
import type { ReactNode } from 'react';
import type { Exercise } from '../data/exercises';
import { t } from '../i18n/uk';
import { ExerciseFigure } from './ExerciseFigure';
import { Sheet } from './Sheet';

const L = t.exercise;

export function LevelBadge({ level }: { level: 1 | 2 | 3 }) {
  const look = level === 1 ? 'bg-accent/10 text-accent' : level === 2 ? 'bg-water/15 text-water' : 'bg-warn-bg text-warn';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${look}`}>{L.levels[level - 1]}</span>;
}

export function ExerciseCard({ exercise: e, onClose, children }: { exercise: Exercise; onClose: () => void; children?: ReactNode }) {
  const [a, b] = e.poses;
  const arrow = e.arrow ?? (a.kb && b.kb ? { from: a.kb, to: b.kb } : { from: a.hip, to: b.hip });
  return (
    <Sheet title={e.name} onClose={onClose}>
      <p className="-mt-2 mb-3 flex flex-wrap items-center gap-2 text-sm text-muted"><LevelBadge level={e.level} />{e.target}</p>
      {e.photos ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            {([[e.photos.start, L.start], [e.photos.move, L.move]] as const).map(([src, label]) => (
              <figure key={label} className="flex flex-col items-center gap-1">
                <img src={src} alt={`${e.name}: ${label}`} loading="lazy" className="aspect-[3/4] w-full rounded-xl object-cover" />
                <figcaption className="text-sm font-medium text-muted">{label}</figcaption>
              </figure>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted"><a href={e.photos.source} target="_blank" rel="noreferrer" className="underline">{e.photos.credit}</a></p>
          <details className="mt-2 rounded-xl bg-bg p-2">
            <summary className="min-h-tap cursor-pointer py-2 text-sm text-accent">{L.scheme}</summary>
            <div className="grid grid-cols-2 gap-2">
              <ExerciseFigure pose={a} label={L.start} />
              <ExerciseFigure pose={b} ghost={a} arrow={arrow} label={L.move} />
            </div>
          </details>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-bg p-2">
          <ExerciseFigure pose={a} label={L.start} />
          <ExerciseFigure pose={b} ghost={a} arrow={arrow} label={L.move} />
        </div>
      )}
      <dl className="mt-3 space-y-2 text-sm">
        <div><dt className="font-semibold">{L.startTitle}</dt><dd>{e.start}</dd></div>
        <div><dt className="font-semibold">{L.moveTitle}</dt><dd>{e.move}</dd></div>
        <div><dt className="font-semibold">{L.pathTitle}</dt><dd>{e.path}</dd></div>
        <div><dt className="font-semibold">{L.cues}</dt><dd><ul className="list-disc pl-5">{e.cues.map((x) => <li key={x}>{x}</li>)}</ul></dd></div>
        <div><dt className="font-semibold">{L.mistakes}</dt><dd><ul className="list-disc pl-5">{e.mistakes.map((x) => <li key={x}>{x}</li>)}</ul></dd></div>
      </dl>
      {e.caution && <p className="mt-3 rounded-xl bg-warn-bg p-2 text-sm text-warn">{e.caution}</p>}
      {children && <div className="mt-3 space-y-2">{children}</div>}
    </Sheet>
  );
}
