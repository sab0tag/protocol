import { expect, it } from 'vitest';
import { rhythmPresentation } from '../../src/domain/rhythmPresentation';
import type { RhythmNode } from '../../src/domain/rhythm';
const entry = (at: string, status: 'planned' | 'done', unknown = false): RhythmNode => ({ kind: 'entry', at, entry: { id: at, kind: 'meal', title: 'Synthetic', at: `2026-10-28T${at}:00`, status, ...(unknown ? { timeUnknown: true } : {}) } });
it('highlights the next actionable time without turning elapsed unknown actions into missed ones', () => {
  const nodes = [entry('08:00', 'planned'), entry('10:00', 'done'), entry('12:00', 'planned'), entry('15:00', 'planned')];
  const original = structuredClone(nodes);
  expect(rhythmPresentation(nodes, '2026-10-28', new Date(2026, 9, 28, 11))).toEqual(['past', 'past', 'current', 'future']);
  expect(nodes).toEqual(original);
});
it('does not highlight a historical/future day or invent a time for untimed records', () => {
  const nodes = [entry('12:00', 'planned'), entry('15:00', 'planned', true)];
  const now = new Date(2026, 9, 28, 11);
  expect(rhythmPresentation(nodes, '2026-10-27', now)).toEqual(['past', 'untimed']);
  expect(rhythmPresentation(nodes, '2026-10-29', now)).toEqual(['future', 'untimed']);
});
