import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { ClinicError, type Actor, type ClinicDirectory } from './directory.ts';
import { isRole } from './roles.ts';
import type { PlanDelivery } from './delivery.ts';

const STATUS: Record<ClinicError['code'], 400 | 401 | 403 | 404 | 409> = {
  unauthenticated: 401, forbidden: 403, not_found: 404, last_admin: 409, bad_request: 400,
};
const ID = /^[0-9a-f-]{36}$/;

/**
 * Doctor/admin API (PR-11). Staff authenticate with their bearer token; the organization always comes from that member
 * record, never from the URL or body. Responses carry ids and statuses only — no plan content is ever returned here.
 * `allow` is a per-address request budget; tokens are 256-bit, so it only limits abuse.
 */
export function mountClinic(app: Hono, o: { dir: ClinicDirectory; delivery: PlanDelivery; allow: (c: Context) => boolean }): void {
  const { dir, delivery } = o;
  const small = bodyLimit({ maxSize: 20_000, onError: (c) => c.json({ error: 'too_large' }, 413) });
  const plan = bodyLimit({ maxSize: 100_000, onError: (c) => c.json({ error: 'too_large' }, 413) });

  const run = async (c: Context, f: (actor: Actor) => unknown | Promise<unknown>, status: 200 | 201 = 200): Promise<Response> => {
    if (!o.allow(c)) return c.json({ error: 'too_many' }, 429);
    c.header('Cache-Control', 'no-store');
    const m = /^Bearer (\S{20,100})$/.exec(c.req.header('Authorization') ?? '');
    const actor = dir.authenticate(m?.[1]);
    if (!actor) return c.json({ error: 'unauthorized' }, 401);
    try {
      return c.json((await f(actor)) as object, status);
    } catch (e) {
      if (e instanceof ClinicError) return c.json({ error: e.code }, STATUS[e.code]);
      throw e;
    }
  };
  const body = async (c: Context) => ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const id = (c: Context) => { const v = c.req.param('id') ?? ''; if (!ID.test(v)) throw new ClinicError('not_found'); return v; };

  app.get('/v1/clinic/me', (c) => run(c, (a) => ({ memberId: a.memberId, role: a.role })));
  app.get('/v1/clinic/staff', (c) => run(c, (a) => ({ staff: dir.listStaff(a) })));
  app.post('/v1/clinic/staff', small, (c) => run(c, async (a) => {
    const b = await body(c);
    if (typeof b.displayName !== 'string' || !isRole(b.role)) throw new ClinicError('bad_request');
    return dir.addStaff(a, { displayName: b.displayName, role: b.role });
  }, 201));
  app.put('/v1/clinic/staff/:id/role', small, (c) => run(c, async (a) => {
    const b = await body(c);
    if (!isRole(b.role)) throw new ClinicError('bad_request');
    dir.setRole(a, id(c), b.role);
    return { ok: true };
  }));
  app.delete('/v1/clinic/staff/:id', (c) => run(c, (a) => { dir.deactivate(a, id(c)); return { ok: true }; }));
  app.post('/v1/clinic/staff/:id/token', (c) => run(c, (a) => ({ token: dir.rotateToken(a, id(c)) })));
  app.get('/v1/clinic/audit', (c) => run(c, (a) => ({ entries: dir.auditLog(a, Number(c.req.query('limit')) || 100) })));

  app.post('/v1/clinic/plans', plan, (c) => run(c, async (a) => {
    const b = await body(c);
    return delivery.issue(a, { plan: b.plan, patientConsent: b.patientConsent === true,
      ...(typeof b.ttlMs === 'number' ? { ttlMs: b.ttlMs } : {}) });
  }, 201));
  app.get('/v1/clinic/plans/:id', (c) => run(c, (a) => ({ status: delivery.status(a, id(c)) })));
  app.delete('/v1/clinic/plans/:id', (c) => run(c, (a) => { delivery.revoke(a, id(c)); return { ok: true }; }));
}
