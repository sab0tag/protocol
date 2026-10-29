import type { DatabaseSync } from 'node:sqlite';

/**
 * A structural description of a database schema — every table, column, index (including the implicit ones behind
 * PRIMARY KEY / UNIQUE), foreign key, view and trigger. Two databases with equal manifests have the same schema,
 * whatever text created them. SQLite's internal objects and the migration history table are left out.
 */
export interface Column { name: string; type: string; notnull: number; dflt: string | null; pk: number; hidden: number }
export interface Index { name: string; unique: number; origin: string; partial: number; columns: (string | null)[]; desc: number[]; collations: string[] }
export interface TableShape {
  columns: Column[]; indexes: Index[]; foreignKeys: unknown[]; withoutRowid: number; strict: number; autoincrement: boolean;
}
export interface Manifest { tables: Record<string, TableShape>; views: Record<string, string>; triggers: Record<string, string> }

export const HISTORY_TABLE = 'schema_migrations';
const squash = (sql: string) => sql.replace(/\s+/g, ' ').trim();

export function describe(db: DatabaseSync): Manifest {
  const objects = db.prepare(
    "SELECT type, name, tbl_name AS tbl, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name != ? ORDER BY type, name",
  ).all(HISTORY_TABLE) as { type: string; name: string; tbl: string; sql: string | null }[];
  const out: Manifest = { tables: {}, views: {}, triggers: {} };
  for (const o of objects) {
    if (o.type === 'view') out.views[o.name] = squash(o.sql ?? '');
    else if (o.type === 'trigger') out.triggers[o.name] = squash(o.sql ?? '');
    else if (o.type === 'table') out.tables[o.name] = table(db, o.name, o.sql ?? '');
    // explicit indexes are described with their table (index_list), so they are not listed twice
  }
  return out;
}

function table(db: DatabaseSync, name: string, sql: string): TableShape {
  const columns = (db.prepare(`SELECT name, type, "notnull", dflt_value AS dflt, pk, hidden FROM pragma_table_xinfo(?) ORDER BY cid`).all(name) as unknown as Column[])
    .map((c) => ({ ...c }));
  const indexes = (db.prepare(`SELECT name, "unique", origin, partial FROM pragma_index_list(?) ORDER BY name`).all(name) as
    { name: string; unique: number; origin: string; partial: number }[]).map((i) => {
    const keys = (db.prepare(`SELECT name, "desc", coll FROM pragma_index_xinfo(?) WHERE key = 1 ORDER BY seqno`).all(i.name) as
      { name: string | null; desc: number; coll: string }[]);
    return { name: i.name, unique: i.unique, origin: i.origin, partial: i.partial, columns: keys.map((k) => k.name), desc: keys.map((k) => k.desc), collations: keys.map((k) => k.coll) };
  });
  const foreignKeys = db.prepare(`SELECT * FROM pragma_foreign_key_list(?) ORDER BY id, seq`).all(name).map((r) => ({ ...r }));
  const info = db.prepare('SELECT wr, strict FROM pragma_table_list WHERE name = ? AND schema = ?').get(name, 'main') as { wr: number; strict: number };
  return { columns, indexes, foreignKeys, withoutRowid: info.wr, strict: info.strict, autoincrement: /\bAUTOINCREMENT\b/i.test(sql) };
}

/** Differences between an actual and an expected manifest, as readable lines. `allowMissing` accepts absent tables,
 *  views and triggers (an older variant that a baseline may normalize) but never a present object that differs. */
export function compare(actual: Manifest, expected: Manifest, allowMissing = false): string[] {
  const out: string[] = [];
  for (const kind of ['tables', 'views', 'triggers'] as const) {
    const a = actual[kind] as Record<string, unknown>, e = expected[kind] as Record<string, unknown>;
    for (const name of Object.keys(a).sort()) {
      if (!(name in e)) out.push(`unexpected ${kind.slice(0, -1)} ${name}`);
      else if (kind === 'tables') out.push(...tableDiff(name, a[name] as TableShape, e[name] as TableShape, allowMissing));
      else if (JSON.stringify(a[name]) !== JSON.stringify(e[name])) out.push(`${kind.slice(0, -1)} ${name} differs`);
    }
    if (!allowMissing) for (const name of Object.keys(e).sort()) if (!(name in a)) out.push(`missing ${kind.slice(0, -1)} ${name}`);
  }
  return out;
}

function tableDiff(name: string, a: TableShape, e: TableShape, allowMissingIndexes: boolean): string[] {
  const out: string[] = [];
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  if (!same(a.columns, e.columns)) out.push(`table ${name}: columns differ`);
  if (!same(a.foreignKeys, e.foreignKeys)) out.push(`table ${name}: foreign keys differ`);
  if (a.withoutRowid !== e.withoutRowid || a.strict !== e.strict || a.autoincrement !== e.autoincrement) out.push(`table ${name}: table options differ`);
  const ai = new Map(a.indexes.map((i) => [i.name, i])), ei = new Map(e.indexes.map((i) => [i.name, i]));
  for (const [n, i] of ai) {
    if (!ei.has(n)) out.push(`table ${name}: unexpected index ${n}`);
    else if (!same(i, ei.get(n))) out.push(`table ${name}: index ${n} differs`);
  }
  for (const [n, i] of ei) {
    // implicit (pk/unique) indexes come with the table; only an explicit CREATE INDEX can be missing in an older variant
    if (!ai.has(n) && !(allowMissingIndexes && i.origin === 'c')) out.push(`table ${name}: missing index ${n}`);
  }
  return out;
}
