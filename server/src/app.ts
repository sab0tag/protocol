// HTTP API (SPEC.md D31, D32). A vault is created by the first device: its id and auth key are derived from the
// sync code on the device; the server keeps only a hash of the auth key and never the code or the encryption key.
import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import type { MenuMaker } from './menu.ts';
import type { WorkoutMaker } from './workout.ts';
import type { LabsReader } from './labs.ts';
import type { ConclusionReader } from './conclusion.ts';
import type { MedboxReader } from './medbox.ts';
import { PROMPT_NOT_FOUND, userLabel, type NotFoundReader } from './concierge.ts';
import { randomBytes } from 'node:crypto';
import type { Usage } from './photo.ts';
import type { LabelReader } from './label.ts';
import type { Recognizer } from './photo.ts';
import type { Sender } from './push.ts';
import type { Store } from './store.ts';

export interface Limits {
  vaultsPerIpPerDay: number;
  vaultBytes: number;
  photosPerVaultPerDay: number;
  photosPerDay: number;
  menusPerVaultPerDay: number;
  workoutsPerVaultPerDay: number; // D63
  conciergePerVaultPerDay: number; // D91
  aiPerDay: number; // D94: all text AI calls of the server together (menu, workout, concierge) — a ceiling on spend
}

export const DEFAULT_LIMITS: Limits = { vaultsPerIpPerDay: 5, vaultBytes: 50_000_000, photosPerVaultPerDay: 30, photosPerDay: 150, menusPerVaultPerDay: 15, workoutsPerVaultPerDay: 10, conciergePerVaultPerDay: 60, aiPerDay: 800 };

export interface Deps {
  store: Store;
  recognize?: Recognizer; // absent = photos are off (no API key)
  menu?: MenuMaker; // the same
  workout?: WorkoutMaker; // D63: the same
  labs?: LabsReader; // D68: the same
  conclusion?: ConclusionReader; // D80: a doctor's conclusion — the same
  medbox?: MedboxReader; // D89: a medicine package — the same
  notFound?: NotFoundReader; // D91: the concierge, scenario 1
  conciergeModel?: string; // D91: written into the log's versions
  label?: LabelReader; // the same (D45)
  push?: { publicKey: string; send: Sender };
  backupAgeH?: () => number | null;
  backups?: { list: () => string[]; records: (name: string, vault: string) => { k: string; v: string | null; seq: number }[] | null };
  origins: string[];
  limits?: Limits;
  now?: () => Date;
}

const VAULT = /^[0-9a-f]{32}$/;
const KEY = /^[A-Za-z0-9_-]{16,64}$/;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const PAGE = 1000;
const MAX_IMAGE = 2_000_000; // decoded bytes; the app sends ~1280 px JPEG of 150–400 KB

/** $ per million tokens, input / output (D36: an estimate; the Anthropic console has the real bill). */
const PRICES: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20], 'claude-opus-5': [5, 25], 'claude-opus-4-8': [5, 25], 'claude-opus-4-7': [5, 25],
  'claude-sonnet-5-5': [2, 10], 'claude-sonnet-5': [2, 10], 'claude-sonnet-4-6': [3, 15], 'claude-haiku-4-5': [1, 5],
};
export const usdMicro = (u: Usage) => {
  const [i, o] = PRICES[u.model] ?? PRICES[Object.keys(PRICES).find((k) => u.model.startsWith(k)) ?? ''] ?? [5, 25];
  return u.input * i + u.output * o; // tokens × $/M = micro-dollars
};

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

export function createApp(deps: Deps) {
  const { store, recognize, menu, origins } = deps;
  const limits = deps.limits ?? DEFAULT_LIMITS;
  /** Strings from a request, the same rule in every route: only non-empty strings, each cut to `len`, at most `max`. */
  const list = (x: unknown, max: number, len: number) =>
    (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string' && s.trim() !== '').map((s) => s.slice(0, len)).slice(0, max) : []);
  const str = (x: unknown, len: number) => (typeof x === 'string' ? x.slice(0, len) : '');
  const now = deps.now ?? (() => new Date());
  const app = new Hono();
  const ai = { lastOk: 0, lastError: 0 };
  const spent = (vault: string, kind: string, usage?: Usage) => { if (usage) store.addUsage(vault, kind, usdMicro(usage), now()); };

  app.use('*', cors({ origin: origins, allowMethods: ['GET', 'POST', 'PUT', 'DELETE'], allowHeaders: ['Authorization', 'Content-Type'], maxAge: 86400 }));
  const DEVICE = /^[0-9a-f]{32}$/;
  /** D40: the server POSTs to a subscription's endpoint — only to the browsers' own push services, never to an
   *  address someone typed (that would let anyone make this server call any host). */
  const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^web\.push\.apple\.com$/, /\.push\.apple\.com$/,
    /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];
  const pushEndpoint = (u: string) => {
    try { const url = new URL(u); return url.protocol === 'https:' && !url.port && PUSH_HOSTS.some((h) => h.test(url.hostname)); } catch { return false; }
  };
  const RID = /^[A-Za-z0-9_-]{16,64}$/;

  app.get('/v1/push/key', (c) => (deps.push ? c.json({ key: deps.push.publicKey }) : c.json({ error: 'push_off' }, 503)));

  /** A device subscribes (or renews its subscription). */
  app.put('/v1/vaults/:id/devices/:dev', bodyLimit({ maxSize: 10_000 }), async (c) => {
    const id = authed(c);
    if (typeof id !== 'string') return id;
    const dev = c.req.param('dev');
    const b = await c.req.json().catch(() => null) as { subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } } | null;
    const sub = b?.subscription;
    if (!DEVICE.test(dev) || typeof sub?.endpoint !== 'string' || !pushEndpoint(sub.endpoint) || sub.endpoint.length > 1000
      || typeof sub.keys?.p256dh !== 'string' || typeof sub.keys?.auth !== 'string') return c.json({ error: 'bad_request' }, 400);
    if (!store.hasDevice(id, dev) && store.devices(id) >= 8) return c.json({ error: 'too_many' }, 429);
    store.putSub(id, dev, JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }), now().getTime());
    return c.json({ ok: true });
  });

  app.delete('/v1/vaults/:id/devices/:dev', (c) => {
    const id = authed(c);
    if (typeof id !== 'string') return id;
    store.dropDevice(id, c.req.param('dev'));
    return c.json({ ok: true });
  });

  /** The device's schedule for the coming days; `done` — reminders ticked anywhere (no more repeats). */
  app.put('/v1/vaults/:id/devices/:dev/reminders', bodyLimit({ maxSize: 300_000 }), async (c) => {
    const id = authed(c);
    if (typeof id !== 'string') return id;
    const dev = c.req.param('dev');
    if (!store.hasDevice(id, dev)) return c.json({ error: 'not_found' }, 404);
    const b = await c.req.json().catch(() => null) as { items?: unknown; done?: unknown; repeatEvery?: unknown; repeats?: unknown } | null;
    if (!Array.isArray(b?.items) || b.items.length > 500) return c.json({ error: 'bad_request' }, 400);
    const items: { rid: string; at: number; payload: string; once?: boolean }[] = [];
    for (const x of b.items as Record<string, unknown>[]) {
      const p = x.payload as Record<string, unknown> | undefined;
      if (typeof x.rid !== 'string' || !RID.test(x.rid) || typeof x.at !== 'number' || !p || typeof p !== 'object') return c.json({ error: 'bad_request' }, 400);
      const payload = JSON.stringify(p);
      if (payload.length > 600) return c.json({ error: 'bad_request' }, 400);
      items.push({ rid: x.rid, at: Math.round(x.at), payload, ...(x.once === true ? { once: true } : {}) });
    }
    const done = Array.isArray(b.done) ? (b.done as unknown[]).filter((r): r is string => typeof r === 'string' && RID.test(r)).slice(0, 1000) : [];
    const every = Math.min(60, Math.max(5, Number(b.repeatEvery) || 15));
    const repeats = Math.min(3, Math.max(0, Math.round(Number(b.repeats) || 0)));
    store.setReminders(id, dev, items, every, repeats, done, now().getTime());
    return c.json({ ok: true, count: items.length });
  });

  app.post('/v1/vaults/:id/devices/:dev/test', async (c) => {
    const id = authed(c);
    if (typeof id !== 'string') return id;
    const sub = store.sub(id, c.req.param('dev'));
    if (!deps.push || !sub) return c.json({ error: 'not_found' }, 404);
    if (!store.take(`test:${id}`, 20, now())) return c.json({ error: 'too_many' }, 429);
    const r = await deps.push.send(sub, JSON.stringify({ t: 'Протокол', b: 'Нагадування працюють ✓', k: 'test', u: './#/', tag: 'test', n: 0 }));
    return r === 'ok' ? c.json({ ok: true }) : c.json({ error: r }, 502);
  });

  /** D40: a device with the code leaves it here for 10 minutes, sealed with a short one-time pairing code that the
   *  server never sees; the new device takes it once. */
  app.post('/v1/vaults/:id/pair', bodyLimit({ maxSize: 4_000 }), async (c) => {
    const id = authed(c);
    if (typeof id !== 'string') return id;
    const b = await c.req.json().catch(() => null) as { pid?: unknown; blob?: unknown } | null;
    if (typeof b?.pid !== 'string' || !DEVICE.test(b.pid) || typeof b.blob !== 'string' || !B64.test(b.blob) || b.blob.length > 2000) return c.json({ error: 'bad_request' }, 400);
    if (!store.take(`pair:${id}`, 20, now())) return c.json({ error: 'too_many' }, 429);
    const t0 = now().getTime();
    store.putPair(b.pid, b.blob, t0 + 10 * 60_000, t0);
    return c.json({ ok: true });
  });

  app.get('/v1/pair/:pid', (c) => {
    const pid = c.req.param('pid');
    if (!DEVICE.test(pid)) return c.json({ error: 'bad_request' }, 400);
    if (!store.take(`pairget:${ip(c)}`, 30, now())) return c.json({ error: 'too_many' }, 429);
    const blob = store.takePair(pid, now().getTime());
    return blob ? c.json({ blob }) : c.json({ error: 'not_found' }, 404);
  });

  /** D44: the vault's records as they were in a nightly copy — still sealed; only the person's device can open them
   *  (to find an earlier plan after a sync mishap). */
  app.get('/v1/vaults/:id/backups', (c) => {
    const id = authed(c);
    if (typeof id !== 'string') return id;
    return c.json({ backups: deps.backups?.list() ?? [] });
  });

  app.get('/v1/vaults/:id/backups/:name', (c) => {
    const id = authed(c);
    if (typeof id !== 'string') return id;
    const name = c.req.param('name');
    if (!/^protocol-\d{4}-\d{2}-\d{2}\.db\.gz$/.test(name)) return c.json({ error: 'bad_request' }, 400);
    if (!store.take(`backupread:${id}`, 30, now())) return c.json({ error: 'too_many' }, 429);
    const records = deps.backups?.records(name, id);
    return records ? c.json({ records }) : c.json({ error: 'not_found' }, 404);
  });

  /** D45: a package's nutrition table → a food per 100 g, for the person to check and save. Counts as a photo. */
  app.post('/v1/vaults/:id/label', bodyLimit({ maxSize: 3_500_000, onError: (c) => c.json({ error: 'too_large' }, 413) }), async (c) => {
    const id = authed(c);
    if (typeof id !== 'string') return id;
    if (!deps.label) return c.json({ error: 'photo_off' }, 503);
    const body = await c.req.json().catch(() => null) as { image?: unknown } | null;
    const image = body?.image;
    if (typeof image !== 'string' || !B64.test(image)) return c.json({ error: 'bad_request' }, 400);
    const bytes = Buffer.from(image, 'base64');
    if (bytes.length > MAX_IMAGE || bytes[0] !== 0xff || bytes[1] !== 0xd8) return c.json({ error: 'bad_image' }, 400);
    const at = now();
    if (!store.take('photo:all', limits.photosPerDay, at) || !store.take(`photo:${id}`, limits.photosPerVaultPerDay, at)) return c.json({ error: 'too_many' }, 429);
    try {
      const { result, usage } = await deps.label(image);
      spent(id, 'label', usage);
      ai.lastOk = Date.now();
      if (result === 'refused') return c.json({ error: 'refused' }, 422);
      return c.json(result);
    } catch (e) {
      ai.lastError = Date.now();
      console.error('label failed:', (e as Error).message);
      return c.json({ error: 'upstream' }, 502);
    }
  });

  // D68: a lab results form — counted with photos
  app.post('/v1/vaults/:id/labs', bodyLimit({ maxSize: 3_500_000, onError: (c) => c.json({ error: 'too_large' }, 413) }), async (c) => {
    const id = authed(c);
    if (typeof id !== 'string') return id;
    if (!deps.labs) return c.json({ error: 'photo_off' }, 503);
    const body = await c.req.json().catch(() => null) as { image?: unknown; names?: unknown } | null;
    const image = body?.image;
    if (typeof image !== 'string' || !B64.test(image)) return c.json({ error: 'bad_request' }, 400);
    const bytes = Buffer.from(image, 'base64');
    if (bytes.length > MAX_IMAGE || bytes[0] !== 0xff || bytes[1] !== 0xd8) return c.json({ error: 'bad_image' }, 400);
    const at = now();
    if (!store.take('photo:all', limits.photosPerDay, at) || !store.take(`photo:${id}`, limits.photosPerVaultPerDay, at)) return c.json({ error: 'too_many' }, 429);
    try {
      const { result, usage } = await deps.labs(image, list(body?.names, 100, 80));
      spent(id, 'labs', usage);
      ai.lastOk = Date.now();
      if (result === 'refused') return c.json({ error: 'refused' }, 422);
      return c.json(result);
    } catch (e) {
      ai.lastError = Date.now();
      console.error('labs failed:', (e as Error).message);
      return c.json({ error: 'upstream' }, 502);
    }
  });

  // D80: a doctor's conclusion → a draft of the plan — counted with photos
  app.post('/v1/vaults/:id/conclusion', bodyLimit({ maxSize: 3_500_000, onError: (c) => c.json({ error: 'too_large' }, 413) }), async (c) => {
    const id = authed(c);
    if (typeof id !== 'string') return id;
    if (!deps.conclusion) return c.json({ error: 'photo_off' }, 503);
    const body = await c.req.json().catch(() => null) as { image?: unknown } | null;
    const image = body?.image;
    if (typeof image !== 'string' || !B64.test(image)) return c.json({ error: 'bad_request' }, 400);
    const bytes = Buffer.from(image, 'base64');
    if (bytes.length > MAX_IMAGE || bytes[0] !== 0xff || bytes[1] !== 0xd8) return c.json({ error: 'bad_image' }, 400);
    const at = now();
    if (!store.take('photo:all', limits.photosPerDay, at) || !store.take(`photo:${id}`, limits.photosPerVaultPerDay, at)) return c.json({ error: 'too_many' }, 429);
    try {
      const { result, usage } = await deps.conclusion(image);
      spent(id, 'conclusion', usage);
      ai.lastOk = Date.now();
      if (result === 'refused') return c.json({ error: 'refused' }, 422);
      return c.json(result);
    } catch (e) {
      ai.lastError = Date.now();
      console.error('conclusion failed:', (e as Error).message);
      return c.json({ error: 'upstream' }, 502);
    }
  });

  // D89: a medicine package → its name and strength — counted with photos
  app.post('/v1/vaults/:id/medbox', bodyLimit({ maxSize: 3_500_000, onError: (c) => c.json({ error: 'too_large' }, 413) }), async (c) => {
    const id = authed(c);
    if (typeof id !== 'string') return id;
    if (!deps.medbox) return c.json({ error: 'photo_off' }, 503);
    const body = await c.req.json().catch(() => null) as { image?: unknown } | null;
    const image = body?.image;
    if (typeof image !== 'string' || !B64.test(image)) return c.json({ error: 'bad_request' }, 400);
    const bytes = Buffer.from(image, 'base64');
    if (bytes.length > MAX_IMAGE || bytes[0] !== 0xff || bytes[1] !== 0xd8) return c.json({ error: 'bad_image' }, 400);
    const at = now();
    if (!store.take('photo:all', limits.photosPerDay, at) || !store.take(`photo:${id}`, limits.photosPerVaultPerDay, at)) return c.json({ error: 'too_many' }, 429);
    try {
      const { result, usage } = await deps.medbox(image);
      spent(id, 'medbox', usage);
      ai.lastOk = Date.now();
      if (result === 'refused') return c.json({ error: 'refused' }, 422);
      return c.json(result);
    } catch (e) {
      ai.lastError = Date.now();
      console.error('medbox failed:', (e as Error).message);
      return c.json({ error: 'upstream' }, 502);
    }
  });

  // ---------------------------------------------------------------- the concierge (D91)
  const OUTCOMES = new Set(['accepted', 'edited', 'dismissed', 'snoozed', 'ignored']);
  /** Scenario 1: what a line the base did not find is like — names from the base the app sent, at most 3. Logged only
   *  when the request says the person agreed to the log (a consent of its own, not the sync's). */
  app.post('/v1/vaults/:id/concierge/not-found', bodyLimit({ maxSize: 64_000, onError: (c) => c.json({ error: 'too_large' }, 413) }), async (c) => {
    const id = authed(c);
    if (typeof id !== 'string') return id;
    if (!deps.notFound) return c.json({ error: 'ai_off' }, 503);
    const body = await c.req.json().catch(() => null) as { text?: unknown; names?: unknown; log?: unknown; versions?: unknown; context?: unknown } | null;
    const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 200) : '';
    const names = list(body?.names, 600, 80);
    if (!text || !names.length) return c.json({ error: 'bad_request' }, 400);
    const at = now();
    if (!store.take(`concierge:${id}`, limits.conciergePerVaultPerDay, at) || !store.take('ai:all', limits.aiPerDay, at)) return c.json({ error: 'too_many' }, 429);
    const started = Date.now();
    try {
      const { result, usage } = await deps.notFound(text, names);
      spent(id, 'concierge', usage);
      ai.lastOk = Date.now();
      if (result === 'refused') return c.json({ error: 'refused' }, 422);
      const known = new Set(names);
      const candidates = [...new Set(result.candidates)].filter((n) => known.has(n)).slice(0, 3); // the code's check on the way out
      let logId: string | undefined;
      if (body?.log === true) {
        logId = `c-${at.toISOString().slice(0, 10)}-${randomBytes(3).toString('hex')}`;
        const v = (body.versions ?? {}) as Record<string, unknown>;
        store.logConcierge(logId, id, at.getTime(), 'not_found', {
          id: logId, ts: at.toISOString(), user: userLabel(id), scenario: 'not_found',
          versions: { app: String(v.app ?? '').slice(0, 40), model: deps.conciergeModel ?? '', prompt: PROMPT_NOT_FOUND, plan: String(v.plan ?? '').slice(0, 40) },
          context: typeof body.context === 'object' && body.context ? body.context : {}, input: text,
          output: { items: candidates.map((name) => ({ name })) },
          checker: { from_db: result.candidates.every((n) => known.has(n)), count: result.candidates.length, numbers_match: true },
          latency_ms: Date.now() - started,
        });
      }
      return c.json({ candidates, ...(logId ? { id: logId } : {}) });
    } catch (e) {
      ai.lastError = Date.now();
      console.error('concierge failed:', (e as Error).message);
      return c.json({ error: 'upstream' }, 502);
    }
  });
  app.post('/v1/vaults/:id/concierge/outcome', bodyLimit({ maxSize: 4_000 }), async (c) => {
    const id = authed(c);
    if (typeof id !== 'string') return id;
    const body = await c.req.json().catch(() => null) as { id?: unknown; outcome?: unknown; edit?: unknown } | null;
    if (typeof body?.id !== 'string' || typeof body.outcome !== 'string' || !OUTCOMES.has(body.outcome)) return c.json({ error: 'bad_request' }, 400);
    return c.json({ ok: store.conciergeOutcome(id, body.id, body.outcome, body.edit) });
  });
  /** The person's own log — to look at, and to delete in one tap. */
  app.get('/v1/vaults/:id/concierge/log', (c) => {
    const id = authed(c);
    if (typeof id !== 'string') return id;
    return c.json(store.conciergeLog(id).map((r) => ({ ...JSON.parse(r.record), outcome: r.outcome, ...(r.edit ? { edit: JSON.parse(r.edit) } : {}) })));
  });
  app.delete('/v1/vaults/:id/concierge/log', (c) => {
    const id = authed(c);
    if (typeof id !== 'string') return id;
    return c.json({ deleted: store.deleteConciergeLog(id) });
  });

  /** This month's AI use of the vault: calls and an estimate in dollars (D36). */
  app.get('/v1/vaults/:id/usage', (c) => {
    const id = authed(c);
    if (typeof id !== 'string') return id;
    const month = now().toISOString().slice(0, 7);
    const rows = store.usage(id, month);
    return c.json({ month, kinds: Object.fromEntries(rows.map((r) => [r.kind, r.calls])),
      usd: Math.round(rows.reduce((s, r) => s + r.usd_micro, 0) / 10_000) / 100 });
  });

  app.get('/health', (c) => c.json({ ok: true, photo: !!recognize, menu: !!menu, workout: !!deps.workout, labs: !!deps.labs, conclusion: !!deps.conclusion, medbox: !!deps.medbox, concierge: !!deps.notFound, label: !!deps.label, push: !!deps.push,
    ai: { lastOk: ai.lastOk || null, lastError: ai.lastError || null, failing: ai.lastError > ai.lastOk },
    backupAgeH: deps.backupAgeH?.() ?? null }));

  const token = (c: Context) => c.req.header('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{40,64})$/)?.[1];
  // D94: the address the proxy (Caddy) saw — the last one in the chain; a client can prepend any value but not this one
  const ip = (c: Context) => c.req.header('X-Forwarded-For')?.split(',').at(-1)?.trim() || 'unknown';

  /** 401 for a wrong key, 404 for an unknown vault: the app tells «код не знайдено» from «помилка». */
  const authed = (c: Context): string | Response => {
    const id = c.req.param('id') ?? '';
    const t = token(c);
    if (!VAULT.test(id) || !t) return c.json({ error: 'bad_request' }, 400);
    const stored = store.vaultAuth(id);
    if (!stored) return c.json({ error: 'not_found' }, 404);
    const a = Buffer.from(stored, 'hex'), b = Buffer.from(hash(t), 'hex');
    const ok = a.length === b.length && timingSafeEqual(a, b);
    return ok ? id : c.json({ error: 'unauthorized' }, 401);
  };

  app.put('/v1/vaults/:id', (c) => {
    const id = c.req.param('id');
    const t = token(c);
    if (!VAULT.test(id) || !t) return c.json({ error: 'bad_request' }, 400);
    if (store.vaultAuth(id)) {
      const r = authed(c);
      return typeof r === 'string' ? c.json({ created: false }) : r;
    }
    if (!store.take(`vault:${ip(c)}`, limits.vaultsPerIpPerDay, now())) return c.json({ error: 'too_many' }, 429);
    store.createVault(id, hash(t), now());
    return c.json({ created: true }, 201);
  });

  app.get('/v1/vaults/:id/records', (c) => {
    const id = authed(c);
    if (typeof id !== 'string') return id;
    const since = Number(c.req.query('since') ?? 0);
    if (!Number.isInteger(since) || since < 0) return c.json({ error: 'bad_request' }, 400);
    const records = store.since(id, since, PAGE);
    return c.json({ records, more: records.length === PAGE, seq: records.at(-1)?.seq ?? Math.max(since, store.latest(id)) });
  });

  app.post('/v1/vaults/:id/records', bodyLimit({ maxSize: 4_000_000, onError: (c) => c.json({ error: 'too_large' }, 413) }), async (c) => {
    const id = authed(c);
    if (typeof id !== 'string') return id;
    const body = await c.req.json().catch(() => null) as { records?: unknown } | null;
    const records = body?.records;
    if (!Array.isArray(records) || records.length === 0 || records.length > 500) return c.json({ error: 'bad_request' }, 400);
    let add = 0;
    for (const r of records as { k?: unknown; v?: unknown }[]) {
      if (typeof r.k !== 'string' || !KEY.test(r.k)) return c.json({ error: 'bad_request' }, 400);
      if (r.v !== null && (typeof r.v !== 'string' || !B64.test(r.v))) return c.json({ error: 'bad_request' }, 400);
      add += (r.v as string | null)?.length ?? 0;
    }
    if (store.bytes(id) + add > limits.vaultBytes) return c.json({ error: 'quota' }, 507);
    const seq = store.put(id, records as { k: string; v: string | null }[]);
    return c.json({ seq });
  });

  app.post('/v1/vaults/:id/photo', bodyLimit({ maxSize: 3_500_000, onError: (c) => c.json({ error: 'too_large' }, 413) }), async (c) => {
    const id = authed(c);
    if (typeof id !== 'string') return id;
    if (!recognize) return c.json({ error: 'photo_off' }, 503);
    const body = await c.req.json().catch(() => null) as { image?: unknown; foods?: unknown; dishes?: unknown } | null;
    const image = body?.image;
    if (typeof image !== 'string' || !B64.test(image)) return c.json({ error: 'bad_request' }, 400);
    const bytes = Buffer.from(image, 'base64');
    if (bytes.length > MAX_IMAGE || bytes[0] !== 0xff || bytes[1] !== 0xd8) return c.json({ error: 'bad_image' }, 400);
    const at = now();
    if (!store.take('photo:all', limits.photosPerDay, at) || !store.take(`photo:${id}`, limits.photosPerVaultPerDay, at)) {
      return c.json({ error: 'too_many' }, 429);
    }
    try {
      const { result, usage } = await recognize({ image, foods: list(body?.foods, 400, 80), dishes: list(body?.dishes, 400, 80) });
      spent(id, 'photo', usage);
      ai.lastOk = Date.now();
      if (result === 'refused') return c.json({ error: 'refused' }, 422);
      return c.json(result);
    } catch (e) {
      ai.lastError = Date.now();
      console.error('photo failed:', (e as Error).message);
      return c.json({ error: 'upstream' }, 502);
    }
  });

  app.post('/v1/vaults/:id/menu', bodyLimit({ maxSize: 200_000, onError: (c) => c.json({ error: 'too_large' }, 413) }), async (c) => {
    const id = authed(c);
    if (typeof id !== 'string') return id;
    if (!menu) return c.json({ error: 'ai_off' }, 503);
    const b = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const foods = list(b?.foods, 400, 80);
    const date = typeof b?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : null;
    if (!date || foods.length === 0) return c.json({ error: 'bad_request' }, 400);
    const targets: Record<string, number | string> = {};
    if (b?.targets && typeof b.targets === 'object') {
      for (const [k, v] of Object.entries(b.targets).slice(0, 20)) {
        if (/^[a-zA-Z]{1,30}$/.test(k) && (typeof v === 'number' || (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v)))) targets[k] = v;
      }
    }
    if (!store.take(`menu:${id}`, limits.menusPerVaultPerDay, now()) || !store.take('ai:all', limits.aiPerDay, now())) return c.json({ error: 'too_many' }, 429);
    try {
      const { result, usage } = await menu({ date, targets, rules: list(b?.rules, 30, 300), foods, dishes: list(b?.dishes, 100, 80),
        usual: list(b?.usual, 50, 80), wish: str(b?.wish, 300), avoid: list(b?.avoid, 60, 80) });
      spent(id, 'menu', usage);
      ai.lastOk = Date.now();
      if (result === 'refused') return c.json({ error: 'refused' }, 422);
      return c.json(result);
    } catch (e) {
      ai.lastError = Date.now();
      console.error('menu failed:', (e as Error).message);
      return c.json({ error: 'upstream' }, 502);
    }
  });

  // D63: a session from the library ids the app sends
  app.post('/v1/vaults/:id/workout', bodyLimit({ maxSize: 100_000, onError: (c) => c.json({ error: 'too_large' }, 413) }), async (c) => {
    const id = authed(c);
    if (typeof id !== 'string') return id;
    if (!deps.workout) return c.json({ error: 'ai_off' }, 503);
    const b = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const ids = new Set<string>(); // an id twice would make the schema's enum invalid — the first one is kept
    const exercises = (Array.isArray(b?.exercises) ? b.exercises : []).slice(0, 40).flatMap((e: unknown) => {
      const x = e as Record<string, unknown>;
      if (typeof x?.id !== 'string' || ids.has(x.id)) return [];
      ids.add(x.id);
      return /^[a-z0-9-]{1,40}$/.test(x.id) && typeof x.name === 'string' && [1, 2, 3].includes(x.level as number)
        ? [{ id: x.id, name: x.name.slice(0, 80), level: x.level as number, pattern: str(x.pattern, 20), unilateral: x.unilateral === true, timed: x.timed === true }] : [];
    });
    if (exercises.length < 3) return c.json({ error: 'bad_request' }, 400);
    const history = (Array.isArray(b?.history) ? b.history : []).slice(0, 10).flatMap((h: unknown) => {
      const x = h as Record<string, unknown>;
      return typeof x?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? [{ date: x.date, feeling: str(x.feeling, 30), items: list(x.items, 10, 120) }] : [];
    });
    const minutes = typeof b?.minutes === 'number' ? Math.min(90, Math.max(10, Math.round(b.minutes))) : 35;
    if (!store.take(`workout:${id}`, limits.workoutsPerVaultPerDay, now()) || !store.take('ai:all', limits.aiPerDay, now())) return c.json({ error: 'too_many' }, 429);
    try {
      const { result, usage } = await deps.workout({ exercises, history, rules: list(b?.rules, 30, 300), equipment: str(b?.equipment, 40) || 'Гиря 16 кг',
        minutes, wish: str(b?.wish, 300) });
      spent(id, 'workout', usage);
      ai.lastOk = Date.now();
      if (result === 'refused') return c.json({ error: 'refused' }, 422);
      return c.json(result);
    } catch (e) {
      ai.lastError = Date.now();
      console.error('workout failed:', (e as Error).message);
      return c.json({ error: 'upstream' }, 502);
    }
  });

  return app;
}
