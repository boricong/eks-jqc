import { z } from "zod";

const id = z
  .string()
  .min(1)
  .max(160)
  .refine((v) => !["__proto__", "constructor", "prototype"].includes(v));
const text = z.string().max(20000);
export const GROUP_PRACTICAL_CONTRACT = "6";
export const GroupPracticalConfigSchema = z
  .object({
    instruction: text,
    method: z.string().max(300),
    criterion: text,
    metrics: z
      .array(
        z
          .object({
            id,
            label: z.string().max(200),
            type: z.enum(["number", "text"]),
            unit: z.string().max(80),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();
export type GroupPracticalConfig = z.infer<typeof GroupPracticalConfigSchema>;
export function groupPracticalErrors(config: GroupPracticalConfig): string[] {
  return [
    !config.instruction.trim() && "그룹 실기 수행 지침을 입력해 주세요.",
    !config.method.trim() && "분석 방법을 입력해 주세요.",
    !config.criterion.trim() && "공동 판정 기준을 입력해 주세요.",
    !config.metrics.length && "필수 분석 결과 항목을 추가해 주세요.",
    config.metrics.some((m) => !m.label.trim()) &&
      "분석 결과 항목명을 입력해 주세요.",
    new Set(config.metrics.map((m) => m.id)).size !== config.metrics.length &&
      "분석 결과 항목 ID가 중복되었습니다.",
  ].filter((v): v is string => !!v);
}
export const GroupTrialSchema = z
  .object({
    learnerId: id,
    number: z.number().int().min(1).max(3),
    revision: z.number().int().positive(),
    performedOn: z.union([z.literal(""), z.iso.date()]),
    evidence: z
      .array(z.object({ fileId: id, locator: z.string().max(1000) }).strict())
      .max(20),
    note: z.string().max(2000),
    completed: z.boolean(),
    updatedBy: id.optional(),
    updatedAt: z.iso.datetime().optional(),
  })
  .strict();
export type GroupTrial = z.infer<typeof GroupTrialSchema>;
export const GroupAnalysisSchema = z
  .object({
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    values: z.record(id, z.union([z.number().finite(), z.string().max(2000)])),
    reportFileIds: z.array(id).max(20),
    reason: z.string().max(2000),
    result: z.enum(["passed", "failed"]),
    dataVerified: z.boolean(),
    registeredBy: id,
    registeredAt: z.iso.datetime(),
  })
  .strict();
export type GroupAnalysis = z.infer<typeof GroupAnalysisSchema>;
export const GroupDecisionSchema = z
  .object({
    id,
    result: z.enum(["passed", "failed"]),
    decidedBy: id,
    decidedAt: z.iso.datetime(),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    analysisHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const GroupRunSchema = z
  .object({
    id,
    number: z.number().int().positive(),
    revision: z.number().int().positive(),
    status: z.enum([
      "collecting",
      "reviewing",
      "passed",
      "failed",
      "invalidated",
    ]),
    createdAt: z.iso.datetime(),
    trials: z.array(GroupTrialSchema).max(12),
    analysis: GroupAnalysisSchema.optional(),
    previousAnalyses: z.array(GroupAnalysisSchema),
    decision: GroupDecisionSchema.optional(),
    invalidation: z
      .object({
        by: id,
        at: z.iso.datetime(),
        reason: z.string().min(1).max(2000),
      })
      .strict()
      .optional(),
  })
  .strict();
export type GroupRun = z.infer<typeof GroupRunSchema>;
export const GroupAssessmentSchema = z
  .object({
    id,
    title: z.string().trim().min(1).max(200),
    lv1OrganizationId: id,
    courseId: id,
    evaluatorId: id,
    revision: z.number().int().positive(),
    status: z.enum(["draft", "active", "passed", "closed"]),
    members: z
      .array(
        z
          .object({
            learnerId: id,
            enrollmentId: id,
            name: z.string().min(1).max(100),
          })
          .strict(),
      )
      .min(3)
      .max(4),
    createdBy: id,
    createdAt: z.iso.datetime(),
    startedAt: z.iso.datetime().optional(),
    courseHash: z.string().optional(),
    closed: z
      .object({
        by: id,
        at: z.iso.datetime(),
        reason: z.string().min(1).max(2000),
      })
      .strict()
      .optional(),
    runs: z.array(GroupRunSchema),
    environment: z.literal("trial"),
  })
  .strict();
export type GroupAssessment = z.infer<typeof GroupAssessmentSchema>;
export const GroupFileSchema = z
  .object({
    id,
    groupId: id,
    runId: id,
    kind: z.enum(["raw", "report"]),
    name: z.string().min(1).max(240),
    bytes: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    mediaType: z.enum([
      "text/csv",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/pdf",
    ]),
    uploadedBy: id,
    uploadedAt: z.iso.datetime(),
  })
  .strict();
export type GroupFile = z.infer<typeof GroupFileSchema>;
export const GroupCompletionEvidenceSchema = z
  .object({
    groupId: id,
    runId: id,
    decisionId: id,
    sourceHash: z.string(),
    evaluatorId: id,
    environment: z.literal("trial"),
  })
  .strict();
export type GroupCompletionEvidence = z.infer<
  typeof GroupCompletionEvidenceSchema
>;
export interface GroupAssessmentPreview {
  token: string;
  blockers: string[];
  result?: "passed" | "failed";
  outcomes: {
    learnerId: string;
    name: string;
    enrollmentId: string;
    qualificationTitle: string;
    wouldComplete: boolean;
    wouldCertify: boolean;
    certificationId?: string;
  }[];
}
export interface GroupPersonalProgress {
  groupId: string;
  title: string;
  runNumber: number;
  status: GroupRun["status"] | "draft" | "closed";
  completed: number;
  blockers: string[];
  result?: "passed" | "failed";
  invalidated: boolean;
  environment: "trial";
}
