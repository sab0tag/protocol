// D101, D103: the prescriptions corpus, live — each row three times against the real server and model, through the same
// reading the app does (`draftLines`). Not in `npm test` (network, a model, money): `npm run eval:prescriptions`.
// The hard rule of the corpus: a wrong dose or a medicine shown as ✓ that is not on the paper fails the row, whatever
// else is right; a wrong line marked «?» is allowed — the person checks it. Uses a throwaway vault of its own.
import { expect, test } from 'vitest';
import { parse } from 'yaml';
import corpus from '../fixtures/prescription-cases/cases.yaml?raw';
import { draftLines, type DraftLine } from '../../src/domain/conclusion';
import { fold } from '../../src/domain/meds';
import { conclusion, createVault } from '../../src/sync/api';
import { deriveKeys, newCode, parseCode } from '../../src/sync/crypto';

interface Med { title: string; dose: string; perDay?: number; durationDays?: number | null; asNeeded?: boolean; withFood?: boolean; suggested?: string[]; until?: string }
interface Row { id: string; pages: string[]; date?: string; medicines: Med[]; diet?: string; limits?: string[]; visit?: string; tests?: number | [number, number];
  absent?: string[]; status: 'fixed' | 'open' }
const RUNS = 3;
const files = import.meta.glob('../fixtures/prescription-cases/*.jpg', { query: '?inline', import: 'default', eager: true }) as Record<string, string>;
const page = (name: string) => files[`../fixtures/prescription-cases/${name}`]!.replace(/^data:image\/jpeg;base64,/, '');
const dose = (s: string | undefined) => fold(s ?? '').replace(/\s+/g, '').replace(/[.]/g, '');

function check(row: Row, lines: DraftLine[], raw: string): string[] {
  const bad: string[] = [];
  const meds = lines.flatMap((l) => (l.kind === 'prescription' && l.prescription.kind !== 'test' ? [l] : []));
  for (const l of meds) { // the hard rule: nothing shown as ✓ that is not on the paper, no ✓ with a wrong dose
    const m = row.medicines.find((x) => fold(l.prescription.title).startsWith(fold(x.title)));
    if (!m && l.status === 'sure') bad.push(`✓ препарат, якого немає на папері: ${l.prescription.title}`);
    if (m && l.status === 'sure' && dose(l.prescription.dose) !== dose(m.dose)) bad.push(`✓ з невірною дозою: ${l.prescription.title} ${l.prescription.dose} (на папері ${m.dose})`);
  }
  for (const m of row.medicines) {
    const l = meds.find((x) => fold(x.prescription.title).startsWith(fold(m.title)));
    if (!l) { bad.push(`не прочитано: ${m.title}`); continue; }
    const p = l.prescription;
    if (l.status === 'check') continue; // «?» — the person checks it
    if (m.asNeeded !== undefined && !!p.asNeeded !== m.asNeeded) bad.push(`${m.title}: за потреби ${!!p.asNeeded}`);
    if (m.withFood !== undefined && p.schedule?.withFood !== m.withFood) bad.push(`${m.title}: їжа ${p.schedule?.withFood}`);
    if (m.suggested && JSON.stringify(p.schedule?.times) !== JSON.stringify(m.suggested)) bad.push(`${m.title}: час ${p.schedule?.times.join(', ')}`);
    if (m.until !== undefined && p.until !== m.until) bad.push(`${m.title}: курс до ${p.until}`);
    if (m.durationDays === null && p.until) bad.push(`${m.title}: курс до ${p.until}, а строку немає`);
  }
  const diet = lines.find((l) => l.kind === 'constraint' && l.constraint.tag === 'diet');
  if (row.diet && (diet?.kind !== 'constraint' || diet.constraint.diet !== row.diet)) bad.push(`дієта: ${diet?.kind === 'constraint' ? diet.constraint.diet : '—'}`);
  for (const tag of row.limits ?? []) if (!lines.some((l) => l.kind === 'constraint' && l.constraint.tag === tag)) bad.push(`немає обмеження ${tag}`);
  const visit = lines.find((l) => l.kind === 'checkup');
  if (row.visit && (visit?.kind !== 'checkup' || visit.date !== row.visit)) bad.push(`візит: ${visit?.kind === 'checkup' ? visit.date : '—'}`);
  const tests = lines.filter((l) => l.kind === 'prescription' && l.prescription.kind === 'test').length;
  const [lo, hi] = Array.isArray(row.tests) ? row.tests : [row.tests, row.tests];
  if (lo !== undefined && (tests < lo || tests > hi!)) bad.push(`аналізів ${tests}, мало бути ${lo === hi ? lo : `${lo}–${hi}`}`);
  for (const a of row.absent ?? []) if (raw.includes(a)) bad.push(`у відповіді є «${a}»`);
  return bad;
}

test('the prescriptions corpus, live, three runs a row', async () => {
  const keys = await deriveKeys(parseCode(newCode())!);
  await createVault(keys);
  let failed = 0;
  for (const row of parse(corpus) as Row[]) {
    const bad: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      const t0 = Date.now();
      const r = await conclusion(keys, row.pages.map(page));
      const today = row.date ?? '2026-10-19';
      const lines = draftLines(r, () => crypto.randomUUID(), { pages: row.pages.length, today });
      const b = check(row, lines, JSON.stringify(r));
      bad.push(...b.map((x) => `#${i + 1} ${x}`));
      if (i === 0) console.log(`  ${row.id}: ${lines.length} рядків, ${Math.round((Date.now() - t0) / 1000)} с`);
    }
    const ok = bad.length === 0;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${row.status} ${row.id}${ok ? '' : `\n    ${bad.join('\n    ')}`}`);
    if (!ok && row.status === 'fixed') failed++;
    if (ok && row.status === 'open') { console.log(`    ${row.id} проходить ${RUNS}/${RUNS} — переведіть у fixed`); failed++; }
  }
  expect(failed).toBe(0);
}, 600_000);
