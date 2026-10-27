import { describe, expect, it } from 'vitest';
import { sceneArtworkForPath } from '../../src/domain/sceneArtwork';

describe('route-specific section artwork', () => {
  it.each([
    ['/meal/new', 'food'],
    ['/dishes', 'food'],
    ['/workout', 'movement'],
    ['/exercises', 'movement'],
    ['/assistant', 'assistant'],
    ['/concierge-log', 'assistant'],
    ['/plan/constraints', 'care'],
    ['/report', 'care'],
    ['/progress', 'wellness'],
    ['/wellbeing/journal', 'wellness'],
    ['/profiles', 'settings'],
    ['/more/food', 'food'],
    ['/more/health', 'wellness'],
  ] as const)('selects %s artwork', (path, scene) => {
    expect(sceneArtworkForPath(path)).toBe(scene);
  });

  it('keeps the existing Today hero rather than adding a second image', () => {
    expect(sceneArtworkForPath('/')).toBeNull();
  });
});
