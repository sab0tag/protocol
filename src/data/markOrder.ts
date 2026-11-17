// D164: the order of the quick marks on «Сьогодні», chosen in «Ще → Налаштування → Швидкі дії». A per-device, per-profile
// convenience (like the theme): stored in this browser only; without it — Ліки, Вода, Самопочуття, Тренування.
import { useSyncExternalStore } from 'react';
import { profileKey } from './profiles';

export const MARKS = ['meds', 'water', 'mood', 'workout'] as const;
export type MarkKey = (typeof MARKS)[number];
const EVENT = 'protocol-mark-order';

export function readMarkOrder(): MarkKey[] {
  try {
    const saved = JSON.parse(localStorage.getItem(profileKey('protocol.markOrder')) ?? '[]') as unknown;
    const known = Array.isArray(saved) ? saved.filter((k): k is MarkKey => MARKS.includes(k as MarkKey)) : [];
    return [...new Set([...known, ...MARKS])];
  } catch { return [...MARKS]; }
}
export function saveMarkOrder(order: MarkKey[]): void {
  try { localStorage.setItem(profileKey('protocol.markOrder'), JSON.stringify(order)); } catch { /* private mode: the default order */ }
  window.dispatchEvent(new Event(EVENT));
}
const subscribe = (f: () => void) => { window.addEventListener(EVENT, f); return () => window.removeEventListener(EVENT, f); };
const snapshot = () => readMarkOrder().join(',');
export function useMarkOrder(): MarkKey[] { return useSyncExternalStore(subscribe, snapshot).split(',') as MarkKey[]; }
