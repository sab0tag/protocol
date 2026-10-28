import { format, isValid, parseISO } from 'date-fns';
import type { LabResult } from './types';

export interface LabDraft { date: string; name: string; value: string; unit: string; target: string }
export type LabField = 'name' | 'value' | 'date';
export type LabValidation = { ok: true; result: LabResult } | { ok: false; errors: Partial<Record<LabField, true>> };

/** Preserve the stored number's precision; a laboratory value is not a one-decimal summary metric. */
export const labNumber = (value: number) => String(value).replace('.', ',');
export const labDraft = (result: LabResult): LabDraft => ({ ...result, value: labNumber(result.value), target: result.target ?? '' });

export function validateLab(draft: LabDraft, today: string): LabValidation {
  const errors: Partial<Record<LabField, true>> = {};
  const raw = draft.value.trim(), value = Number(raw.replace(',', '.'));
  if (!draft.name.trim()) errors.name = true;
  if (!/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:[eE][+-]?\d+)?$/.test(raw) || !Number.isFinite(value)) errors.value = true;
  const date = parseISO(draft.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || !isValid(date) || format(date, 'yyyy-MM-dd') !== draft.date || draft.date > today) errors.date = true;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, result: { date: draft.date, name: draft.name.trim(), value, unit: draft.unit.trim(),
    ...(draft.target.trim() ? { target: draft.target.trim() } : {}) } };
}
