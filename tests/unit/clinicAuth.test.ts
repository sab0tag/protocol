import { afterEach, describe, expect, it, vi } from 'vitest';
import { clinicMe, clinicDeactivate, type ClinicAuth } from '../../src/sync/clinicApi';
import { identityLogout } from '../../src/sync/identityApi';

afterEach(() => vi.unstubAllGlobals());
describe('clinic authentication transports', () => {
  it('sends legacy bearer credentials without cookies and never stores them', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({})); vi.stubGlobal('fetch', fetch);
    await clinicMe('synthetic-legacy-secret');
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toMatch(/\/v1\/clinic\/me$/);
    expect(init).toMatchObject({ credentials: 'omit', cache: 'no-store', headers: { Authorization: 'Bearer synthetic-legacy-secret' } });
    expect(JSON.stringify({ ...localStorage })).not.toContain('synthetic-legacy-secret');
  });
  it('uses same-origin cookie requests, exact clinic selector, CSRF on writes and a shared abort signal', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json({}))); vi.stubGlobal('fetch', fetch);
    const controller = new AbortController(), auth: ClinicAuth = { organizationId: 'clinic-a', csrfToken: 'synthetic-csrf', signal: controller.signal };
    await clinicMe(auth); await clinicDeactivate(auth, 'member');
    expect(fetch.mock.calls[0]![0]).toBe('/v1/clinic/me');
    expect(fetch.mock.calls[0]![1]).toMatchObject({ credentials: 'same-origin', signal: controller.signal, headers: { 'X-Clinic-Id': 'clinic-a' } });
    expect(fetch.mock.calls[0]![1].headers.Authorization).toBeUndefined();
    expect(fetch.mock.calls[1]![1]).toMatchObject({ credentials: 'same-origin', method: 'DELETE', headers: { 'X-CSRF-Token': 'synthetic-csrf' } });
  });
  it('clears denied session context, with no automatic bearer retry; an obsolete context cannot clear a newer one', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ error: 'unauthorized' }, { status: 401 }))); vi.stubGlobal('fetch', fetch);
    const onDenied = vi.fn(), controller = new AbortController(), auth: ClinicAuth = { csrfToken: 'csrf', organizationId: 'a', onDenied, signal: controller.signal };
    await expect(clinicMe(auth)).rejects.toThrow('unauthorized'); expect(onDenied).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce();
    onDenied.mockClear(); fetch.mockImplementationOnce(() => Promise.resolve(Response.json({ error: 'forbidden' }, { status: 403 })));
    await expect(clinicMe(auth)).rejects.toThrow('forbidden'); expect(onDenied).toHaveBeenCalledOnce();
    onDenied.mockClear(); controller.abort();
    await expect(clinicMe(auth)).rejects.toThrow('unauthorized'); expect(onDenied).not.toHaveBeenCalled();
  });
  it('logout uses CSRF and the BFF; no provider token is sent by the browser', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true, logoutUrl: 'https://issuer.invalid/logout' })); vi.stubGlobal('fetch', fetch);
    await identityLogout({ accountId: 'account', csrfToken: 'csrf', mfa: true, authTime: 1, contexts: [] }, true);
    expect(fetch.mock.calls[0]).toEqual(['/v1/sessions/revoke-all', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'X-CSRF-Token': 'csrf' } }]);
  });
});
