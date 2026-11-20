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

describe('direction 01 «Сітка» preview (D198)', () => {
  beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-palette'); });
  it('?palette=grid turns it on and is remembered; C and default switch from it', () => {
    expect(readPalette('?palette=grid')).toBe('grid');
    expect(readPalette('')).toBe('grid');
    expect(readPalette('?palette=c')).toBe('c');
    expect(readPalette('?palette=default')).toBe('default');
  });
  it('sets the attribute the CSS keys on', () => {
    applyPalette('grid');
    expect(document.documentElement.dataset.palette).toBe('grid');
    applyPalette('default');
    expect(document.documentElement.hasAttribute('data-palette')).toBe(false);
  });
});
