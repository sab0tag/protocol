// D87: unsaved work that must survive the page being reloaded behind the person's back — a locked phone (iOS drops
// the page or its database connection, D42), a new version taking over (D47). A model's menu costs money and a
// minute; sets typed between sets are the workout itself. Kept on this device only, until saved, dropped or a day old.
import { inDemo } from './db';

const PREFIX = `protocol.kept.${inDemo() ? 'demo.' : ''}`; // D98: the example's drafts never show up in the own data
const DAY = 86_400_000;

export function keep<T>(key: string, value: T | undefined): void {
  try {
    if (value === undefined) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), v: value }));
  } catch { /* private mode or full — the page just works without it */ }
}

export function kept<T>(key: string, maxAge = DAY): T | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return undefined;
    const { at, v } = JSON.parse(raw) as { at: number; v: T };
    if (Date.now() - at > maxAge) { localStorage.removeItem(PREFIX + key); return undefined; }
    return v;
  } catch { return undefined; }
}
