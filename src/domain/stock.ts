// D69: how long a medicine will last — the count the person entered, minus the doses marked taken since then (D18 ticks
// with its prescriptionId), at the plan's doses a day. Only an estimate: a missed tick makes it look longer. Pure.
import type { DayEntry, Prescription } from './types';

export const LOW_DAYS = 5;

export function stockLeft(p: Prescription, entries: DayEntry[]): { left: number; days: number } | undefined {
  if (!p.stock) return undefined;
  const per = p.stock.perDose > 0 ? p.stock.perDose : 1;
  const taken = entries.filter((e) => e.kind === 'med' && e.status === 'done' && e.prescriptionId === p.id && (e.markedAt ?? e.at) > p.stock!.at).length;
  const left = Math.max(0, p.stock.left - taken * per);
  const perDay = Math.max(1, p.schedule?.times.length ?? 1) * per;
  return { left, days: Math.floor(left / perDay) };
}

/** Medicines that will run out within LOW_DAYS — to buy in time. */
export const runningLow = (prescriptions: Prescription[], entries: DayEntry[]) => prescriptions.flatMap((p) => {
  const s = stockLeft(p, entries);
  return s && s.days <= LOW_DAYS ? [{ p, ...s }] : [];
});
