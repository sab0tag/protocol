import { addDays, format, parseISO } from 'date-fns';
import { create } from 'zustand';
import { todayISO } from '../domain/dates';

interface UiState {
  date: string; // the day being looked at
  setDate: (d: string) => void;
  shift: (days: number) => void;
}

export const useUi = create<UiState>((set, get) => ({
  date: todayISO(),
  setDate: (date) => set({ date }),
  shift: (days) => set({ date: format(addDays(parseISO(get().date), days), 'yyyy-MM-dd') }),
}));
