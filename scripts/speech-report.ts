// D175 (Soniox, PR 4): the experiment's report. `npm run speech:report -- speech-runs-ios-pwa-….json speech-runs-android-….json`
// reads the JSON the page `#/dev/speech` hands out and prints, per engine × phone: the match of the reading with the
// reference (%), dangerous errors, lost phrases, latency from the last word to the final text (median, worst), seconds
// of open Soniox socket per phrase — then the rule fixed before the run, per phone. `--json` prints it as JSON instead.
// The measure itself is src/domain/speechCorpus.ts (unit-tested); this file only reads files and prints. Node runs it as
// TypeScript; the app's modules are loaded through Vite, as the app sees them.
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
import { parse } from 'yaml';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) { console.error('usage: npm run speech:report -- <speech-runs-….json> [more.json] [--json]'); process.exit(2); }

const vite = await createServer({ configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const m = await vite.ssrLoadModule('/src/domain/speechCorpus.ts') as typeof import('../src/domain/speechCorpus');
  const corpus = parse(readFileSync(new URL('../tests/fixtures/speech-corpus.yaml', import.meta.url), 'utf8')) as import('../src/domain/speechCorpus').CorpusPhrase[];
  const runs = files.flatMap((f) => (JSON.parse(readFileSync(f, 'utf8')) as { runs: import('../src/domain/speechCorpus').SpeechRun[] }).runs);
  const rows = m.report(runs, corpus), decisions = m.decide(rows);
  const byId = new Map(corpus.map((p) => [p.id, p]));
  const misses = runs.filter((r) => byId.has(r.phrase) && r.text.trim()).map((r) => ({ r, v: m.judge(byId.get(r.phrase)!, r.text) })).filter((x) => !x.v.same);
  if (asJson) {
    console.log(JSON.stringify({ rows, decisions, misses: misses.map(({ r, v }) => ({ phrase: r.phrase, engine: r.engine, platform: r.platform, text: r.text, dangerous: v.dangerous })) }, null, 1));
  } else {
    const ms = (x: number | null) => (x === null ? '—' : `${(x / 1000).toFixed(2)} с`);
    console.log(`Записів: ${runs.length} з ${files.length} файлів\n`);
    console.log('| рушій | телефон | записів | збіг розбору | небезпечних | втрачено | затримка, медіана | найгірша | сокет, с на фразу |');
    console.log('|---|---|---|---|---|---|---|---|---|');
    for (const r of rows) console.log(`| ${r.engine} | ${r.platform} | ${r.runs} | ${r.matchPct ?? '—'} % | ${r.dangerous} | ${r.lost} | ${ms(r.latencyMedianMs)} | ${ms(r.latencyWorstMs)} | ${r.socketSecondsPerPhrase ?? '—'} |`);
    console.log('\nПравило (≥ 90 %, небезпечних не більше, ніж у телефона, медіана ≤ 1,5 с):');
    for (const d of decisions) console.log(`- ${d.platform}: ${d.soniox ? 'Soniox за замовчуванням' : 'лишається телефон'} — ${d.why}`);
    if (misses.length) {
      console.log('\nНе збіглося:');
      for (const { r, v } of misses) console.log(`- ${r.engine} · ${r.platform} · ${r.phrase}: «${r.text}»${v.dangerous.length ? ` — НЕБЕЗПЕЧНО: ${v.dangerous.join(', ')}` : ''}`);
    }
  }
} finally {
  await vite.close();
}
