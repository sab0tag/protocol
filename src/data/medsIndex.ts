// D89: the medicines register index (public/meds-index.json, precached for offline) — fetched once, when first needed.
import { useEffect, useState } from 'react';
import { readIndex, type MedIndex } from '../domain/meds';

let loading: Promise<MedIndex> | undefined;
export function loadMedIndex(): Promise<MedIndex> {
  loading ??= fetch('./meds-index.json').then((r) => r.json()).then(readIndex).catch((e) => { loading = undefined; throw e; });
  return loading;
}

export function useMedIndex(enabled = true): MedIndex | undefined {
  const [index, setIndex] = useState<MedIndex>();
  useEffect(() => { if (enabled) void loadMedIndex().then(setIndex).catch(() => undefined); }, [enabled]);
  return index;
}
