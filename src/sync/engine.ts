// One sync round (SPEC.md D31): find local changes by hash, pull what other devices sent, push ours.
// A conflict on the same row goes to the later change; on a device's first sync the vault wins (a new phone's
// example plan must not overwrite the real one). Built-in foods and dishes are not synced — every device has them; own foods are (D36).
import type { ProtocolDB, SyncMeta, SyncRow } from '../data/db';
import { open, recordKey, seal, type Keys } from './crypto';

export const TABLES = ['plan', 'entries', 'wellbeing', 'workouts', 'weights', 'labs', 'recipes', 'foods', 'favorites'] as const; // an older app skips a table it does not know
export type SyncTable = (typeof TABLES)[number];

type Row = Record<string, unknown>;
const DELETED = '-';

// D40: the plan travels by its parts («main#targets», «main#constraints»…), so editing the targets on one device
// and the limits on another at the same time keeps both. A legacy whole-plan record («main») is still applied.
const PLAN = 'main';
const planParts = (row: Row) => Object.entries(row).filter(([k, v]) => k !== 'id' && v !== undefined);
/** D43: the plan's backbone is never deleted by sync — neither sent nor applied. A device that misreads its plan
 *  (iOS can drop the database connection in the background) must not wipe the plan everywhere. */
export const PLAN_REQUIRED = ['constraints', 'prescriptions', 'targets', 'modes'] as const;
const required = (tid: string) => PLAN_REQUIRED.some((f) => tid === `plan:${PLAN}#${f}`);

const idOf = (t: SyncTable, row: Row): string =>
  t === 'labs' ? JSON.stringify([row.date, row.name]) : String(t === 'wellbeing' || t === 'weights' ? row.date : row.id);
const pkOf = (t: SyncTable, id: string): string | [string, string] => (t === 'labs' ? JSON.parse(id) as [string, string] : id);
const synced = (t: SyncTable, row: Row) => (t === 'foods' ? !!row.custom : !(t === 'recipes' && row.builtIn)); // D36: own foods only

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
      if (t === 'plan') {
        for (const [k, v] of planParts(row)) {
          const id = `${PLAN}#${k}`, part = { v };
          local.set(`plan:${id}`, { t, id, row: part, h: hashOf(part) });
        }
        continue;
      }
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
  // D43: a table read as empty while the vault knows its rows is a misread, not «everything deleted»
  const known = new Map<string, number>();
  for (const [tid, b] of base) if (b.h !== undefined && b.h !== DELETED) known.set(tid.split(':')[0]!, (known.get(tid.split(':')[0]!) ?? 0) + 1);
  const seen = new Set([...local.keys()].map((tid) => tid.split(':')[0]!));
  const misread = (t: string) => !seen.has(t) && (known.get(t) ?? 0) >= 3; // deleting the last one or two rows is real
  for (const [tid, b] of base) {
    if (tid === `plan:${PLAN}` || required(tid)) continue; // the legacy whole plan and the plan's backbone are never deleted
    if (misread(tid.split(':')[0]!)) continue;
    if (!local.has(tid) && b.h !== undefined && b.h !== DELETED) await mark(tid, DELETED);
  }
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
      if (!p.d && required(tid)) continue; // D43: such a deletion is a misread elsewhere
      const h = p.d ? hashOf(p.d) : DELETED;
      const mine = dirty.get(tid);
      if (mine && !first && (mine.dat ?? 0) > p.at) continue; // ours is later: it will be pushed
      const legacyPlan = p.t === 'plan' && p.id === PLAN;
      const myParts = legacyPlan ? [...dirty.values()].filter((x) => x.tid.startsWith(`plan:${PLAN}#`)) : [];
      if (legacyPlan && !first && myParts.some((x) => (x.dat ?? 0) > p.at)) continue; // our parts are later
      if (!mine && base.get(tid)?.h === h) continue; // our own change coming back
      await db.transaction('rw', [db.table(p.t), db.sync], async () => {
        if (p.t === 'plan' && p.id.startsWith(`${PLAN}#`)) {
          const field = p.id.slice(PLAN.length + 1);
          const plan = (await db.plan.get(PLAN)) ?? { id: PLAN, constraints: [], prescriptions: [], targets: {}, modes: [] };
          const next: Row = { ...plan };
          if (p.d) next[field] = p.d.v; else delete next[field];
          await db.plan.put(next as never);
        } else if (p.d) await db.table(p.t).put(p.d);
        else await db.table(p.t).delete(pkOf(p.t, p.id));
        const row: SyncRow = { tid, k: r.k, h };
        await db.sync.put(row);
        base.set(tid, row);
      });
      dirty.delete(tid);
      for (const x of myParts) dirty.delete(x.tid); // the whole plan replaced them; they go up next round, as they are now
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

/** D43: a plan that lost its backbone (or the «onboarded» mark) is filled in from the whole-plan record the vault
 *  keeps from before the plan went by parts; only missing fields are taken, nothing present is overwritten.
 *  Returns true when something was restored — the next round sends the parts back to every device. */
export async function repairPlan(db: ProtocolDB, keys: Keys, api: Api): Promise<boolean> {
  const plan = (await db.plan.get(PLAN)) as Row | undefined;
  const broken = !plan || PLAN_REQUIRED.some((f) => plan[f] === undefined) || plan.onboardedAt === undefined;
  if (!broken) return false;
  const k = await recordKey(keys, `plan:${PLAN}`);
  let since = 0, sealed: string | null = null;
  for (;;) {
    const page = await api.pull(since);
    for (const r of page.records) if (r.k === k && r.v) sealed = r.v;
    since = page.seq;
    if (!page.more) break;
  }
  const old = sealed ? (await open<Payload>(keys, k, sealed)).d : null;
  const next: Row = { id: PLAN, ...(plan ?? {}) };
  let changed = false;
  for (const [f, v] of Object.entries(old ?? {})) if (f !== 'id' && next[f] === undefined && v !== undefined) { next[f] = v; changed = true; }
  if (!changed) return false;
  // a deletion of these parts may be the vault's latest word: forget the agreed state, so they go up again
  await db.transaction('rw', db.plan, db.sync, async () => {
    await db.plan.put(next as never);
    await db.sync.bulkDelete(Object.keys(next).filter((f) => f !== 'id' && plan?.[f] === undefined).map((f) => `plan:${PLAN}#${f}`));
  });
  return true;
}

// ------------------------------------------------------------------ earlier versions of the plan (D44)
export interface PlanVersion { source: string; at: number; plan: Row }

/** The plan as a set of records had it: the whole-plan record with its parts on top, each by its own time;
 *  deletions of the backbone are ignored (D43). */
export async function planFromRecords(keys: Keys, records: { k: string; v: string | null }[], source: string): Promise<PlanVersion | null> {
  const whole = await recordKey(keys, `plan:${PLAN}`);
  const parts = new Map<string, string>();
  const fields = ['constraints', 'prescriptions', 'targets', 'modes', 'nextCheckup', 'profile', 'onboardedAt', 'lastVisit', 'questions', 'lastExportAt'];
  for (const f of fields) parts.set(await recordKey(keys, `plan:${PLAN}#${f}`), f);
  let plan: Row | null = null, at = 0;
  const byField: Record<string, { v: unknown; at: number }> = {};
  for (const r of records) {
    if (!r.v || (r.k !== whole && !parts.has(r.k))) continue;
    let p: Payload;
    try { p = await open<Payload>(keys, r.k, r.v); } catch { continue; }
    if (r.k === whole && p.d) { plan = { ...p.d }; at = Math.max(at, p.at); continue; }
    const f = parts.get(r.k)!;
    if (p.d) byField[f] = { v: p.d.v, at: p.at };
  }
  const merged: Row = { id: PLAN, ...(plan ?? {}) };
  for (const [f, x] of Object.entries(byField)) { merged[f] = x.v; at = Math.max(at, x.at); }
  return plan || Object.keys(byField).length ? { source, at, plan: merged } : null;
}
