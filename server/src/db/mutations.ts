import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Context } from 'hono';
export interface Mutation { scope: string; keyHash: string; requestHash: string; at: number }
export class MutationError extends Error {
  readonly code: 'mutation_key_required' | 'mutation_conflict' | 'mutation_in_progress' | 'mutation_failed';
  constructor(code: MutationError['code']) { super(code); this.code = code; }
}
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}
export function mutationRequest(c: Context, scope: string, input: unknown, at: number): Mutation {
  const key = c.req.header('Idempotency-Key');
  if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) throw new MutationError('mutation_key_required');
  return { scope, keyHash: hash(key), requestHash: hash(canonical(input)), at };
}
export const bindMutation = (m: Mutation | undefined, scope: string): Mutation | undefined => m ? { ...m, scope } : undefined;

/** Caller owns BEGIN IMMEDIATE and must authorize before reading any replay. */
export function startMutation<T>(db: DatabaseSync, m?: Mutation): { hit: false } | { hit: true; value: T } {
  if (!db.isTransaction) throw Error('mutation receipt requires the business transaction');
  if (!m) return { hit: false };
  db.prepare('DELETE FROM staff_mutations WHERE scope = ? AND key_hash = ? AND expires_at <= ?').run(m.scope,m.keyHash,m.at);
  const r = db.prepare('SELECT * FROM staff_mutations WHERE scope = ? AND key_hash = ?').get(m.scope,m.keyHash);
  if (r) {
    if (r.request_hash !== m.requestHash) throw new MutationError('mutation_conflict');
    if (r.state === 'pending') throw new MutationError('mutation_in_progress');
    if (r.state === 'failed') throw new MutationError('mutation_failed');
    return { hit: true, value: (JSON.parse(String(r.result_json)) as { value: T }).value };
  }
  db.prepare("INSERT INTO staff_mutations VALUES (?, ?, ?, 'pending', NULL, ?)").run(m.scope,m.keyHash,m.requestHash,m.at+86400_000);
  return { hit: false };
}
export function completeMutation<T>(db: DatabaseSync, m: Mutation | undefined, value: T): void {
  if (m) db.prepare("UPDATE staff_mutations SET state = 'complete', result_json = ? WHERE scope = ? AND key_hash = ?")
    .run(JSON.stringify({ value: value ?? null }),m.scope,m.keyHash);
}
export function failMutation(db: DatabaseSync, m?: Mutation): void {
  if (m) db.prepare("UPDATE staff_mutations SET state = 'failed' WHERE scope = ? AND key_hash = ?").run(m.scope,m.keyHash);
}
export function performMutation<T>(db: DatabaseSync, m: Mutation | undefined, operation: () => T): T {
  const cached = startMutation<T>(db,m); if (cached.hit) return cached.value;
  const value = operation(); completeMutation(db,m,value); return value;
}
export function mutationHousekeeping(db: DatabaseSync, at: number): void { db.prepare('DELETE FROM staff_mutations WHERE expires_at <= ?').run(at); }
