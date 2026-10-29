import { mutationRequest, MutationError } from '../db/mutations.ts';
import { InvitationError, roleSet, type StaffInvitations } from './invitations.ts';
import type { Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { ClinicError, type Actor, type ClinicDirectory } from './directory.ts';
import { isRole } from './roles.ts';
import type { PlanDelivery } from './delivery.ts';
import { DatabaseBusy, isBusy } from '../db/tx.ts';
import { IdentityError } from '../identity/errors.ts';
import { identityStatus, sessionToken, safeMutation, type Identity } from '../identity/routes.ts';

const STATUS: Record<ClinicError['code'], 400 | 401 | 403 | 404 | 409> = {
  unauthenticated: 401, forbidden: 403, not_found: 404, last_admin: 409, conflict: 409, bad_request: 400,
};
const ID = /^[0-9a-f-]{36}$/;

/**
 * Doctor/admin API (PR-11). Staff authenticate with their bearer token; the organization always comes from that member
 * record, never from the URL or body. Responses carry ids and statuses only — no plan content is ever returned here.
 * `allow` is a per-address request budget; tokens are 256-bit, so it only limits abuse.
 */
export function mountClinic(app: Hono, o: { dir: ClinicDirectory; delivery: PlanDelivery; identity?: Identity; invitations?: StaffInvitations; now?: () => number; allow: (c: Context) => boolean }): void {
  const { dir, delivery } = o;
  if (o.identity) app.use('/v1/clinic/*', cors({ origin: origin => origin === o.identity!.cfg.appOrigin ? origin : null, credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE'], allowHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Clinic-Id', 'Authorization', 'Idempotency-Key'], maxAge: 600 }));
  const small = bodyLimit({ maxSize: 20_000, onError: (c) => c.json({ error: 'too_large' }, 413) });
  const plan = bodyLimit({ maxSize: 100_000, onError: (c) => c.json({ error: 'too_large' }, 413) });

  const run = async (c: Context, f: (actor: Actor) => unknown | Promise<unknown>, status: 200 | 201 = 200): Promise<Response> => {
    c.header('Cache-Control', 'no-store');
    const busy = () => { c.header('Retry-After', '1'); return c.json({ error: 'database_busy' }, 503); };
    let allowed: boolean;
    try { allowed = o.allow(c); } catch (e) { if (isBusy(e)) return busy(); throw e; }
    if (!allowed) return c.json({ error: 'too_many' }, 429);
    let sessionHash: string | undefined;
    try {
      const authorization = c.req.header('Authorization'), cookie = o.identity ? sessionToken(c, o.identity) : undefined;
      let actor: Actor | null;
      if (cookie !== undefined) {
        if (authorization) throw new IdentityError('forbidden'); // ambiguity is never a legacy fallback
        const s = o.identity!.sessions.authenticate(cookie); if (!s) throw new IdentityError('unauthorized'); sessionHash = s.hash;
        if (!['GET', 'HEAD'].includes(c.req.method)) safeMutation(c, o.identity!, s);
        actor = dir.authenticateSession(s.hash, c.req.header('X-Clinic-Id'));
      } else {
        const m = /^Bearer (\S{20,100})$/.exec(authorization ?? ''); actor = dir.authenticate(m?.[1]);
      }
      if (!actor) return c.json({ error: 'unauthorized' }, 401);
      return c.json((await f(actor)) as object, status);
    } catch (e) {
      if (sessionHash && o.identity && (e instanceof IdentityError || e instanceof ClinicError && ['forbidden', 'not_found', 'unauthenticated'].includes(e.code))) {
        try { o.identity.sessions.denied(sessionHash, e.code); } catch (auditError) { if (isBusy(auditError)) return busy(); return c.json({ error: 'identity_unavailable' }, 503); }
      }
      if (e instanceof MutationError) return c.json({ error: e.code }, e.code === 'mutation_key_required' ? 400 : e.code === 'mutation_failed' ? 503 : 409);
      if (e instanceof InvitationError) return c.json({ error: `invitation_${e.code}` }, e.code === 'unavailable' ? 503 : e.code === 'not_found' ? 404 : e.code === 'conflict' ? 409 : e.code === 'recipient_mismatch' ? 403 : 400);
      if (e instanceof IdentityError) return c.json({ error: e.code }, identityStatus(e));
      if (e instanceof ClinicError) return c.json({ error: e.code }, STATUS[e.code]);
      if (e instanceof DatabaseBusy || isBusy(e)) return busy();
      throw e;
    }
  };
  const body = async (c: Context) => ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const id = (c: Context) => { const v = c.req.param('id') ?? ''; if (!ID.test(v)) throw new ClinicError('not_found'); return v; };

  app.get('/v1/clinic/me', (c) => run(c, (a) => dir.profile(a)));
  app.get('/v1/clinic/staff', (c) => run(c, (a) => ({ staff: dir.listStaff(a) })));
  app.post('/v1/clinic/staff', small, (c) => run(c, async (a) => {
    const b = await body(c);
    if (typeof b.displayName !== 'string' || !isRole(b.role)) throw new ClinicError('bad_request');
    return dir.addStaff(a, { displayName: b.displayName, role: b.role });
  }, 201));
  app.put('/v1/clinic/staff/:id/role', small, (c) => run(c, async (a) => {
    if (a.session) throw new ClinicError('forbidden'); // session clients must use versioned role sets
    const b = await body(c);
    if (!isRole(b.role)) throw new ClinicError('bad_request');
    dir.setRole(a, id(c), b.role);
    return { ok: true };
  }));
  app.delete('/v1/clinic/staff/:id', (c) => run(c, (a) => { dir.deactivate(a, id(c)); return { ok: true }; }));
  app.post('/v1/clinic/staff/:id/token', (c) => run(c, (a) => ({ token: dir.rotateToken(a, id(c)) })));
  const mutation = (c: Context, a: Actor, action: string, b: unknown) => mutationRequest(c, `${a.session?.accountId ?? ''}/${a.session?.membershipId ?? a.memberId}/${a.orgId}/${action}`, b, o.now?.() ?? Date.now());
  app.put('/v1/clinic/staff/:id/roles', small, c => run(c, async a => {
    const b = await body(c); if (!Number.isSafeInteger(b.version) || Number(b.version) < 1) throw new ClinicError('bad_request');
    dir.setRoles(a, id(c), roleSet(b.roles), Number(b.version), mutation(c,a,`staff.roles/${id(c)}`,b)); return { ok: true };
  }));
  app.get('/v1/clinic/auth-transition', c => run(c, a => dir.authTransition(a)));
  app.post('/v1/clinic/auth-transition', small, c => run(c, async a => {
    const b = await body(c); if (typeof b.graceHours !== 'number' || b.confirm !== true) throw new ClinicError('bad_request');
    dir.cutover(a, b.graceHours, mutation(c,a,'auth-transition',b)); return { ok: true };
  }));
  app.get('/v1/clinic/invitations', c => run(c, a => {
    if (!o.invitations) throw new InvitationError('unavailable');
    return { enabled: o.invitations.enabled(), invitations: o.invitations.list(a) };
  }));
  app.post('/v1/clinic/invitations', small, c => run(c, async a => {
    if (!o.invitations) throw new InvitationError('unavailable');
    const b = await body(c);
    if (typeof b.email !== 'string' || typeof b.displayName !== 'string' || b.targetMemberId !== undefined && typeof b.targetMemberId !== 'string') throw new InvitationError('bad_request');
    return o.invitations.invite(a, { email: b.email, displayName: b.displayName, roles: roleSet(b.roles), ...(typeof b.targetMemberId === 'string' ? { targetMemberId: b.targetMemberId } : {}) }, mutation(c,a,'invitation.create',b));
  }, 201));
  app.delete('/v1/clinic/invitations/:id', c => run(c, a => {
    if (!o.invitations) throw new InvitationError('unavailable');
    o.invitations.revoke(a, id(c), mutation(c,a,`invitation.revoke/${id(c)}`,{})); return { ok: true };
  }));
  app.get('/v1/clinic/audit', (c) => run(c, (a) => ({ entries: dir.auditLog(a, Number(c.req.query('limit')) || 100) })));

  app.get('/v1/clinic/stats', (c) => run(c, (a) => delivery.stats(a, Number(c.req.query('days')) || 30)));

  app.post('/v1/clinic/plans', plan, (c) => run(c, async (a) => {
    const b = await body(c);
    return delivery.issue(a, { plan: b.plan, patientConsent: b.patientConsent === true,
      ...(typeof b.ttlMs === 'number' ? { ttlMs: b.ttlMs } : {}) });
  }, 201));
  app.get('/v1/clinic/plans/:id', (c) => run(c, (a) => ({ status: delivery.status(a, id(c)) })));
  app.delete('/v1/clinic/plans/:id', (c) => run(c, (a) => { delivery.revoke(a, id(c)); return { ok: true }; }));
}
