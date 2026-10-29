/** Receipt of a server redemption, not a portable signature or verification of a clinician's qualifications. */
export interface ClinicSnapshot {
  schemaVersion: 1;
  snapshotId: string;
  issuedAt: string;
  issuer: { memberId: string; membershipId: string; organizationId: string; displayName: string; organizationName: string };
  source: { planId: string; issuedAt: string; clinician: { displayName: string; organizationName: string } };
}
