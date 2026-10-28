export type SceneArtwork = 'food' | 'movement' | 'assistant' | 'care' | 'wellness' | 'settings';

const startsWithAny = (path: string, prefixes: string[]) => prefixes.some((prefix) => path.startsWith(prefix));

export function sceneArtworkForPath(pathname: string): SceneArtwork | null {
  if (pathname === '/') return null;
  if (startsWithAny(pathname, ['/food', '/meal', '/dishes', '/foods', '/menu', '/shopping']) || pathname === '/more/food') return 'food';
  if (startsWithAny(pathname, ['/workout', '/exercises'])) return 'movement';
  if (startsWithAny(pathname, ['/assistant', '/concierge-log'])) return 'assistant';
  if (startsWithAny(pathname, ['/plan', '/welcome', '/report']) || pathname === '/progress/labs') return 'care';
  if (startsWithAny(pathname, ['/progress', '/wellbeing', '/week', '/my-day']) || pathname === '/more/health') return 'wellness';
  return 'settings';
}
