// D60: a schematic figure of one pose — head, body, the near arm and leg (and the far ones when they are apart),
// the bell, the ground; on «Рух» the start pose stays as a faint ghost and an arrow shows the bell's path.
import { useId } from 'react';
import type { P, Pose } from '../data/exercises';

const line = (a: P, b: P) => `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`;
const body = (p: Pose) => [
  line(p.sh, p.hip), line(p.hip, p.knee), line(p.knee, p.ankle), line(p.sh, p.elbow), line(p.elbow, p.hand), line(p.head, p.sh),
  ...(p.knee2 && p.ankle2 ? [line(p.hip, p.knee2), line(p.knee2, p.ankle2)] : []),
  ...(p.elbow2 && p.hand2 ? [line(p.sh, p.elbow2), line(p.elbow2, p.hand2)] : []),
].join(' ');

function Figure({ pose, ghost }: { pose: Pose; ghost?: boolean }) {
  const tone = ghost ? 'stroke-muted/30' : 'stroke-ink';
  return (
    <g>
      <path d={body(pose)} className={tone} strokeWidth={ghost ? 2 : 3.2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx={pose.head[0]} cy={pose.head[1]} r={5.5} className={ghost ? 'fill-muted/20' : 'fill-ink'} />
      {pose.kb && (
        <g className={ghost ? 'opacity-25' : ''}>
          <path d={line(pose.hand, pose.kb)} className="stroke-accent" strokeWidth={2} />
          <circle cx={pose.kb[0]} cy={pose.kb[1]} r={4.8} className="fill-accent" />
        </g>
      )}
    </g>
  );
}

export function ExerciseFigure({ pose, ghost, arrow, label }: {
  pose: Pose; ghost?: Pose; arrow?: { from: P; to: P; via?: P }; label: string;
}) {
  const id = useId().replace(/:/g, '');
  const path = arrow && (arrow.via ? `M${arrow.from[0]} ${arrow.from[1]}Q${arrow.via[0]} ${arrow.via[1]} ${arrow.to[0]} ${arrow.to[1]}` : line(arrow.from, arrow.to));
  return (
    <figure className="flex flex-col items-center">
      <svg viewBox="0 -4 100 126" className="h-auto w-full max-w-[11rem]" role="img" aria-label={label}>
        <defs>
          <marker id={`arrow${id}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className="fill-warn" />
          </marker>
        </defs>
        <line x1="4" y1="115" x2="96" y2="115" className="stroke-line" strokeWidth={2} />
        {ghost && <Figure pose={ghost} ghost />}
        <Figure pose={pose} />
        {path && <path d={path} className="stroke-warn" strokeWidth={2} strokeDasharray="4 3" fill="none" markerEnd={`url(#arrow${id})`} />}
      </svg>
      <figcaption className="text-sm font-medium text-muted">{label}</figcaption>
    </figure>
  );
}
