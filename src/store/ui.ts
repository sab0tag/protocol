import { addDays, format, parseISO } from 'date-fns';
import { create } from 'zustand';
import { todayISO } from '../domain/dates';

interface UiState {
  date: string; // the day being looked at
  setDate: (d: string) => void;
  shift: (days: number) => void;
  /** Onboarding finished or skipped in this session — the gate must not wait for the live query to catch up. */
  onboarded: boolean;
  setOnboarded: () => void;
  /** D106: a new version is downloading — the page reloads itself when it is in */
  updating: boolean;
  /** D119: a doctor's code from the QR link, as the server answered — shown in onboarding and «Ще → Пілот» */
  srcLink?: { code: string; state: 'known' | 'unknown' | 'offline' };
}

export const useUi = create<UiState>((set, get) => ({
  date: todayISO(),
  setDate: (date) => set({ date }),
  shift: (days) => set({ date: format(addDays(parseISO(get().date), days), 'yyyy-MM-dd') }),
  onboarded: false,
  setOnboarded: () => set({ onboarded: true }),
  updating: false,
}));
