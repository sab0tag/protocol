import { beforeEach, describe, expect, it } from 'vitest';
import { applyPalette, readPalette } from '../../src/store/theme';

describe('direction C preview (D163)', () => {
  beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-palette'); });
  it('is off by default', () => {
    expect(readPalette('')).toBe('default');
  });
  it('?palette=c turns it on and is remembered; ?palette=default turns it off', () => {
    expect(readPalette('?palette=c')).toBe('c');
    expect(readPalette('')).toBe('c');
    expect(readPalette('?palette=default')).toBe('default');
    expect(readPalette('')).toBe('default');
  });
  it('an unknown value changes nothing', () => {
    readPalette('?palette=c');
    expect(readPalette('?palette=neon')).toBe('c');
  });
  it('sets and removes the attribute the CSS keys on', () => {
    applyPalette('c');
    expect(document.documentElement.dataset.palette).toBe('c');
    applyPalette('default');
    expect(document.documentElement.hasAttribute('data-palette')).toBe(false);
  });
});
