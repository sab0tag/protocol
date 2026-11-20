// D201: the eval corpus through the Message Batches API — every case on every model asked for, built by the server's own request
// builders (`*Opts` → `batchParamsOf`: the same bytes as a live call, without the fallback batches do not take). Half the price,
// and NEVER the production key: the key is read from ~/.protocol-keys/anthropic-eval only (its own workspace with its own spend
// limit); ANTHROPIC_API_KEY in the environment is ignored on purpose.
//
//   node scripts/evalBatch.ts [--dry] [--layout old] [--models claude-opus-5-5,claude-sonnet-5-5] [--only chat,notFound,menu,workout,photo,label]
//                             [--resume <batch id>]
// Input: ../eval-results/batch/inputs.json (tests/eval/batch/inputs.eval.ts) and the photos (see `photos()` below).
// Output: ../eval-results/batch/results-<batch id>.json — one row per request: the parsed answer, the stop reason, the tokens.
import Anthropic from '@anthropic-ai/sdk';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { batchParamsOf, parseOutput, type StructuredOpts } from '../src/claude.ts';
import { chatOpts, type ChatInput } from '../src/chat.ts';
import { notFoundOpts } from '../src/concierge.ts';
import { labelOpts } from '../src/label.ts';
import { menuOpts, type MenuInput } from '../src/menu.ts';
import { photoOpts } from '../src/photo.ts';
import { workoutOpts, type WorkoutInput } from '../src/workout.ts';
import type { z } from 'zod';

const ROOT = new URL('../../', import.meta.url).pathname;
const OUT = join(ROOT, 'eval-results/batch');
const KEY_FILE = join(homedir(), '.protocol-keys/anthropic-eval');
/** The efforts production runs with (main.ts and the server's .env, 20.11): the comparison is of the models, not of the settings. */
const EFFORT = { chat: 'low', notFound: 'low', menu: 'medium', workout: 'low', photo: 'low', label: 'low' } as const;
export type Kind = keyof typeof EFFORT;

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const models = (arg('models') ?? 'claude-opus-5-5,claude-sonnet-5-5').split(',');
const only = new Set((arg('only') ?? Object.keys(EFFORT).join(',')).split(','));
const short = (m: string) => m.replace(/^claude-/, '').replace(/[^a-z0-9]/g, '');

function evalClient(): Anthropic {
  if (!existsSync(KEY_FILE)) throw new Error(`no eval key: ${KEY_FILE} (its own workspace with a spend limit — never the production key)`);
  const apiKey = readFileSync(KEY_FILE, 'utf8').trim();
  if (!apiKey.startsWith('sk-ant-')) throw new Error(`${KEY_FILE} does not hold an Anthropic key`);
  return new Anthropic({ apiKey, authToken: null, maxRetries: 3 });
}

/** Photos as the app sends them: JPEG, the long side at most 1600 px (sips, macOS). Food — ~/protocol-eval-photos/food;
 *  labels — ~/protocol-eval-photos/labels and the generated ones in tests/fixtures/eval-labels (with truth.json). */
function photos(dir: string): { id: string; image: string }[] {
  if (!existsSync(dir)) return [];
  const tmp = join(OUT, 'img'); mkdirSync(tmp, { recursive: true });
  return readdirSync(dir).filter((f) => /\.(jpe?g|png|heic|webp)$/i.test(f)).sort().map((f) => {
    const out = join(tmp, `${basename(dir)}-${f.replace(/\.[^.]+$/, '')}.jpg`);
    execFileSync('sips', ['-s', 'format', 'jpeg', '-Z', '1600', join(dir, f), '--out', out], { stdio: 'ignore' });
    return { id: f.replace(/\.[^.]+$/, ''), image: readFileSync(out).toString('base64') };
  });
}

interface Case { kind: Kind; id: string; opts: (model: string) => StructuredOpts<z.ZodType> }
function cases(): Case[] {
  const input = JSON.parse(readFileSync(join(OUT, 'inputs.json'), 'utf8')) as {
    chat: { id: string; input: ChatInput }[]; notFound: { id: string; text: string; names: string[] }[];
    menu: { id: string; input: MenuInput }[]; workout: { id: string; input: WorkoutInput }[] };
  const o = (kind: Kind) => (model: string) => ({ model, effort: EFFORT[kind] });
  const foods = input.menu[0]?.input.foods ?? [], dishes = input.menu[0]?.input.dishes ?? [];
  const all: Case[] = [
    ...input.chat.map((c) => ({ kind: 'chat' as const, id: c.id, opts: (m: string) => chatOpts(o('chat')(m), c.input) })),
    ...input.notFound.map((c) => ({ kind: 'notFound' as const, id: c.id, opts: (m: string) => notFoundOpts(o('notFound')(m), c.text, c.names) })),
    ...input.menu.map((c) => ({ kind: 'menu' as const, id: c.id, opts: (m: string) => menuOpts(o('menu')(m), c.input) })),
    ...input.workout.map((c) => ({ kind: 'workout' as const, id: c.id, opts: (m: string) => workoutOpts(o('workout')(m), c.input) })),
    ...photos(join(homedir(), 'protocol-eval-photos/food')).map((p) => ({ kind: 'photo' as const, id: p.id,
      opts: (m: string) => photoOpts(o('photo')(m), { image: p.image, foods, dishes }) })),
    ...[...photos(join(homedir(), 'protocol-eval-photos/labels')), ...photos(join(ROOT, 'tests/fixtures/eval-labels'))]
      .map((p) => ({ kind: 'label' as const, id: p.id, opts: (m: string) => labelOpts(o('label')(m), p.image) })),
  ];
  return all.filter((c) => only.has(c.kind)) as Case[];
}

const customId = (c: Case, i: number, model: string) => `${c.kind}-${i}-${short(model)}`.slice(0, 64);
const layout = arg('layout') === 'old' ? 'old' : 'new';
/** D201 «before»: the request as it was before the cache marks — the instructions as a plain string with no breakpoint, and for
 *  the assistant, the concierge and the workout the long list inside the question (menu and photo already had their cached
 *  reference, D123, so they stay as they are). Only for measuring the cache; the answers are the same task. */
function legacy(kind: Kind, p: ReturnType<typeof batchParamsOf>): ReturnType<typeof batchParamsOf> | Record<string, unknown> {
  if (!['chat', 'notFound', 'workout'].includes(kind)) return p;
  const [instructions, reference] = p.system;
  const content = p.messages[0]!.content;
  return { ...p, system: instructions!.text, messages: [{ role: 'user', content: typeof content === 'string' && reference ? `${content}\n\n${reference.text}` : content }] };
}

async function main() {
  const list = cases();
  const requests = list.flatMap((c, i) => models.map((model) => {
    const params = batchParamsOf(c.opts(model));
    return { custom_id: customId(c, i, model), params: layout === 'old' ? legacy(c.kind, params) : params };
  }));
  if (process.argv.includes('--dry')) { // what would go: no key, no network
    const n = new Map<string, number>(); for (const c of list) n.set(c.kind, (n.get(c.kind) ?? 0) + 1);
    const by = [...n].map(([k, v]) => `${k} ${v}`).join(', ');
    console.log(`${requests.length} requests (${list.length} cases × ${models.length} models): ${by}; ${Math.round(JSON.stringify(requests).length / 1024)} KB`);
    writeFileSync(join(OUT, 'dry-requests.json'), JSON.stringify(requests.slice(0, 2), null, 1));
    return;
  }
  const client = evalClient();
  let id = arg('resume');
  if (!id) {
    // the params carry the same types the live call uses; the batch endpoint takes them as plain JSON
    const batch = await client.messages.batches.create({ requests: requests as never });
    id = batch.id;
    writeFileSync(join(OUT, `batch-${id}.json`), JSON.stringify({ id, layout, models, kinds: [...only], cases: list.map((c) => [c.kind, c.id]), at: new Date().toISOString() }));
    console.log(`batch ${id} (${layout} layout): ${requests.length} requests (${list.length} cases × ${models.length} models)`);
  }
  for (;;) {
    const b = await client.messages.batches.retrieve(id);
    console.log(`${new Date().toISOString().slice(11, 19)} ${b.processing_status} — ${JSON.stringify(b.request_counts)}`);
    if (b.processing_status === 'ended') break;
    await new Promise((r) => setTimeout(r, 30_000));
  }
  const byId = new Map(list.flatMap((c, i) => models.map((m) => [customId(c, i, m), { c, m }] as const)));
  const rows: unknown[] = [];
  for await (const r of await client.messages.batches.results(id)) {
    const hit = byId.get(r.custom_id);
    if (!hit) continue;
    const base = { custom_id: r.custom_id, kind: hit.c.kind, case: hit.c.id, model: hit.m, layout };
    if (r.result.type !== 'succeeded') { rows.push({ ...base, status: r.result.type, error: r.result.type === 'errored' ? r.result.error : undefined }); continue; }
    const msg = r.result.message;
    const text = msg.content.flatMap((x) => (x.type === 'text' ? [x.text] : [])).join('');
    rows.push({ ...base, status: 'succeeded', stop_reason: msg.stop_reason, served: msg.model, usage: msg.usage,
      parsed: msg.stop_reason === 'refusal' ? 'refused' : parseOutput(hit.c.opts(hit.m).schema, text) ?? null, ...(msg.stop_reason === 'end_turn' ? {} : { text }) });
  }
  writeFileSync(join(OUT, `${layout === 'old' ? 'before' : 'results'}-${id}.json`), JSON.stringify(rows, null, 1));
  console.log(`results-${id}.json: ${rows.length} rows`);
}

await main();
