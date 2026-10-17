// D79: the example week goes into the database with the example plan and leaves with it — only rows marked `demo`.
import { db } from './db';
import { demoData, type DemoData } from './demo';

const TABLES = ['entries', 'workouts', 'weights', 'wellbeing', 'labs'] as const;
type Row = { id?: string; date?: string; name?: string };
const keyOf = (t: (typeof TABLES)[number], r: Row) => (t === 'labs' ? [r.date!, r.name!] : t === 'weights' || t === 'wellbeing' ? r.date! : r.id!);

export async function putDemo(): Promise<void> {
  const foods = new Map((await db.foods.toArray()).map((f) => [f.id, f]));
  const d = demoData(foods);
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) await db.table(t).bulkPut(d[t]);
  });
}

/** Takes the example week out; returns it, so «Скасувати» can put it back. */
export async function takeDemo(): Promise<DemoData> {
  return db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    const out = {} as Record<(typeof TABLES)[number], unknown[]>;
    for (const t of TABLES) {
      const rows = await db.table(t).filter((r: { demo?: true }) => r.demo === true).toArray() as Row[];
      out[t] = rows;
      await db.table(t).bulkDelete(rows.map((r) => keyOf(t, r)));
    }
    return out as unknown as DemoData;
  });
}

export async function restoreDemo(d: DemoData): Promise<void> {
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) await db.table(t).bulkPut(d[t]);
  });
}
