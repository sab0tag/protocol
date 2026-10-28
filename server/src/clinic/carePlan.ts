import { z } from 'zod';

/** Draft exchange contract only: does not grant access, publish plans, or activate medications. */
export const CarePlanV1 = z.object({
  schemaVersion: z.literal(1),
  planId: z.string().uuid(),
  organizationId: z.string().min(1).max(128),
  issuedAt: z.string().datetime({ offset: true }),
  clinician: z.object({ displayName: z.string().min(1).max(200), organizationName: z.string().min(1).max(200) }),
  title: z.string().min(1).max(200),
  medications: z.array(z.object({
    name: z.string().min(1).max(200),
    dose: z.string().min(1).max(120),
    frequency: z.string().min(1).max(200),
    duration: z.string().max(200),
    instructions: z.string().max(1000),
  })).max(100),
  restrictions: z.array(z.string().min(1).max(500)).max(100),
  tests: z.array(z.string().min(1).max(500)).max(100),
  followUp: z.string().max(500).optional(),
}).strict();
export type CarePlanV1 = z.infer<typeof CarePlanV1>;

/** Import remains a preview until the patient explicitly confirms each applicable item. */
export function validateCarePlanV1(input: unknown): CarePlanV1 {
  return CarePlanV1.parse(input);
}
