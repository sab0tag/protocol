// D177: the plan code from a scanned QR or a pasted text — only a clinic plan link or a bare code; nothing else.
import { describe, expect, it } from 'vitest';
import { codeFromScan, scanTarget } from '../../src/domain/clinicCode';
import { patientLink } from '../../src/domain/clinicPlanDraft';

const code = 'Ab3_-'.repeat(8) + 'xyz'; // 43 characters, like randomBytes(32) in base64url

describe('codeFromScan', () => {
  it('the clinic link (as patientLink makes it) and the bare code', () => {
    expect(codeFromScan(patientLink('https://protocol.beyondthesignal.to/', code), 'https://protocol.beyondthesignal.to/')).toBe(code);
    expect(codeFromScan(`  ${code}\n`)).toBe(code);
    expect(codeFromScan(`https://protocol-demo.example/#/plan/import?x=1&code=${code}`, 'https://protocol-demo.example/')).toBe(code);
  });
  it('anything else is not a plan code', () => {
    for (const t of ['https://example.com/?code=' + code, 'WIFI:S:home;P:secret;;', 'привіт', '', `${code}!`, 'short_code']) expect(codeFromScan(t), t).toBeNull();
    expect(codeFromScan('https://x/#/plan/import?code=%E0%A4%A')).toBeNull();
  });
});

describe('D180: a code issued by another Protocol is opened there, never tried here', () => {
  const here = 'https://protocol.beyondthesignal.to/';
  it('the demo stand’s link → elsewhere, with its own address; this app’s link and a bare code → the code', () => {
    expect(scanTarget(patientLink('https://protocol-demo.beyondthesignal.to/', code), here)).toEqual({ elsewhere: `https://protocol-demo.beyondthesignal.to/#/plan/import?code=${code}` });
    expect(scanTarget(patientLink(here, code), here)).toEqual({ code });
    expect(scanTarget(code, here)).toEqual({ code });
    expect(codeFromScan(patientLink('https://protocol-demo.beyondthesignal.to/', code), here)).toBeNull();
  });
  it('a plain-http link of a stranger is not a plan', () => {
    expect(scanTarget(`http://evil.example/#/plan/import?code=${code}`, here)).toBeNull();
  });
});
