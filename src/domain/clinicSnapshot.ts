/** Receipt of a server redemption, not a portable signature or verification of a clinician's qualifications. */
export interface ClinicSnapshot {
  schemaVersion: 1;
  snapshotId: string;
  issuedAt: string;
  issuer: { memberId: string; membershipId: string; organizationId: string; displayName: string; organizationName: string };
  source: { planId: string; issuedAt: string; clinician: { displayName: string; organizationName: string } };
}

const object = (x: unknown): Record<string, unknown> | null => x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : null;
const exact = (x: Record<string, unknown>, keys: string[]) => Object.keys(x).every(k => keys.includes(k));
const text = (x: unknown, max: number): x is string => typeof x === 'string' && !!x.trim() && x.length <= max;
const date = (x: unknown) => text(x, 40) && x.length >= 10 && Number.isFinite(Date.parse(x));

/** Shape/integrity validation only. A restored receipt is not a portable signature or a grant of access. */
export function parseClinicSnapshot(raw: unknown): ClinicSnapshot | null {
  const s = object(raw), issuer = object(s?.issuer), source = object(s?.source), clinician = object(source?.clinician);
  if (!s || !issuer || !source || !clinician || s.schemaVersion !== 1 ||
    !exact(s, ['schemaVersion', 'snapshotId', 'issuedAt', 'issuer', 'source']) ||
    typeof s.snapshotId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.snapshotId) || !date(s.issuedAt) ||
    !exact(issuer, ['memberId', 'membershipId', 'organizationId', 'displayName', 'organizationName']) ||
    !['memberId', 'membershipId', 'organizationId'].every(k => text(issuer[k], 128)) ||
    !text(issuer.displayName, 200) || !text(issuer.organizationName, 200) ||
    !exact(source, ['planId', 'issuedAt', 'clinician']) || !text(source.planId, 64) || !date(source.issuedAt) ||
    !exact(clinician, ['displayName', 'organizationName']) || !text(clinician.displayName, 200) || !text(clinician.organizationName, 200)) return null;
  return structuredClone(s) as unknown as ClinicSnapshot;
}
