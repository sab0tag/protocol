import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readProfiles, saveProfile, switchProfile, profileDatabase, profileKey } from '../../src/data/profiles';
const KEY = 'protocol.profiles.v1';
const id = '12345678-1234-1234-1234-123456789abc';
beforeEach(() => { localStorage.clear(); });
describe('local profile directory', () => {
  it('adopts the existing database without copying or renaming old data', () => {
    expect(readProfiles()).toEqual({ v: 1, active: 'main', profiles: [{ id: 'main', name: '', relation: 'self' }] });
    expect(profileDatabase('main')).toBe('protocol');
    expect(profileDatabase(id)).toBe(`protocol-profile-${id}`);
    expect(profileKey('protocol.kept')).toBe('protocol.kept');
  });
  it('persists trimmed names and edits a profile instead of duplicating it', () => {
    saveProfile({ id: 'main', name: ' Олена ', relation: 'self' });
    saveProfile({ id, name: 'Данило', relation: 'child' });
    saveProfile({ id, name: 'Данило Петренко', relation: 'child' });
    expect(readProfiles().profiles).toHaveLength(2);
    expect(readProfiles().profiles[0]?.name).toBe('Олена');
    expect(readProfiles().profiles[1]?.name).toBe('Данило Петренко');
    expect(readProfiles().active).toBe('main');
  });
  it.each(['', ' ', 'a'.repeat(61)])('rejects invalid name %s without writing', name => {
    expect(() => saveProfile({ id, name, relation: 'relative' })).toThrow();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
  it('does not overwrite corrupt or unknown directories or select missing people', () => {
    for (const raw of ['{', JSON.stringify({ v: 2, active: 'main', profiles: [] }), JSON.stringify({ v: 1, active: 'missing', profiles: [{ id: 'main', name: 'Own', relation: 'self' }] })]) {
      localStorage.setItem(KEY, raw);
      expect(() => saveProfile({ id, name: 'Test', relation: 'child' })).toThrow();
      expect(localStorage.getItem(KEY)).toBe(raw);
    }
    localStorage.clear();
    expect(() => switchProfile(id)).toThrow('Профіль не знайдено.');
    expect(localStorage.getItem(KEY)).toBeNull();
  });
  it('reports a storage failure and preserves the last directory', () => {
    saveProfile({ id: 'main', name: 'Олена', relation: 'self' });
    const old = localStorage.getItem(KEY);
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => saveProfile({ id, name: 'Данило', relation: 'child' })).toThrow('quota');
    spy.mockRestore();
    expect(localStorage.getItem(KEY)).toBe(old);
  });
});

it('keeps the optional daily-phrase setting per person and does not inherit a disabled setting', () => {
  saveProfile({ id: 'main', name: 'Олена', relation: 'self', motivation: false });
  saveProfile({ id, name: 'Данило', relation: 'child' });
  expect(readProfiles().profiles.map(p => p.motivation)).toEqual([false, undefined]);
  saveProfile({ id: 'main', name: 'Оленка', relation: 'self', motivation: true });
  expect(readProfiles().profiles[0]).toMatchObject({ name: 'Оленка', motivation: true });
  expect(readProfiles().profiles).toHaveLength(2);
});
