import type { ProtocolDB } from './db';
import type { DayEntry } from '../domain/types';

/** The record changed, or is gone, since the person looked at it. Nothing was written. */
export class EntryChangedError extends Error {
  constructor(public readonly code: 'changed' | 'gone') { super(code); }
}

/** One explicit change to a record; `after: null` is a deletion. Kept for a conditional undo. */
export interface EntryChange { before: DayEntry; after: DayEntry | null }

const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort()
    .filter(key => (value as Record<string, unknown>)[key] !== undefined)
    .map(key => [key, canonical((value as Record<string, unknown>)[key])])) : value;

/** Structural equality of stored records. Key order is not content: a sync round-trip may rebuild an object. */
export function sameEntry(a: DayEntry | undefined | null, b: DayEntry | undefined | null): boolean {
  return !!a && !!b && JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/** The outcome the person chose; an earlier reason, adherence or an uncertain mark's time do not carry over. */
export function withStatus(entry: DayEntry, status: DayEntry['status'], skipReason?: string): DayEntry {
  const next: DayEntry = { ...entry, status };
  delete next.adherence;
  delete next.skipReason;
  if (status === 'skipped' && skipReason?.trim()) next.skipReason = skipReason.trim();
  if (entry.adherence === 'uncertain') { delete next.markedAt; delete next.timeUnknown; }
  return next;
}

/** Read, compare with what the person saw, and write in one transaction: an open, stale sheet never overwrites
 *  a newer edit, outcome or deletion (from this device or a synced one). `next` returning null deletes the record. */
export async function changeEntry(target: ProtocolDB, expected: DayEntry, next: (current: DayEntry) => DayEntry | null): Promise<EntryChange> {
  return target.transaction('rw', target.entries, async () => {
    const current = await target.entries.get(expected.id);
    if (!current) throw new EntryChangedError('gone');
    if (!sameEntry(current, expected)) throw new EntryChangedError('changed');
    const after = next(current);
    if (after) await target.entries.put(after); else await target.entries.delete(current.id);
    return { before: current, after };
  });
}

/** Undo is conditional as well: it restores the earlier record only while nothing has happened to it since. */
export async function revertEntry(target: ProtocolDB, change: EntryChange): Promise<void> {
  await target.transaction('rw', target.entries, async () => {
    const current = await target.entries.get(change.before.id);
    if (change.after === null ? current !== undefined : !sameEntry(current, change.after)) throw new EntryChangedError(current ? 'changed' : 'gone');
    await target.entries.put(change.before);
  });
}
