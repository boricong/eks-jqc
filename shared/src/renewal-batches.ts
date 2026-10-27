import { z } from "zod";
export const QualificationPurposeSchema = z.enum(["acquisition", "renewal"]);
export const RenewalBatchSchema = z.object({
  id: z.string(),
  learnerId: z.string(),
  lv1OrganizationId: z.string(),
  qualificationId: z.string(),
  assignmentId: z.string(),
  revision: z.number().int().positive(),
  status: z.enum(["evaluating", "passed", "completed", "closed"]),
  startedAt: z.iso.datetime(),
  passedAt: z.iso.datetime().optional(),
  completedAt: z.iso.datetime().optional(),
  closedAt: z.iso.datetime().optional(),
  attemptId: z.string().optional(),
  completionId: z.string().optional(),
});
export type RenewalBatch = z.infer<typeof RenewalBatchSchema>;
export interface RenewalCandidate {
  certificationId: string;
  periodId?: string;
  revision: number;
  title: string;
  expiresOn?: string;
  nextExpiresOn?: string;
  opensOn?: string;
  reasons: string[];
}
export interface RenewalCandidates {
  stateRevision: number;
  organizationRevision: number;
  qualification: { id: string; title: string; revision: number } | null;
  reasons: string[];
  candidates: RenewalCandidate[];
  batches: RenewalBatch[];
}
export interface RenewalBatchView {
  batch: RenewalBatch;
  qualificationTitle: string;
  courseId: string;
  assessmentHref: string;
  canEvaluate: boolean;
  reasons: string[];
  score?: { earned: number; total: number; result: string };
  targets: {
    renewalId: string;
    certificationId: string;
    title: string;
    status: "pending" | "completed" | "closed";
    reasons: string[];
    expiresOn?: string;
    nextExpiresOn?: string;
    certificateHref: string;
  }[];
}
