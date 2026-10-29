// D60: the library list — search (D153) and filter by level, each row with its «Рух» figure; a tap opens the card. Used as a screen
// («Ще → Вправи з гирею») and inside «Тренування» to add or replace an exercise (`action` on the card).
import { useState } from 'react';
import { EXERCISES, type Exercise, type Level } from '../data/exercises';
import { searchExercises } from '../domain/exerciseSearch';
import { t } from '../i18n/uk';
import { ExerciseCard, LevelBadge } from './ExerciseCard';
import { ExerciseFigure } from './ExerciseFigure';

const L = t.exercise;

export function ExerciseLibrary({ list = EXERCISES, action }: { list?: Exercise[]; action?: { label: string; run: (e: Exercise) => void } }) {
  const [level, setLevel] = useState<Level | 0>(0);
  const [open, setOpen] = useState<Exercise | null>(null);
  const [query, setQuery] = useState('');
  const shown = searchExercises(list, query).filter((e) => !level || e.level === level);
  return (
    <div className="space-y-3">
      <label className="block"><span className="sr-only">{L.search}</span>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={L.searchHint} aria-label={L.search}
          aria-describedby={query.trim() ? 'exercise-found' : undefined} className="block min-h-tap w-full rounded-xl border border-line bg-bg px-3" /></label>
      {query.trim() && <p id="exercise-found" role="status" className="text-sm text-muted">{L.found(shown.length)}</p>}
      <div className="flex flex-wrap gap-2" role="group" aria-label={L.levels.join(', ')}>
        {([0, 1, 2, 3] as const).map((l) => (
          <button key={l} type="button" aria-pressed={level === l} onClick={() => setLevel(l)}
            className={`min-h-tap rounded-full border px-3 text-sm ${level === l ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-line'}`}>
            {l ? L.levels[l - 1] : L.all}</button>
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {shown.map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => setOpen(e)} className="flex h-full w-full flex-col items-stretch gap-1 protocol-card rounded-2xl border border-line bg-surface p-2 text-left">
              <div className="pointer-events-none">{e.photos
                ? <img src={e.photos.move} alt="" loading="lazy" className="aspect-[100/126] w-full rounded-xl object-cover" />
                : <ExerciseFigure pose={e.poses[1]} ghost={e.poses[0]} label="" />}</div>
              <span className="font-medium leading-tight">{e.name}</span>
              <span className="flex flex-wrap items-center gap-1 text-xs text-muted"><LevelBadge level={e.level} />{e.target}</span>
            </button>
          </li>
        ))}
      </ul>
      {!shown.length && <div className="space-y-2 text-sm"><p>{L.none}</p>
        <button type="button" onClick={() => { setQuery(''); setLevel(0); }} className="min-h-tap rounded-xl border border-line px-3">{L.reset}</button></div>}
      <p className="text-xs text-muted">{L.schematic}</p>
      {open && (
        <ExerciseCard exercise={open} onClose={() => setOpen(null)}>
          {action && <button type="button" onClick={() => { action.run(open); setOpen(null); }}
            className="min-h-tap w-full rounded-xl bg-accent px-4 font-medium text-surface">{action.label}</button>}
        </ExerciseCard>
      )}
    </div>
  );
}
