// HTTP API (SPEC.md D31, D32). A vault is created by the first device: its id and auth key are derived from the
// sync code on the device; the server keeps only a hash of the auth key and never the code or the encryption key.
import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import type { MenuMaker } from './menu.ts';
import type { Recognizer } from './photo.ts';
import type { Store } from './store.ts';

export interface Limits {
  vaultsPerIpPerDay: number;
  vaultBytes: number;
  photosPerVaultPerDay: number;
  photosPerDay: number;
  menusPerVaultPerDay: number;
}

export const DEFAULT_LIMITS: Limits = { vaultsPerIpPerDay: 5, vaultBytes: 50_000_000, photosPerVaultPerDay: 30, photosPerDay: 150, menusPerVaultPerDay: 15 };

export interface Deps {
  store: Store;
  recognize?: Recognizer; // absent = photos are off (no API key)
  menu?: MenuMaker; // the same
  origins: string[];
  limits?: Limits;
  now?: () => Date;
}

const VAULT = /^[0-9a-f]{32}$/;
const KEY = /^[A-Za-z0-9_-]{16,64}$/;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const PAGE = 1000;
const MAX_IMAGE = 2_000_000; // decoded bytes; the app sends ~1280 px JPEG of 150–400 KB

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

export function createApp(deps: Deps) {
  const { store, recognize, menu, origins } = deps;
  const limits = deps.limits ?? DEFAULT_LIMITS;
  const now = deps.now ?? (() => new Date());
  const app = new Hono();

  app.use('*', cors({ origin: origins, allowMethods: ['GET', 'POST', 'PUT'], allowHeaders: ['Authorization', 'Content-Type'], maxAge: 86400 }));
  app.get('/health', (c) => c.json({ ok: true, photo: !!recognize, menu: !!menu }));

  const token = (c: Context) => c.req.header('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{40,64})$/)?.[1];
  const ip = (c: Context) => c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';

  /** 401 for a wrong key, 404 for an unknown vault: the app tells «код не знайдено» from «помилка». */
  const authed = (c: Context): string | Response => {
    const id = c.req.param('id') ?? '';
    const t = token(c);
    if (!VAULT.test(id) || !t) return c.json({ error: 'bad_request' }, 400);
    const stored = store.vaultAuth(id);
    if (!stored) return c.json({ error: 'not_found' }, 404);
    const ok = timingSafeEqual(Buffer.from(stored, 'hex'), Buffer.from(hash(t), 'hex'));
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
    const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string').map((s) => s.slice(0, 80)).slice(0, 400) : []);
    if (typeof image !== 'string' || !B64.test(image)) return c.json({ error: 'bad_request' }, 400);
    const bytes = Buffer.from(image, 'base64');
    if (bytes.length > MAX_IMAGE || bytes[0] !== 0xff || bytes[1] !== 0xd8) return c.json({ error: 'bad_image' }, 400);
    const at = now();
    if (!store.take('photo:all', limits.photosPerDay, at) || !store.take(`photo:${id}`, limits.photosPerVaultPerDay, at)) {
      return c.json({ error: 'too_many' }, 429);
    }
    try {
      const result = await recognize({ image, foods: list(body?.foods), dishes: list(body?.dishes) });
      if (result === 'refused') return c.json({ error: 'refused' }, 422);
      return c.json(result);
    } catch (e) {
      console.error('photo failed:', (e as Error).message);
      return c.json({ error: 'upstream' }, 502);
    }
  });

  app.post('/v1/vaults/:id/menu', bodyLimit({ maxSize: 200_000, onError: (c) => c.json({ error: 'too_large' }, 413) }), async (c) => {
    const id = authed(c);
    if (typeof id !== 'string') return id;
    if (!menu) return c.json({ error: 'ai_off' }, 503);
    const b = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const list = (x: unknown, max = 400, len = 300) =>
      (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string' && s.trim() !== '').map((s) => s.slice(0, len)).slice(0, max) : []);
    const foods = list(b?.foods, 400, 80);
    const date = typeof b?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : null;
    if (!date || foods.length === 0) return c.json({ error: 'bad_request' }, 400);
    const targets: Record<string, number | string> = {};
    if (b?.targets && typeof b.targets === 'object') {
      for (const [k, v] of Object.entries(b.targets).slice(0, 20)) {
        if (/^[a-zA-Z]{1,30}$/.test(k) && (typeof v === 'number' || (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v)))) targets[k] = v;
      }
    }
    if (!store.take(`menu:${id}`, limits.menusPerVaultPerDay, now())) return c.json({ error: 'too_many' }, 429);
    try {
      const result = await menu({ date, targets, rules: list(b?.rules, 30), foods, dishes: list(b?.dishes, 100, 80),
        usual: list(b?.usual, 50, 80), wish: typeof b?.wish === 'string' ? b.wish.slice(0, 300) : '' });
      if (result === 'refused') return c.json({ error: 'refused' }, 422);
      return c.json(result);
    } catch (e) {
      console.error('menu failed:', (e as Error).message);
      return c.json({ error: 'upstream' }, 502);
    }
  });

  return app;
}
