import { expect, it } from 'vitest';
import { pendingStatus, rhythmPresentation } from '../../src/domain/rhythmPresentation';
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
it('says what waits for a mark: planned in its window, deferred while «Пізніше» holds it, unmarked after — never missed (D142)', () => {
  const dose: RhythmNode = { kind: 'dose', at: '08:00', item: { key: 'med:p:08:00', kind: 'med', title: 'Synthetic', tappable: true, done: false, time: '08:00' } };
  const meal = entry('09:30', 'planned');
  const at = (h: number, m = 0) => new Date(2026, 9, 28, h, m);
  expect(pendingStatus(dose, '2026-10-28', at(8, 59))).toEqual({ state: 'planned' }); // D50: the window lasts an hour
  expect(pendingStatus(dose, '2026-10-28', at(9, 1))).toEqual({ state: 'unmarked' });
  expect(pendingStatus(dose, '2026-10-28', at(9, 1), { 'med:2026-10-28:08:00': at(9, 16).getTime() })).toEqual({ state: 'deferred', until: '09:16' });
  expect(pendingStatus(dose, '2026-10-28', at(9, 20), { 'med:2026-10-28:08:00': at(9, 16).getTime() })).toEqual({ state: 'unmarked' });
  expect(pendingStatus(meal, '2026-10-28', at(9, 40), { 'meal:09:30:2026-10-28T09:30:00': at(9, 55).getTime() })).toEqual({ state: 'deferred', until: '09:55' });
  expect(pendingStatus(dose, '2026-10-27', at(7))).toEqual({ state: 'unmarked' }); // an earlier day
  expect(pendingStatus(dose, '2026-10-29', at(23))).toEqual({ state: 'planned' }); // a later day
  expect(pendingStatus(entry('08:00', 'planned', true), '2026-10-28', at(20))).toEqual({ state: 'planned' }); // no known time — not late
});
