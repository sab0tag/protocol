import { afterEach, describe, expect, it } from 'vitest';
import { ProtocolDB } from '../../src/data/db';
import { changeEntry, EntryChangedError, revertEntry, sameEntry, withStatus } from '../../src/data/entryActions';
import type { DayEntry } from '../../src/domain/types';

const meal: DayEntry = { id: 'action-meal', kind: 'meal', status: 'planned', at: '2026-11-16T13:00:00+02:00', title: 'Тестовий обід',
  items: [{ name: 'Синтетична страва', grams: 200 }] };
const databases: ProtocolDB[] = [];
const database = async (...rows: DayEntry[]) => {
  const d = new ProtocolDB('entry-actions-' + crypto.randomUUID()); databases.push(d);
  await d.entries.bulkPut(rows); return d;
};
afterEach(async () => { for (const d of databases.splice(0)) await d.delete(); });
const refusal = (promise: Promise<unknown>) => promise.then(() => 'written', (e: unknown) => e instanceof EntryChangedError ? e.code : String(e));

describe('record equality', () => {
  it('ignores key order and absent optional fields, but not content', () => {
    const reordered = { title: meal.title, items: [{ grams: 200, name: 'Синтетична страва' }], at: meal.at, status: meal.status, kind: meal.kind, id: meal.id } as DayEntry;
    expect(sameEntry(meal, reordered)).toBe(true);
    expect(sameEntry(meal, { ...meal, skipReason: undefined })).toBe(true);
    expect(sameEntry(meal, { ...meal, items: [{ name: 'Синтетична страва', grams: 250 }] })).toBe(false);
    expect(sameEntry(meal, undefined)).toBe(false);
  });
});

describe('explicit outcome', () => {
  it('keeps a trimmed reason only for a skip and drops the uncertain mark and an earlier reason', () => {
    expect(withStatus(meal, 'skipped', '  нудить  ')).toEqual({ ...meal, status: 'skipped', skipReason: 'нудить' });
    expect(withStatus({ ...meal, status: 'skipped', skipReason: 'старе' }, 'done')).toEqual({ ...meal, status: 'done' });
    const uncertain: DayEntry = { ...meal, kind: 'med', status: 'done', adherence: 'uncertain', markedAt: meal.at, timeUnknown: true };
    expect(withStatus(uncertain, 'planned')).toEqual({ ...meal, kind: 'med', status: 'planned' });
    expect(withStatus(meal, 'skipped', '   ')).toEqual({ ...meal, status: 'skipped' });
  });
});

describe('stale-safe changes', () => {
  it('writes against the record that was seen and returns both versions', async () => {
    const d = await database(meal);
    const change = await changeEntry(d, meal, current => withStatus(current, 'done'));
    expect(change).toEqual({ before: meal, after: { ...meal, status: 'done' } });
    expect(await d.entries.get(meal.id)).toEqual({ ...meal, status: 'done' });
  });

  it('refuses when the record changed or is gone since it was seen, writing nothing', async () => {
    const newer = { ...meal, status: 'done' as const, adherence: 'completed_late' as const };
    const d = await database(newer);
    expect(await refusal(changeEntry(d, meal, current => withStatus(current, 'skipped', 'причина')))).toBe('changed');
    expect(await d.entries.get(meal.id)).toEqual(newer);
    await d.entries.delete(meal.id);
    expect(await refusal(changeEntry(d, meal, () => null))).toBe('gone');
    expect(await d.entries.count()).toBe(0);
  });

  it('deletes, and an undo restores the record only while nobody has recreated it', async () => {
    const d = await database(meal);
    const removed = await changeEntry(d, meal, () => null);
    expect(removed.after).toBeNull();
    await revertEntry(d, removed);
    expect(await d.entries.get(meal.id)).toEqual(meal);
    const again = await changeEntry(d, meal, () => null);
    await d.entries.put({ ...meal, title: 'Інший запис' });
    expect(await refusal(revertEntry(d, again))).toBe('changed');
    expect((await d.entries.get(meal.id))?.title).toBe('Інший запис');
  });

  it('undo refuses to overwrite a later edit or resurrect a later deletion', async () => {
    const d = await database(meal);
    const done = await changeEntry(d, meal, current => withStatus(current, 'done'));
    await d.entries.put({ ...meal, status: 'done', title: 'Змінено пізніше' });
    expect(await refusal(revertEntry(d, done))).toBe('changed');
    expect((await d.entries.get(meal.id))?.title).toBe('Змінено пізніше');
    await d.entries.delete(meal.id);
    expect(await refusal(revertEntry(d, done))).toBe('gone');
    expect(await d.entries.count()).toBe(0);
  });

  it('two submissions of the same stale view write once', async () => {
    const d = await database(meal);
    const results = await Promise.all([1, 2].map(() => refusal(changeEntry(d, meal, current => withStatus(current, 'done')))));
    expect(results.sort()).toEqual(['changed', 'written']);
  });
});
