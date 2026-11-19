// D177: what a scanned QR or a pasted text gives the plan import — the one-time code of a clinic's link
// (`…#/plan/import?code=…`, patientLink in clinicPlanDraft.ts) or the bare code. Anything else is not a plan code: a
// stranger's QR never sends its text to our server.
const CODE = /^[A-Za-z0-9_-]{40,64}$/;

export function codeFromScan(text: string): string | null {
  const s = text.trim();
  if (CODE.test(s)) return s;
  const m = /#\/plan\/import\?(?:[^#]*&)?code=([^&#\s]+)/.exec(s);
  if (!m) return null;
  let code: string;
  try { code = decodeURIComponent(m[1]!); } catch { return null; }
  return CODE.test(code) ? code : null;
}
