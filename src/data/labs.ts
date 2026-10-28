import type { ProtocolDB } from './db';
import type { LabResult } from '../domain/types';

export type LabWrite = 'saved' | 'exists' | 'changed';
const same = (a: LabResult, b: LabResult) => (['date', 'name', 'value', 'unit', 'target', 'demo'] as const).every(key => a[key] === b[key]);

/** A renamed/redated result moves atomically. Never overwrite another result or a newer local/synced edit. */
export async function writeLab(target: ProtocolDB, result: LabResult, original?: LabResult): Promise<LabWrite> {
  return target.transaction('rw', target.labs, async () => {
    const key: [string, string] = [result.date, result.name];
    const moved = !!original && (original.date !== result.date || original.name !== result.name);
    let current: LabResult | undefined;
    if (original) {
      current = await target.labs.get([original.date, original.name]);
      if (!current || !same(current, original)) return 'changed';
    }
    if ((!original || moved) && await target.labs.get(key)) return 'exists';
    const next = { ...current, ...result };
    if (!result.target) delete next.target;
    await target.labs.put(next);
    if (original && moved) await target.labs.delete([original.date, original.name]);
    return 'saved';
  });
}
