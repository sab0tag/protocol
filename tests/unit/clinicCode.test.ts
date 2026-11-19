// D177: the plan code from a scanned QR or a pasted text — only a clinic plan link or a bare code; nothing else.
import { describe, expect, it } from 'vitest';
import { codeFromScan } from '../../src/domain/clinicCode';
import { patientLink } from '../../src/domain/clinicPlanDraft';

const code = 'Ab3_-'.repeat(8) + 'xyz'; // 43 characters, like randomBytes(32) in base64url

describe('codeFromScan', () => {
  it('the clinic link (as patientLink makes it) and the bare code', () => {
    expect(codeFromScan(patientLink('https://protocol.beyondthesignal.to/', code))).toBe(code);
    expect(codeFromScan(`  ${code}\n`)).toBe(code);
    expect(codeFromScan(`https://protocol-demo.example/#/plan/import?x=1&code=${code}`)).toBe(code);
  });
  it('anything else is not a plan code', () => {
    for (const t of ['https://example.com/?code=' + code, 'WIFI:S:home;P:secret;;', 'привіт', '', `${code}!`, 'short_code']) expect(codeFromScan(t), t).toBeNull();
    expect(codeFromScan('https://x/#/plan/import?code=%E0%A4%A')).toBeNull();
  });
});
