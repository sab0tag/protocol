// One sync round (SPEC.md D31): find local changes by hash, pull what other devices sent, push ours.
// A conflict on the same row goes to the later change; on a device's first sync the vault wins (a new phone's
// example plan must not overwrite the real one). Built-in foods and dishes are not synced — every device has them.
import type { ProtocolDB, SyncMeta, SyncRow } from '../data/db';
import { open, recordKey, seal, type Keys } from './crypto';

export const TABLES = ['plan', 'entries', 'wellbeing', 'workouts', 'weights', 'labs', 'recipes'] as const;
export type SyncTable = (typeof TABLES)[number];

type Row = Record<string, unknown>;
const DELETED = '-';

const idOf = (t: SyncTable, row: Row): string =>
  t === 'labs' ? JSON.stringify([row.date, row.name]) : String(t === 'wellbeing' || t === 'weights' ? row.date : row.id);
const pkOf = (t: SyncTable, id: string): string | [string, string] => (t === 'labs' ? JSON.parse(id) as [string, string] : id);
const synced = (t: SyncTable, row: Row) => !(t === 'recipes' && row.builtIn);

/** Same content → same string, whatever the key order; `undefined` fields are skipped as JSON does. */
export function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : stable(x))).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().filter((k) => (v as Row)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable((v as Row)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** cyrb53 — a fast 53-bit hash; enough to tell «changed» from «same». */
export function hashOf(row: unknown): string {
  const s = stable(row);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export interface Payload { t: SyncTable; id: string; d: Row | null; at: number }
export interface RemoteRecord { k: string; v: string | null; seq: number }

export interface Api {
  pull(since: number): Promise<{ records: RemoteRecord[]; more: boolean; seq: number }>;
  push(records: { k: string; v: string }[]): Promise<{ seq: number }>;
}

export interface Result { pulled: number; pushed: number }

export async function syncOnce(db: ProtocolDB, keys: Keys, api: Api, now = Date.now()): Promise<Result> {
  const meta = await db.meta.get('sync');
  if (!meta) return { pulled: 0, pushed: 0 };
  const base = new Map((await db.sync.toArray()).map((r) => [r.tid, r]));
  const first = meta.seq === 0 && ![...base.values()].some((r) => r.h !== undefined);

  // 1. what changed here since the last agreed state (kept with the time it was first seen, even offline)
  const local = new Map<string, { t: SyncTable; id: string; row: Row; h: string }>();
  for (const t of TABLES) {
    for (const row of await db.table(t).toArray() as Row[]) {
      if (!synced(t, row)) continue;
      const id = idOf(t, row);
      local.set(`${t}:${id}`, { t, id, row, h: hashOf(row) });
    }
  }
  const dirty = new Map<string, SyncRow>();
  const mark = async (tid: string, h: string) => {
    const b = base.get(tid);
    if (b?.h === h) { if (b.dh) await db.sync.put({ tid, k: b.k, h }); return; } // changed and changed back
    const row: SyncRow = b?.dh === h ? b : { tid, k: b?.k ?? await recordKey(keys, tid), ...(b?.h ? { h: b.h } : {}), dh: h, dat: now };
    dirty.set(tid, row);
  };
  for (const [tid, l] of local) await mark(tid, l.h);
  for (const [tid, b] of base) if (!local.has(tid) && b.h !== undefined && b.h !== DELETED) await mark(tid, DELETED);
  await db.sync.bulkPut([...dirty.values()]);

  // 2. pull
  let since = meta.seq, pulled = 0;
  for (;;) {
    const page = await api.pull(since);
    for (const r of page.records) {
      if (r.v === null) continue;
      let p: Payload;
      try { p = await open<Payload>(keys, r.k, r.v); } catch { continue; } // not ours / damaged — skip
      if (!TABLES.includes(p.t)) continue;
      const tid = `${p.t}:${p.id}`;
      const h = p.d ? hashOf(p.d) : DELETED;
      const mine = dirty.get(tid);
      if (mine && !first && (mine.dat ?? 0) > p.at) continue; // ours is later: it will be pushed
      if (!mine && base.get(tid)?.h === h) continue; // our own change coming back
      await db.transaction('rw', [db.table(p.t), db.sync], async () => {
        if (p.d) await db.table(p.t).put(p.d);
        else await db.table(p.t).delete(pkOf(p.t, p.id));
        const row: SyncRow = { tid, k: r.k, h };
        await db.sync.put(row);
        base.set(tid, row);
      });
      dirty.delete(tid);
      pulled += 1;
    }
    since = page.seq;
    if (!page.more) break;
  }
  await db.meta.update('sync', { seq: since });

  // 3. push what is still ours
  const out = [...dirty.values()];
  for (let i = 0; i < out.length; i += 200) {
    const chunk = out.slice(i, i + 200);
    const records = await Promise.all(chunk.map(async (s) => {
      const [t, ...rest] = s.tid.split(':') as [SyncTable, ...string[]];
      const id = rest.join(':');
      const p: Payload = { t, id, d: s.dh === DELETED ? null : local.get(s.tid)!.row, at: s.dat ?? now };
      return { k: s.k, v: await seal(keys, s.k, p) };
    }));
    await api.push(records);
    await db.sync.bulkPut(chunk.map((s) => ({ tid: s.tid, k: s.k, h: s.dh! })));
  }
  await db.meta.update('sync', { lastAt: now } satisfies Partial<SyncMeta>);
  return { pulled, pushed: out.length };
}
