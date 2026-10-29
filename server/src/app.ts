import { mountIdentity, type Identity } from './identity/routes.ts';
// HTTP API (SPEC.md D31, D32). A vault is created by the first device: its id and auth key are derived from the
// sync code on the device; the server keeps only a hash of the auth key and never the code or the encryption key.
import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import type { MenuMaker } from './menu.ts';
import type { DishReader } from './dish.ts';
import { MAX_BATCH, type BatchDish, type DishesReader } from './dishes.ts';
import { checked, PROMPT_CHAT, type ChatReader } from './chat.ts';
import type { WorkoutMaker } from './workout.ts';
import type { LabsReader } from './labs.ts';
import type { ConclusionReader } from './conclusion.ts';
import type { MedboxReader } from './medbox.ts';
import { PROMPT_NOT_FOUND, scrubNames, userLabel, type NotFoundReader } from './concierge.ts';
import { randomBytes } from 'node:crypto';
import type { Usage } from './photo.ts';
import type { LabelReader } from './label.ts';
import type { Recognizer } from './photo.ts';
import type { Sender } from './push.ts';
import type { Store } from './store.ts';
import { parseReminderPolicy } from './reminderPolicy.ts';
import { BudgetGuard } from './ai/budgets.ts';
import { RedeemFailure, type PlanDelivery, type RedeemError } from './clinic/delivery.ts';
import { DatabaseBusy, isBusy } from './db/tx.ts';
import { mountClinic } from './clinic/routes.ts';
import type { ClinicDirectory } from './clinic/directory.ts';
import { latestWeek, parsePilot, PID, SECRET, SRC, weekAdd, weekKey } from './pilot.ts';

/** `used` is one domain error with one status, whether the code was spent long ago or a moment ago by a concurrent call. */
const REDEEM_STATUS: Record<RedeemError, 404 | 409 | 410> = { invalid: 404, used: 409, expired: 410, revoked: 410, tampered: 410 };

export interface Limits {
  vaultsPerIpPerDay: number;
  vaultBytes: number;
  photosPerVaultPerDay: number;
  photosPerDay: number;
  menusPerVaultPerDay: number;
  workoutsPerVaultPerDay: number; // D63
  conciergePerVaultPerDay: number; // D91
  aiPerDay: number; // D94: all text AI calls of the server together (menu, workout, concierge) — a ceiling on spend
  deviceTokensPerIpPerDay: number; // D101
  devicePhotosPerDay: number; // D101: a device without sync
  dishesPerDay: number; // D110: dish breakdowns, a vault or a device
  listDishesPerDay: number; // D123: dishes of a list that went to the model, a vault or a device
  pilotJoinsPerIpPerDay: number; // D119
  aiDayUsdMicro?: number; // cost control: committed + reserved spend of the server per UTC day
  aiMonthUsdMicro?: number; // the same per UTC month
}

export const DEFAULT_LIMITS: Limits = { vaultsPerIpPerDay: 5, vaultBytes: 50_000_000, photosPerVaultPerDay: 30, photosPerDay: 150, menusPerVaultPerDay: 15, workoutsPerVaultPerDay: 10, conciergePerVaultPerDay: 60, aiPerDay: 800, deviceTokensPerIpPerDay: 5, devicePhotosPerDay: 10, dishesPerDay: 20, listDishesPerDay: 50, pilotJoinsPerIpPerDay: 10, aiDayUsdMicro: 25_000_000, aiMonthUsdMicro: 400_000_000 };

export interface Deps {
  identity?: Identity; // same-origin BFF only; disabled unless explicitly configured
  store: Store;
  recognize?: Recognizer; // absent = photos are off (no API key)
  menu?: MenuMaker; // the same
  dish?: DishReader; // D110: a dish described in words → its ingredients
  dishes?: DishesReader; // D123: a list of them, up to 15 at once
  chat?: ChatReader; // D117: the assistant's chat
  workout?: WorkoutMaker; // D63: the same
  labs?: LabsReader; // D68: the same
  conclusion?: ConclusionReader; // D80: a doctor's conclusion — the same
  medbox?: MedboxReader; // D89: a medicine package — the same
  notFound?: NotFoundReader; // D91: the concierge, scenario 1
  conciergeModel?: string; // D91: written into the log's versions
  label?: LabelReader; // the same (D45)
  clinic?: ClinicDirectory; // doctor/admin API; needs planDelivery too
  planDelivery?: PlanDelivery; // clinic plans handed over by one-time code
  push?: { publicKey: string; send: Sender };
  backupAgeH?: () => number | null;
  backups?: { list: () => string[]; records: (name: string, vault: string) => { k: string; v: string | null; seq: number }[] | null };
  origins: string[];
  limits?: Limits;
  /** Kill switch: AI kinds (e.g. 'menu', 'photo') that answer `ai_off` without calling a provider. */
  disabledAi?: readonly string[];
  now?: () => Date;
}

const VAULT = /^[0-9a-f]{32}$/;
const KEY = /^[A-Za-z0-9_-]{16,64}$/;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const PAGE = 1000;
const MAX_IMAGE = 2_000_000; // decoded bytes; the app sends ~1280 px JPEG of 150–400 KB

/** $ per million tokens, input / output (D36: an estimate; the Anthropic console has the real bill); a cache read — 0.1× input
 *  unless the model's own price is given (D123: $0.20 on Opus 5.5), a 5-minute cache write — 1.25× input. */
const READ: Record<string, number> = { 'claude-opus-5-5': 0.2, 'claude-sonnet-5-5': 0.2 };
const PRICES: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20], 'claude-opus-5': [5, 25], 'claude-opus-4-8': [5, 25], 'claude-opus-4-7': [5, 25],
  'claude-sonnet-5-5': [2, 10], 'claude-sonnet-5': [2, 10], 'claude-sonnet-4-6': [3, 15], 'claude-haiku-4-5': [1, 5],
};
export const usdMicro = (u: Usage) => {
  const [i, o] = PRICES[u.model] ?? PRICES[Object.keys(PRICES).find((k) => u.model.startsWith(k)) ?? ''] ?? [5, 25];
  const key = Object.keys(READ).find((k) => u.model.startsWith(k));
  const read = key ? READ[key]! : i * 0.1;
  return u.input * i + (u.cacheWrite ?? 0) * i * 1.25 + (u.cacheRead ?? 0) * read + u.output * o; // tokens × $/M = micro-dollars
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
  // Cost control (spec §5): reserve the worst case before the provider is called; settle with the real cost afterwards.
  const guard = new BudgetGuard([], { perOperationCap: 1_000_000 });
  for (const k of deps.disabledAi ?? []) guard.disableFeature(k);
  const UPPER: Record<string, number> = { photo: 300_000, label: 200_000, labs: 300_000, conclusion: 400_000, medbox: 200_000 };
  type Hold = { ok: true; commit: (usd: number) => void; release: () => void } | { ok: false; status: 429 | 503; error: 'budget' | 'ai_off' };
  const reserve = (kind: string): Hold => {
    const at = now();
    const day = `day:${at.toISOString().slice(0, 10)}`;
    const month = `month:${at.toISOString().slice(0, 7)}`;
    guard.ensureScope(day, limits.aiDayUsdMicro ?? Infinity, store.daySpend(day.slice(4)));
    guard.ensureScope(month, limits.aiMonthUsdMicro ?? Infinity, store.monthSpend(month.slice(6)));
    const id = randomBytes(12).toString('hex');
    const r = guard.reserve(id, kind, UPPER[kind] ?? 100_000, [day, month]);
    if (!r.ok) return r.reason === 'feature_disabled' ? { ok: false, status: 503, error: 'ai_off' } : { ok: false, status: 429, error: 'budget' };
    if (r.warnings.length) console.warn('AI budget at 80%:', r.warnings.join(', '));
    return { ok: true, commit: (usd) => guard.commit(id, usd), release: () => guard.release(id) };
  };
  const spent = (vault: string, kind: string, usage: Usage | undefined, hold: Hold) => {
    if (!usage) return;
    const usd = usdMicro(usage);
    store.addUsage(vault, kind, usd, now());
    store.addDaySpend(now().toISOString().slice(0, 10), usd);
    if (hold.ok) hold.commit(usd);
  };

  mountIdentity(app, deps.identity, (c, bucket, n) => store.take(`identity:${bucket}:${Math.floor(now().getTime() / 600000)}:${ipKey(c)}`, n, now()));
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

  /** D136: available even on a device without push, to suppress the vault's other schedules. */
  app.put('/v1/vaults/:id/reminder-policy', bodyLimit({ maxSize: 30_000 }), async (c) => {
    const id = authed(c);
    if (typeof id !== 'string') return id;
    const body = await c.req.json().catch(() => null) as { protocol?: unknown } | null;
    const denied = compatible(c, id, body?.protocol); if (denied) return denied;
    const { protocol: _protocol, ...policyBody } = body ?? {};
    const policy = parseReminderPolicy(policyBody);
    if (!policy) return c.json({ error: 'bad_request' }, 400);
    if (policy.days.some((d) => d.from > now().getTime() + 33 * 86_400_000)) return c.json({ error: 'bad_request' }, 400);
    store.setReminderPolicy(id, policy, now().getTime());
    return c.json({ ok: true, v: 1 });
  });

  /** The device's schedule for the coming days; `done` — reminders ticked anywhere (no more repeats). */
  app.put('/v1/vaults/:id/devices/:dev/reminders', bodyLimit({ maxSize: 300_000 }), async (c) => {
    const id = authed(c);
    if (typeof id !== 'string') return id;
    const dev = c.req.param('dev');
    if (!store.hasDevice(id, dev)) return c.json({ error: 'not_found' }, 404);
    const b = await c.req.json().catch(() => null) as { items?: unknown; done?: unknown; repeatEvery?: unknown; repeats?: unknown; policyVersion?: unknown; protocol?: unknown } | null;
    const denied = compatible(c, id, b?.protocol); if (denied) return denied;
    if (!Array.isArray(b?.items) || b.items.length > 500) return c.json({ error: 'bad_request' }, 400);
    if (b.policyVersion !== undefined && b.policyVersion !== 1) return c.json({ error: 'bad_request' }, 400);
    const items: { rid: string; at: number; payload: string; once?: boolean }[] = [];
    for (const x of b.items as Record<string, unknown>[]) {
      if (!x || typeof x !== 'object' || Array.isArray(x)) return c.json({ error: 'bad_request' }, 400);
      const p = x.payload as Record<string, unknown> | undefined;
      if (typeof x.rid !== 'string' || !RID.test(x.rid) || typeof x.at !== 'number' || !Number.isSafeInteger(x.at) || x.at < 0
        || !p || typeof p !== 'object' || Array.isArray(p)) return c.json({ error: 'bad_request' }, 400);
      if (b.policyVersion === 1 && !['meal', 'med', 'water', 'morning', 'evening', 'test', 'visit', 'week', 'weight', 'topup'].includes(String(p.k))) return c.json({ error: 'bad_request' }, 400);
      const payload = JSON.stringify(p);
      if (payload.length > 600) return c.json({ error: 'bad_request' }, 400);
      items.push({ rid: x.rid, at: Math.round(x.at), payload, ...(x.once === true ? { once: true } : {}) });
    }
    const done = Array.isArray(b.done) ? (b.done as unknown[]).filter((r): r is string => typeof r === 'string' && RID.test(r)).slice(0, 1000) : [];
    const every = Math.min(60, Math.max(5, Number(b.repeatEvery) || 15));
    const repeats = Math.min(3, Math.max(0, Math.round(Number(b.repeats) || 0)));
    store.setReminders(id, dev, items, every, repeats, done, now().getTime(), b.policyVersion === 1);
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
    if (!store.take(`pairget:${ipKey(c)}`, 30, now())) return c.json({ error: 'too_many' }, 429);
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
    const hold = reserve('label');
    if (!hold.ok) return c.json({ error: hold.error }, hold.status);
    try {
      const { result, usage } = await deps.label(image);
      spent(id, 'label', usage, hold);
      ai.lastOk = Date.now();
      if (result === 'refused') return c.json({ error: 'refused' }, 422);
      return c.json(result);
    } catch (e) {
      ai.lastError = Date.now();
      hold.release();
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
    const hold = reserve('labs');
    if (!hold.ok) return c.json({ error: hold.error }, hold.status);
    try {
      const { result, usage } = await deps.labs(image, list(body?.names, 100, 80));
      spent(id, 'labs', usage, hold);
      ai.lastOk = Date.now();
      if (result === 'refused') return c.json({ error: 'refused' }, 422);
      return c.json(result);
    } catch (e) {
      ai.lastError = Date.now();
      hold.release();
      console.error('labs failed:', (e as Error).message);
      return c.json({ error: 'upstream' }, 502);
    }
  });

  // D80, D101: a doctor's conclusion (up to 4 pages) → a draft of the plan — counted with photos. The same reading for a
  // vault and for a device without sync (step 0: the first screen of onboarding needs no account).
  const readConclusion = async (c: Context, who: string, perDay: number) => {
    if (!deps.conclusion) return c.json({ error: 'photo_off' }, 503);
    const body = await c.req.json().catch(() => null) as { image?: unknown; images?: unknown } | null;
    const images = Array.isArray(body?.images) ? body.images : body?.image !== undefined ? [body.image] : [];
    if (!images.length || images.length > 4 || !images.every((x): x is string => typeof x === 'string' && B64.test(x))) return c.json({ error: 'bad_request' }, 400);
    for (const im of images) { const b = Buffer.from(im, 'base64'); if (b.length > MAX_IMAGE || b[0] !== 0xff || b[1] !== 0xd8) return c.json({ error: 'bad_image' }, 400); }
    const at = now();
    if (!store.take('photo:all', limits.photosPerDay, at) || !store.take(`photo:${who}`, perDay, at)) return c.json({ error: 'too_many' }, 429);
    const hold = reserve('conclusion');
    if (!hold.ok) return c.json({ error: hold.error }, hold.status);
    try {
      const { result, usage } = await deps.conclusion(images);
      spent(who, 'conclusion', usage, hold);
      ai.lastOk = Date.now();
      if (result === 'refused') return c.json({ error: 'refused' }, 422);
      return c.json(result);
    } catch (e) {
      ai.lastError = Date.now();
      hold.release();
      console.error('conclusion failed:', (e as Error).message);
      return c.json({ error: 'upstream' }, 502);
    }
  };
  const PAGES = bodyLimit({ maxSize: 10_000_000, onError: (c) => c.json({ error: 'too_large' }, 413) });
  app.post('/v1/vaults/:id/conclusion', PAGES, async (c) => {
    const id = authed(c);
    return typeof id !== 'string' ? id : readConclusion(c, id, limits.photosPerVaultPerDay);
  });

  // D101: a device without sync — a random token (the server keeps its hash), a few a day per address, its own photo limit
  app.post('/v1/devices', (c) => {
    if (!store.take(`devtoken:${ipKey(c)}`, limits.deviceTokensPerIpPerDay, now())) return c.json({ error: 'too_many' }, 429);
    const token = randomBytes(32).toString('base64url');
    store.addDeviceToken(hash(token), now().getTime());
    return c.json({ token }, 201);
  });
  const device = (c: Context): string | Response => {
    const t = /^Device ([A-Za-z0-9_-]{43})$/.exec(c.req.header('Authorization') ?? '')?.[1];
    if (!t) return c.json({ error: 'unauthorized' }, 401);
    const h = hash(t);
    return store.hasDeviceToken(h) ? `dev-${h.slice(0, 16)}` : c.json({ error: 'unauthorized' }, 401);
  };
  app.post('/v1/device/conclusion', PAGES, async (c) => {
    const who = device(c);
    return typeof who !== 'string' ? who : readConclusion(c, who, limits.devicePhotosPerDay);
  });

  // D110: a dish described in words → its ingredients with grams; for a vault and for a device without sync
  const readDish = async (c: Context, who: string) => {
    if (!deps.dish) return c.json({ error: 'ai_off' }, 503);
    const b = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const text = str(b?.text, 2000).trim();
    if (text.length < 3) return c.json({ error: 'bad_request' }, 400);
    if (!store.take(`dish:${who}`, limits.dishesPerDay, now()) || !store.take('ai:all', limits.aiPerDay, now())) return c.json({ error: 'too_many' }, 429);
    const hold = reserve('dish');
    if (!hold.ok) return c.json({ error: hold.error }, hold.status);
    try {
      const { result, usage } = await deps.dish({ text, foods: list(b?.foods, 600, 80) });
      spent(who, 'dish', usage, hold);
      ai.lastOk = Date.now();
      if (result === 'refused') return c.json({ error: 'refused' }, 422);
      return c.json(result);
    } catch (e) {
      ai.lastError = Date.now();
      hold.release();
      console.error('dish failed:', (e as Error).message);
      return c.json({ error: 'upstream' }, 502);
    }
  };
  const DISH = bodyLimit({ maxSize: 60_000, onError: (c) => c.json({ error: 'too_large' }, 413) });
  app.post('/v1/vaults/:id/dish', DISH, async (c) => { const id = authed(c); return typeof id !== 'string' ? id : readDish(c, id); });
  app.post('/v1/device/dish', DISH, async (c) => { const who = device(c); return typeof who !== 'string' ? who : readDish(c, who); });

  // D123: a list of dishes — up to 15 a request, the base's names once; only the dishes that reached the model count, and only
  // after an answer (a failed pack is not counted); fewer left today than asked → 429 with how many are left
  const readDishes = async (c: Context, who: string) => {
    if (!deps.dishes) return c.json({ error: 'ai_off' }, 503);
    const b = await c.req.json().catch(() => null) as { dishes?: unknown; foods?: unknown } | null;
    const KEY = /^[A-Za-z0-9_-]{1,24}$/;
    const dishes: BatchDish[] = Array.isArray(b?.dishes) ? (b.dishes as Record<string, unknown>[]).flatMap((d) =>
      d && typeof d.key === 'string' && KEY.test(d.key) && typeof d.text === 'string' && d.text.trim().length >= 2
        ? [{ key: d.key, text: d.text.trim().slice(0, 400) }] : []) : [];
    if (!dishes.length || dishes.length > MAX_BATCH || dishes.length !== (b?.dishes as unknown[]).length || new Set(dishes.map((d) => d.key)).size !== dishes.length)
      return c.json({ error: 'bad_request' }, 400);
    const left = limits.listDishesPerDay - store.count(`dishlist:${who}`, now());
    if (left < dishes.length) return c.json({ error: 'too_many', left: Math.max(0, left) }, 429);
    if (!store.take('ai:all', limits.aiPerDay, now())) return c.json({ error: 'too_many', left }, 429);
    const hold = reserve('dishes');
    if (!hold.ok) return c.json({ error: hold.error }, hold.status);
    try {
      const { result, usage } = await deps.dishes({ dishes, foods: list(b?.foods, 600, 80) });
      spent(who, 'dishes', usage, hold);
      ai.lastOk = Date.now();
      if (result === 'refused') return c.json({ error: 'refused' }, 422);
      store.bump(`dishlist:${who}`, dishes.length, now());
      return c.json(result);
    } catch (e) {
      ai.lastError = Date.now();
      hold.release();
      console.error('dishes failed:', (e as Error).message);
      return c.json({ error: 'upstream' }, 502);
    }
  };
  const DISHES = bodyLimit({ maxSize: 120_000, onError: (c) => c.json({ error: 'too_large' }, 413) });
  app.post('/v1/vaults/:id/dishes', DISHES, async (c) => { const id = authed(c); return typeof id !== 'string' ? id : readDishes(c, id); });
  app.post('/v1/device/dishes', DISHES, async (c) => { const who = device(c); return typeof who !== 'string' ? who : readDishes(c, who); });

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
    const hold = reserve('medbox');
    if (!hold.ok) return c.json({ error: hold.error }, hold.status);
    try {
      const { result, usage } = await deps.medbox(image);
      spent(id, 'medbox', usage, hold);
      ai.lastOk = Date.now();
      if (result === 'refused') return c.json({ error: 'refused' }, 422);
      return c.json(result);
    } catch (e) {
      ai.lastError = Date.now();
      hold.release();
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
    const hold = reserve('concierge');
    if (!hold.ok) return c.json({ error: hold.error }, hold.status);
    try {
      const { result, usage } = await deps.notFound(text, names);
      spent(id, 'concierge', usage, hold);
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
      hold.release();
      console.error('concierge failed:', (e as Error).message);
      return c.json({ error: 'upstream' }, 502);
    }
  });
  // D117: the assistant's chat — for a vault (logged only with its own consent) and for a device without sync (never logged)
  const chat = async (c: Context, who: string, vault: string | null) => {
    if (!deps.chat) return c.json({ error: 'ai_off' }, 503);
    const body = await c.req.json().catch(() => null) as { text?: unknown; history?: unknown; names?: unknown; context?: unknown; log?: unknown; versions?: unknown } | null;
    const text = str(body?.text, 600).trim();
    const names = list(body?.names, 700, 80);
    if (!text || !names.length) return c.json({ error: 'bad_request' }, 400);
    const history = (Array.isArray(body?.history) ? body.history : []).slice(-8).flatMap((m) => {
      const x = m as { role?: unknown; text?: unknown };
      return (x.role === 'user' || x.role === 'assistant') && typeof x.text === 'string' ? [{ role: x.role as 'user' | 'assistant', text: x.text.slice(0, 600) }] : [];
    });
    const context = typeof body?.context === 'object' && body.context && JSON.stringify(body.context).length < 8000 ? body.context : {};
    const at = now();
    if (!store.take(`concierge:${who}`, limits.conciergePerVaultPerDay, at) || !store.take('ai:all', limits.aiPerDay, at)) return c.json({ error: 'too_many' }, 429);
    const started = Date.now();
    const hold = reserve('concierge');
    if (!hold.ok) return c.json({ error: hold.error }, hold.status);
    try {
      const { result, usage } = await deps.chat({ text, history, names, context });
      spent(who, 'concierge', usage, hold);
      ai.lastOk = Date.now();
      if (result === 'refused') return c.json({ error: 'refused' }, 422);
      const { result: out, numbersDropped } = checked(result, names); // the code's check on the way out
      let logId: string | undefined;
      if (vault && body?.log === true) {
        logId = `c-${at.toISOString().slice(0, 10)}-${randomBytes(3).toString('hex')}`;
        const v = (body.versions ?? {}) as Record<string, unknown>;
        store.logConcierge(logId, vault, at.getTime(), 'chat', {
          id: logId, ts: at.toISOString(), user: userLabel(vault), scenario: 'chat',
          versions: { app: String(v.app ?? '').slice(0, 40), model: deps.conciergeModel ?? '', prompt: PROMPT_CHAT, plan: String(v.plan ?? '').slice(0, 40) },
          context, input: text, output: { topic: out.topic, text: out.text, items: out.items },
          checker: { numbers_match: numbersDropped === 0, numbers_dropped: numbersDropped, names_dropped: result.items.length - out.items.length },
          latency_ms: Date.now() - started,
        });
      }
      return c.json({ ...out, ...(logId ? { id: logId } : {}) });
    } catch (e) {
      ai.lastError = Date.now();
      hold.release();
      console.error('chat failed:', (e as Error).message);
      return c.json({ error: 'upstream' }, 502);
    }
  };
  const CHAT = bodyLimit({ maxSize: 80_000, onError: (c) => c.json({ error: 'too_large' }, 413) });
  app.post('/v1/vaults/:id/concierge/chat', CHAT, async (c) => { const id = authed(c); return typeof id !== 'string' ? id : chat(c, id, id); });
  app.post('/v1/device/concierge/chat', CHAT, async (c) => { const who = device(c); return typeof who !== 'string' ? who : chat(c, who, null); });

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
      usd: Math.round(rows.reduce((s, r) => s + r.usd_micro, 0) / 10_000) / 100, usdMicro: rows.reduce((s, r) => s + r.usd_micro, 0) }); // D123: exact, for eval:dishes
  });

  // `ok` is false while the AI fails (D101: a schema the API refused showed as healthy); the HTTP status stays 200 — the
  // container's healthcheck asks whether the server lives, not whether the model answers
  app.get('/health', (c) => c.json({ ok: !(ai.lastError > ai.lastOk), photo: !!recognize, menu: !!menu, workout: !!deps.workout, labs: !!deps.labs, conclusion: !!deps.conclusion, dish: !!deps.dish, dishes: !!deps.dishes, chat: !!deps.chat, medbox: !!deps.medbox, concierge: !!deps.notFound, label: !!deps.label, push: !!deps.push,
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
    if (!ok) return c.json({ error: 'unauthorized' }, 401);
    store.seen(id, weekKey(now())); // D119: the week it came online, for stats:ops
    return id;
  };

  // Missing capability is legacy protocol 1. Never advance an old client's pull cursor past unknown source plans.
  const compatible = (c: Context, id: string, value: unknown): Response | undefined => {
    const protocol = value === undefined ? 1 : value;
    if (typeof protocol !== 'number' || !Number.isInteger(protocol) || protocol < 1 || protocol > 2) return c.json({ error: 'bad_request' }, 400);
    const minimum = store.minimumWriteProtocol(id);
    return protocol < minimum ? c.json({ error: 'client_upgrade_required', requiredProtocol: minimum }, 409) : undefined;
  };
  app.get('/v1/vaults/:id/write-protocol', c => {
    const id = authed(c); if (typeof id !== 'string') return id;
    return c.json({ minimum: store.minimumWriteProtocol(id), supported: 2 });
  });
  app.put('/v1/vaults/:id/write-protocol', bodyLimit({ maxSize: 1000 }), async c => {
    const id = authed(c); if (typeof id !== 'string') return id;
    const body = await c.req.json().catch(() => null) as { minimum?: unknown; protocol?: unknown } | null;
    if (body?.minimum !== 2 || body.protocol !== 2) return c.json({ error: 'bad_request' }, 400);
    store.raiseWriteProtocol(id, 2);
    return c.json({ minimum: 2, supported: 2 });
  });

  app.put('/v1/vaults/:id', (c) => {
    const id = c.req.param('id');
    const t = token(c);
    if (!VAULT.test(id) || !t) return c.json({ error: 'bad_request' }, 400);
    if (store.vaultAuth(id)) {
      const r = authed(c);
      return typeof r === 'string' ? c.json({ created: false }) : r;
    }
    if (!store.take(`vault:${ipKey(c)}`, limits.vaultsPerIpPerDay, now())) return c.json({ error: 'too_many' }, 429);
    store.createVault(id, hash(t), now());
    return c.json({ created: true }, 201);
  });

  app.get('/v1/vaults/:id/records', (c) => {
    const id = authed(c);
    if (typeof id !== 'string') return id;
    const rawProtocol = c.req.query('protocol');
    const denied = compatible(c, id, rawProtocol === undefined ? undefined : /^[12]$/.test(rawProtocol) ? Number(rawProtocol) : null);
    if (denied) return denied;
    const since = Number(c.req.query('since') ?? 0);
    if (!Number.isInteger(since) || since < 0) return c.json({ error: 'bad_request' }, 400);
    const records = store.since(id, since, PAGE);
    return c.json({ records, more: records.length === PAGE, seq: records.at(-1)?.seq ?? Math.max(since, store.latest(id)) });
  });

  app.post('/v1/vaults/:id/records', bodyLimit({ maxSize: 4_000_000, onError: (c) => c.json({ error: 'too_large' }, 413) }), async (c) => {
    const id = authed(c);
    if (typeof id !== 'string') return id;
    const body = await c.req.json().catch(() => null) as { records?: unknown; protocol?: unknown } | null;
    const denied = compatible(c, id, body?.protocol); if (denied) return denied;
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
    const hold = reserve('photo');
    if (!hold.ok) return c.json({ error: hold.error }, hold.status);
    try {
      const { result, usage } = await recognize({ image, foods: list(body?.foods, 400, 80), dishes: list(body?.dishes, 400, 80) });
      spent(id, 'photo', usage, hold);
      ai.lastOk = Date.now();
      if (result === 'refused') return c.json({ error: 'refused' }, 422);
      return c.json(result);
    } catch (e) {
      ai.lastError = Date.now();
      hold.release();
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
    const hold = reserve('menu');
    if (!hold.ok) return c.json({ error: hold.error }, hold.status);
    try {
      const { result, usage } = await menu({ date, targets, rules: list(b?.rules, 30, 300), foods, dishes: list(b?.dishes, 100, 80),
        usual: list(b?.usual, 50, 80), wish: str(b?.wish, 300), avoid: list(b?.avoid, 60, 80) });
      spent(id, 'menu', usage, hold);
      ai.lastOk = Date.now();
      if (result === 'refused') return c.json({ error: 'refused' }, 422);
      return c.json(result);
    } catch (e) {
      ai.lastError = Date.now();
      hold.release();
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
    const hold = reserve('workout');
    if (!hold.ok) return c.json({ error: hold.error }, hold.status);
    try {
      const { result, usage } = await deps.workout({ exercises, history, rules: list(b?.rules, 30, 300), equipment: str(b?.equipment, 40) || 'Гиря 16 кг',
        minutes, wish: str(b?.wish, 300) });
      spent(id, 'workout', usage, hold);
      ai.lastOk = Date.now();
      if (result === 'refused') return c.json({ error: 'refused' }, 422);
      return c.json(result);
    } catch (e) {
      ai.lastError = Date.now();
      hold.release();
      console.error('workout failed:', (e as Error).message);
      return c.json({ error: 'upstream' }, 502);
    }
  });

  // ---------------------------------------------------------------- the pilot by consent (D119): not linked to a vault
  /** D122: an address only as a hash with the server's salt and the day — a day's limit, never the address, and not the same
   *  key on two days; the counters of limits go after 2 days (store.purgeCounters). */
  function ipKey(c: Context) {
    let salt = store.setting('ip_salt');
    if (!salt) { salt = randomBytes(16).toString('hex'); store.setSetting('ip_salt', salt); }
    return hash(`${salt}:${now().toISOString().slice(0, 10)}:${ip(c)}`).slice(0, 20);
  }
  const member = (c: Context): string | Response => {
    const [, pid = '', secret = ''] = /^Pilot (p_[a-z2-7]{10})\.([A-Za-z0-9_-]{43})$/.exec(c.req.header('Authorization') ?? '') ?? [];
    if (!PID.test(pid) || !SECRET.test(secret)) return c.json({ error: 'unauthorized' }, 401);
    const stored = store.pilotSecret(pid);
    if (!stored) return c.json({ error: 'not_found' }, 404);
    const a = Buffer.from(stored, 'hex'), b = Buffer.from(hash(secret), 'hex');
    return a.length === b.length && timingSafeEqual(a, b) ? pid : c.json({ error: 'unauthorized' }, 401);
  };

  app.post('/v1/pilot/join', (c) => {
    if (!store.take(`pilotjoin:${ipKey(c)}`, limits.pilotJoinsPerIpPerDay, now())) return c.json({ error: 'too_many' }, 429);
    const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
    const pid = `p_${[...randomBytes(10)].map((x) => alphabet[x & 31]).join('')}`;
    const secret = randomBytes(32).toString('base64url');
    store.joinPilot(pid, hash(secret), weekKey(now())); // joined = the week only, not the date
    return c.json({ pid, secret }, 201);
  });

  /** A week's summary, a survey's answers or a «Що заважало» note; the same week and kind again replaces it. */
  app.post('/v1/pilot/week', bodyLimit({ maxSize: 4_000, onError: (c) => c.json({ error: 'too_large' }, 413) }), async (c) => {
    const pid = member(c);
    if (typeof pid !== 'string') return pid;
    const rec = parsePilot(await c.req.json().catch(() => null));
    if (!rec || rec.body.pid !== pid) return c.json({ error: 'bad_request' }, 400);
    const week = latestWeek(now()); // R17: a phone's week by its own time zone, never refused for being ahead of UTC
    if (rec.body.week > week || rec.body.week < weekAdd(weekKey(now()), -5)) return c.json({ error: 'bad_week' }, 400); // the phone sends up to 4 weeks back
    if (!store.take(`pilotweek:${pid}`, 40, now())) return c.json({ error: 'too_many' }, 429);
    const body = rec.kind.startsWith('note:') ? { ...rec.body, note: scrubNames((rec.body as { note: string }).note) } : rec.body;
    store.putPilotWeek(pid, rec.body.week, rec.kind, rec.kind === 'week' ? (rec.body as { src?: string }).src ?? null : null, JSON.stringify(body));
    return c.json({ ok: true });
  });

  /** Patient side, no account: a one-time code gives the plan once. The plan is never logged and never cached. */
  app.post('/v1/clinic/plans/redeem', bodyLimit({ maxSize: 1_000, onError: (c) => c.json({ error: 'too_large' }, 413) }), async (c) => {
    if (!deps.planDelivery) return c.json({ error: 'clinic_off' }, 503);
    let allowed: boolean;
    try { allowed = store.take(`planredeem:${ipKey(c)}`, 30, now()); } catch (e) {
      // the rate-limit counter is a write too: under a held lock it must also end as a retryable 503, not a 500
      if (!isBusy(e)) throw e;
      c.header('Retry-After', '1'); return c.json({ error: 'database_busy' }, 503);
    }
    if (!allowed) return c.json({ error: 'too_many' }, 429);
    const body = await c.req.json().catch(() => null) as { code?: unknown } | null;
    c.header('Cache-Control', 'no-store');
    try {
      return c.json(deps.planDelivery.redeemWithProvenance(typeof body?.code === 'string' ? body.code : ''));
    } catch (e) {
      // A busy write lock is retryable and changed nothing: no payload, no `used`, never an unhandled 500.
      if (e instanceof DatabaseBusy) { c.header('Retry-After', '1'); return c.json({ error: 'database_busy' }, 503); }
      if (!(e instanceof RedeemFailure)) throw e;
      return c.json({ error: e.code }, REDEEM_STATUS[e.code]);
    }
  });

  if (deps.clinic && deps.planDelivery) mountClinic(app, { dir: deps.clinic, delivery: deps.planDelivery, identity: deps.identity, allow: (c) => store.take(`clinicreq:${ipKey(c)}`, 3000, now()) });

  app.delete('/v1/pilot', (c) => {
    const pid = member(c);
    if (typeof pid !== 'string') return pid;
    store.leavePilot(pid);
    return c.json({ ok: true });
  });

  /** Is the code known; `?visit=1` — the QR link was opened: a count of (day, code), nothing else. */
  app.get('/v1/pilot/src/:code', (c) => {
    const code = c.req.param('code').toUpperCase();
    if (!SRC.test(code)) return c.json({ known: false });
    if (!store.take(`pilotsrc:${ipKey(c)}`, 60, now())) return c.json({ error: 'too_many' }, 429);
    const known = !!store.pilotSource(code);
    if (known && c.req.query('visit') === '1') store.bump(`qr:${code}`, 1, now());
    return c.json({ known });
  });

  return app;
}
