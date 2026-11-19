// D184: the deployed CSP lets the phone open Soniox's stream — and nothing wider. A forgotten origin is invisible to the
// e2e tests (they fake the socket); the browser just drops the connection in 2 ms.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SONIOX_URL } from '../../src/data/speechSoniox';

const csp = (): string => {
  const config = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8')) as { headers: { headers: { key: string; value: string }[] }[] };
  return config.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy')!.value;
};
const connectSrc = () => csp().split(';').map((d) => d.trim()).find((d) => d.startsWith('connect-src'))!.split(/\s+/).slice(1);

describe('CSP connect-src (D184)', () => {
  it("allows Soniox's real-time stream, by the client's own URL", () => {
    expect(connectSrc()).toContain(new URL(SONIOX_URL).origin);
  });
  it('allows only our API and that stream — no wildcards, not the key API', () => {
    expect(connectSrc().sort()).toEqual(["'self'", 'https://api.beyondthesignal.to', 'wss://stt-rt.soniox.com'].sort());
  });
});
