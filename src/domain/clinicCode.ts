// D177: what a scanned QR or a pasted text gives the plan import — the one-time code of a clinic's link
// (`…#/plan/import?code=…`, patientLink in clinicPlanDraft.ts) or the bare code. Anything else is not a plan code: a
// stranger's QR never sends its text to our server.
// D180: a link carries its app's address too. A code issued by another Protocol (the demo stand has its own server and
// its own database) is redeemed only there — sent to this server it is «not found», and a one-time code must not be tried
// where it cannot work. Such a link is handed back to be opened where it belongs.
const CODE = /^[A-Za-z0-9_-]{40,64}$/;

export type ScanTarget = { code: string } | { elsewhere: string };

/** `here` — this app's origin and path (`location.origin + location.pathname`). */
export function scanTarget(text: string, here: string): ScanTarget | null {
  const s = text.trim();
  if (CODE.test(s)) return { code: s };
  const m = /#\/plan\/import\?(?:[^#]*&)?code=([^&#\s]+)/.exec(s);
  if (!m) return null;
  let code: string;
  try { code = decodeURIComponent(m[1]!); } catch { return null; }
  if (!CODE.test(code)) return null;
  const base = s.slice(0, s.indexOf('#'));
  if (!base) return { code }; // «#/plan/import?code=…» alone — this app
  let there: URL, mine: URL;
  try { there = new URL(base); mine = new URL(here); } catch { return null; }
  if (there.protocol !== 'https:' && there.hostname !== 'localhost') return null;
  return there.origin === mine.origin ? { code } : { elsewhere: `${there.origin}${there.pathname}#/plan/import?code=${encodeURIComponent(code)}` };
}

/** Only this app's code, or null — kept for callers that need the code alone. */
export function codeFromScan(text: string, here = typeof location === 'undefined' ? 'https://protocol.beyondthesignal.to/' : `${location.origin}${location.pathname}`): string | null {
  const t = scanTarget(text, here);
  return t && 'code' in t ? t.code : null;
}
