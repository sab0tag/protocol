import { useLiveQuery } from 'dexie-react-hooks';
import type { ReactNode } from 'react';
import { db } from '../data/db';
import { changeEntry, EntryChangedError, revertEntry, sameEntry, type EntryChange } from '../data/entryActions';
import type { DayEntry, Food } from '../domain/types';
import { t } from '../i18n/uk';
import { EntryPreview } from './EntryPreview';
import { Sheet, SheetButton } from './Sheet';
import { toast } from './Toast';

const L = t.action;

/** Applies one explicit change against the record the person saw; says what happened and offers a conditional undo.
 *  A stale view writes nothing and says so — it is never reported as saved. Resolves to whether the change was made. */
export async function applyEntryChange(expected: DayEntry, next: (current: DayEntry) => DayEntry | null, said: string): Promise<boolean> {
  let change: EntryChange;
  try {
    change = await changeEntry(db, expected, next);
  } catch (e) {
    if (e instanceof EntryChangedError) toast(L.refused[e.code], { tone: 'warn' });
    else { console.error(e); toast(t.toast.failed, { tone: 'warn' }); }
    return false;
  }
  toast(said, { undo: () => revertEntry(db, change).catch((e: unknown) => {
    if (!(e instanceof EntryChangedError)) console.error(e);
    toast(e instanceof EntryChangedError ? L.undoRefused : t.toast.failed, { tone: 'warn' });
  }) });
  return true;
}

/** UI-ACTION-01: one detail layout for a record's actions. It shows the record as it is now — an edit or outcome
 *  synced while the sheet is open replaces what is shown, a deletion says so — and the actions receive that version,
 *  so they are checked against what the person actually saw. */
export function ActionDetail({ entry, foods, all, onClose, children }: {
  entry: DayEntry; foods?: Map<string, Food>; all?: DayEntry[]; onClose: () => void;
  children: (current: DayEntry) => ReactNode;
}) {
  const live = useLiveQuery(async () => (await db.entries.get(entry.id)) ?? null, [entry.id]);
  const current = live === undefined ? entry : live;
  if (current === null) return <Sheet title={entry.title} onClose={onClose}>
    <p role="status" className="mb-3 text-sm text-muted">{L.gone}</p>
    <SheetButton onClick={onClose}>{t.rowActions.close}</SheetButton>
  </Sheet>;
  return <Sheet title={current.title} onClose={onClose}>
    {!sameEntry(current, entry) && <p role="status" className="mb-3 rounded-xl bg-pending-bg p-3 text-sm text-pending">{L.updated}</p>}
    <EntryPreview entry={current} {...(foods ? { foods } : {})} {...(all ? { all } : {})} />
    <div role="group" aria-label={L.actions}>{children(current)}</div>
  </Sheet>;
}
