// D179 (task 7, step 5): the rehabilitation complex (ЛФК). The app only reminds and records; the load is changed by the
// doctor alone: it never makes up exercises, never adds sets or weight, never moves to the next stage by itself — the
// date only brings the question «Лікар дозволив перейти до етапу N?», and only «Так» moves. Pure.
import { newId } from './dates';
import type { DayEntry, ISODate, Plan, RehabComplex, RehabExercise, RehabStage } from './types';

/**
 * The complex as text, one way for the manual form, the clinic cabinet and a photo's draft:
 *   Етап 1: без опори
 *   Згинання стопи | 3 × 10 | повільно
 *   Етап 2 з 10.12.2026: часткова опора
 *   Напруження чотириголового м'яза | 10 × 5 с
 * A line «Етап …» starts a stage (a date after «з» is when the doctor planned it); any other line is an exercise —
 * name | dose | note (the dose and the note may be left out). Without any «Етап» line it is one stage.
 */
const STAGE = /^\s*етап(?![\p{L}])\s*(\d+)?\s*(?:з\s+(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?|з\s+(\d{4}-\d{2}-\d{2}))?\s*[:.—-]?\s*(.*)$/iu;
export function readRehab(text: string, year = new Date().getFullYear()): RehabStage[] {
  const stages: RehabStage[] = [];
  let current: RehabStage | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = STAGE.exec(line);
    if (m) {
      const from = m[5] ?? (m[2] ? `${m[4] ?? year}-${m[3]!.padStart(2, '0')}-${m[2].padStart(2, '0')}` : undefined);
      const title = m[6]!.trim() || `Етап ${m[1] ?? stages.length + 1}`;
      current = { id: newId(), title: m[1] && m[6]!.trim() ? `Етап ${m[1]}: ${m[6]!.trim()}` : title, ...(from ? { from } : {}), exercises: [] };
      stages.push(current);
      continue;
    }
    if (!current) { current = { id: newId(), title: 'Етап 1', exercises: [] }; stages.push(current); }
    const [name, dose, ...note] = line.split('|').map((x) => x.trim());
    if (!name) continue;
    current.exercises.push({ id: newId(), name: name.slice(0, 200), ...(dose ? { dose: dose.slice(0, 80) } : {}), ...(note.join(' | ') ? { note: note.join(' | ').slice(0, 500) } : {}) });
  }
  return stages.filter((s) => s.exercises.length);
}

const dmY = (d: ISODate) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
/** The complex back as the same text, for editing. */
export function rehabText(stages: RehabStage[]): string {
  return stages.map((s, i) => [`Етап ${i + 1}${s.from ? ` з ${dmY(s.from)}` : ''}: ${s.title.replace(/^Етап \d+:\s*/u, '')}`,
    ...s.exercises.map((e: RehabExercise) => [e.name, e.dose ?? '', e.note ?? ''].join(' | ').replace(/(\s\|\s)+$/u, ''))].join('\n')).join('\n');
}

export const hasRehab = (plan: Pick<Plan, 'rehab'> | undefined): boolean => !!plan?.rehab?.stages.length;
export const currentStage = (c: RehabComplex): RehabStage => c.stages.find((s) => s.id === c.stageId) ?? c.stages[0]!;

/** The next stage the date has reached and the person has not said «Ще ні» to today — the one to ask about, or null. */
export function stageToAsk(c: RehabComplex, today: ISODate): RehabStage | null {
  const i = c.stages.findIndex((s) => s.id === currentStage(c).id);
  const next = c.stages[i + 1];
  if (!next || !next.from || next.from > today) return null;
  if (c.notYet?.stageId === next.id && c.notYet.on === today) return null;
  return next;
}
/** «Так»: the doctor allowed it — only then the stage moves. */
export const allowStage = (c: RehabComplex, stageId: string): RehabComplex => ({ ...c, stageId, notYet: undefined });
/** «Ще ні»: nothing changes; asked again tomorrow. */
export const notYetStage = (c: RehabComplex, stageId: string, today: ISODate): RehabComplex => ({ ...c, notYet: { stageId, on: today } });

/** Sessions of the complex done on that day (the tile «ЛФК N з M»). */
export const sessionsOn = (entries: readonly DayEntry[], date: ISODate): DayEntry[] =>
  entries.filter((e) => e.kind === 'workout' && e.status === 'done' && !!e.rehab && e.at.startsWith(date));
