// Demo stand («ТЗ: демо клиники и тренировки», step 1). The stand runs a mock identity provider and a mail trap; production
// never may. Two locks, both refuse to start rather than run half-safe:
//  - DEMO=1 only on a demo host: APP_ORIGIN must be demo.<domain> (or localhost for a laptop run);
//  - without DEMO=1 the API refuses an issuer on an idp.demo.<domain> host, and at sign-in any issuer whose discovery carries
//    DEMO_MARKER (the mock says so about itself) — a production server pointed at the mock by mistake signs nobody in.
export const DEMO_MARKER = 'x_protocol_demo_idp';

export class DemoGuardError extends Error {}

const host = (value: string | undefined) => { try { return value ? new URL(value).hostname : ''; } catch { return ''; } };
const isLocal = (h: string) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
export const isDemoHost = (h: string) => h.startsWith('demo.') || h.startsWith('api.demo.') || h.startsWith('idp.demo.') || isLocal(h);

export function demoGuard(env: Record<string, string | undefined>): { demo: boolean } {
  const demo = env.DEMO === '1';
  if (env.DEMO !== undefined && env.DEMO !== '' && env.DEMO !== '1' && env.DEMO !== '0') throw new DemoGuardError('DEMO must be 1 or unset');
  if (demo) {
    const app = host(env.APP_ORIGIN);
    if (!app || !isDemoHost(app)) throw new DemoGuardError('DEMO=1 runs only on a demo host: APP_ORIGIN must be https://demo.<domain>');
    const issuer = host(env.OIDC_ISSUER);
    if (issuer && !isDemoHost(issuer)) throw new DemoGuardError('DEMO=1 signs in only through the demo identity provider (idp.demo.<domain>)');
  } else if (host(env.OIDC_ISSUER).startsWith('idp.demo.')) {
    throw new DemoGuardError('the demo identity provider is configured without DEMO=1 — refused');
  }
  return { demo };
}
