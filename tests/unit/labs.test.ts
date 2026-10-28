import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProtocolDB } from '../../src/data/db';
import { writeLab } from '../../src/data/labs';
import { labDraft, labNumber, validateLab, type LabDraft } from '../../src/domain/labs';
import type { LabResult } from '../../src/domain/types';

const today = '2026-10-28';
const draft: LabDraft = { date: '2026-10-27', name: ' Показник ', value: '5,1234', unit: ' од. ', target: ' < 6 ' };

describe('manual laboratory validation and precision', () => {
  it.each(['', ' ', 'abc', 'NaN', 'Infinity', '1e999', '0x10', '1,2,3', '5 мг', '5,'])('rejects a non-finite or incomplete number: %j', value => {
    expect(validateLab({ ...draft, value }, today)).toEqual({ ok: false, errors: { value: true } });
  });
  it.each(['0', '-0,004', '5.1234', '5,1234', '1e-7'])('accepts explicit finite numbers without a clinical range assumption: %j', raw => {
    const result = validateLab({ ...draft, value: raw }, today);
    expect(result).toMatchObject({ ok: true, result: { value: Number(raw.replace(',', '.')) } });
  });
  it.each(['', '2026-02-30', '2026-1-01', '2026-10-29'])('rejects missing, malformed, impossible or future dates: %j', date => {
    expect(validateLab({ ...draft, date }, today)).toEqual({ ok: false, errors: { date: true } });
  });
  it('trims text, accepts a real leap day and never infers a unit or target', () => {
    expect(validateLab({ ...draft, date: '2024-02-29', unit: ' ', target: '' }, today)).toEqual({ ok: true,
      result: { date: '2024-02-29', name: 'Показник', value: 5.1234, unit: '' } });
    expect(validateLab({ ...draft, name: ' ' }, today)).toEqual({ ok: false, errors: { name: true } });
  });
  it('round-trips stored precision through an edit, including small values', () => {
    for (const value of [0.004, 5.123456, 1e-7]) {
      expect(labNumber(value)).not.toBe('0');
      expect(validateLab(labDraft({ date: draft.date, name: 'Показник', value, unit: '' }), today)).toMatchObject({ ok: true, result: { value } });
    }
    expect(labNumber(5.123456)).toBe('5,123456');
  });
});

let sequence = 0;
const databases: ProtocolDB[] = [];
const database = () => { const d = new ProtocolDB(`lab-corrections-${++sequence}`); databases.push(d); return d; };
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(databases.splice(0).map(d => d.delete())); });
const original: LabResult = { date: '2026-10-20', name: 'Показник', value: 5.1234, unit: 'од.', target: '< 6', demo: true };

describe('atomic laboratory corrections', () => {
  it('adds a new result and refuses a duplicate instead of overwriting it', async () => {
    const d = database();
    expect(await writeLab(d, original)).toBe('saved');
    expect(await writeLab(d, { ...original, value: 9 })).toBe('exists');
    expect(await d.labs.toArray()).toEqual([original]);
  });
  it('corrects the selected value, preserves its demo flag and can clear its target', async () => {
    const d = database(); await d.labs.put(original);
    expect(await writeLab(d, { date: original.date, name: original.name, value: 0.004, unit: 'од.' }, original)).toBe('saved');
    expect(await d.labs.toArray()).toEqual([{ date: original.date, name: original.name, value: 0.004, unit: 'од.', demo: true }]);
  });
  it('moves a renamed/redated result and leaves other dates intact', async () => {
    const d = database(); const other = { ...original, date: '2026-10-19' };
    await d.labs.bulkPut([original, other]);
    const next = { ...original, name: 'Уточнена назва', date: '2026-10-21', value: 5.12 };
    expect(await writeLab(d, next, original)).toBe('saved');
    expect(await d.labs.get([original.date, original.name])).toBeUndefined();
    expect(await d.labs.get([next.date, next.name])).toEqual(next);
    expect(await d.labs.get([other.date, other.name])).toEqual(other);
    expect(await d.labs.count()).toBe(2);
  });
  it('refuses a move onto an existing result without modifying either one', async () => {
    const d = database(), other = { ...original, date: '2026-10-21', value: 7 };
    await d.labs.bulkPut([original, other]);
    expect(await writeLab(d, { ...original, date: other.date }, original)).toBe('exists');
    expect(await d.labs.get([original.date, original.name])).toEqual(original);
    expect(await d.labs.get([other.date, other.name])).toEqual(other);
  });
  it('refuses a stale edit or a stale deletion instead of recreating old data', async () => {
    const d = database(); const newer = { ...original, value: 8 };
    await d.labs.put(newer);
    expect(await writeLab(d, { ...original, value: 6 }, original)).toBe('changed');
    expect(await d.labs.get([original.date, original.name])).toEqual(newer);
    await d.labs.delete([original.date, original.name]);
    expect(await writeLab(d, { ...original, value: 6 }, original)).toBe('changed');
    expect(await d.labs.count()).toBe(0);
  });
  it('rolls back the new key if deleting the old key fails', async () => {
    const d = database(); await d.labs.put(original);
    vi.spyOn(d.labs, 'delete').mockRejectedValueOnce(new Error('Synthetic storage failure'));
    await expect(writeLab(d, { ...original, date: '2026-10-21' }, original)).rejects.toThrow('Synthetic storage failure');
    expect(await d.labs.toArray()).toEqual([original]);
  });
  it('undo restores the original only while the corrected result is unchanged', async () => {
    const d = database(), next = { ...original, date: '2026-10-21', value: 5.12345 };
    await d.labs.put(original);
    await writeLab(d, next, original);
    expect(await writeLab(d, original, next)).toBe('saved');
    expect(await d.labs.toArray()).toEqual([original]);
    await writeLab(d, next, original);
    await d.labs.update([next.date, next.name], { value: 10 });
    expect(await writeLab(d, original, next)).toBe('changed');
    expect(await d.labs.get([next.date, next.name])).toMatchObject({ value: 10 });
  });
});
