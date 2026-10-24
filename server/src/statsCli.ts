// npm run stats:ops [-- --weeks 12]            — what the server sees anyway, by weeks (D119)
// npm run stats:pilot -- --from 2026-W44 --to 2026-W52 [--out DIR]   — the pilot's summary table, Markdown (and CSV with --out)
// npm run stats:pilot -- --source ENDO-01 "Ендокринолог, клініка 1"  — add (or rename) a source code
// Reads DB_PATH; prints no vault id and no pid.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WEEK, SRC, weekKey } from './pilot.ts';
import { opsStats, pilotStats, MIN_GROUP, table } from './stats.ts';
import { Store } from './store.ts';

const [cmd, ...args] = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const store = new Store(process.env.DB_PATH ?? './data/protocol.db');
const now = new Date();

if (cmd === 'ops') {
  const { weeks, months } = opsStats(store, now, Number(arg('weeks') ?? 12));
  console.log('## По тижнях (лише ті, хто ввімкнув синхронізацію)\n');
  console.log('back_w1 / back_w4 — % хранилищ, створених цього тижня, що вийшли на зв’язок через 1 і 4 тижні; rem_ack_min — середні хвилини до реакції\n');
  console.log(table(weeks, 'md'));
  console.log('## ШІ по місяцях\n');
  console.log(months.length ? table(months, 'md') : '—\n');
} else if (cmd === 'pilot') {
  const code = arg('source');
  if (code) {
    const label = args[args.indexOf('--source') + 2];
    if (!SRC.test(code) || !label) { console.error('--source CODE "label" (CODE: A–Z, 0–9, «-», 4–12)'); process.exit(2); }
    store.putPilotSource(code, label, now.toISOString().slice(0, 10));
    console.log(`${code}: ${label}`);
  } else {
    const to = arg('to') ?? weekKey(now), from = arg('from') ?? to;
    if (!WEEK.test(from) || !WEEK.test(to) || from > to) { console.error('--from YYYY-Www --to YYYY-Www'); process.exit(2); }
    const { rows, hidden } = pilotStats(store, from, to);
    const md = `# Пілот ${from} — ${to}\n\n${table(rows, 'md')}\n${hidden ? `Кодів, менших за ${MIN_GROUP} учасників, не показано окремо: ${hidden}.\n` : ''}`
      + '\nЦе спостереження, а не доказ ефекту: контрольної групи немає, у пілот приходять найвмотивованіші.\n';
    const out = arg('out');
    if (out) {
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, `pilot-${from}-${to}.md`), md);
      writeFileSync(join(out, `pilot-${from}-${to}.csv`), table(rows, 'csv'));
    }
    console.log(md);
  }
} else {
  console.error('stats:ops | stats:pilot'); process.exit(2);
}
store.close();
