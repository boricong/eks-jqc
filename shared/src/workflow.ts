import { ReleaseVersionSchema, FrozenCriteriaSchema } from "./releases.ts";
import {
  QualificationTypeSchema,
  type QualificationType,
} from "./qualification-types.ts";
import { QualificationMetadataSchema } from "./qualification-templates.ts";
import { renewalOpensOn } from "./lifecycle.ts";
import { z } from "zod";
import { OrganizationPathSchema } from "./organizations.ts";

const id = z
  .string()
  .min(1)
  .max(160)
  .refine((v) => !["__proto__", "constructor", "prototype"].includes(v));
export const PlanStartInputSchema = z.object({
  requestId: id,
  requestRevision: z.number().int().positive(),
  qualificationId: id,
});
export type PlanStartInput = z.infer<typeof PlanStartInputSchema>;
const dateOrEmpty = z.union([z.literal(""), z.iso.date()]);
export const WORKFLOW_VERSION = "personal-certification-v6";
export const workflowSteps = [
  ["person", "신규 인력 확인"],
  ["organization", "운영 조직 지정"],
  ["invitation", "계획 수립 요청"],
  ["selection", "자격 선택"],
  ["schedule", "일정 수립"],
  ["goals", "학습 목표(선택)"],
  ["approval", "결재 생략"],
  ["plan", "계획 완료"],
  ["learning-assessment", "학습·평가"],
  ["completion", "인증Set 수료"],
  ["certification", "자격 인증"],
  ["expiry", "유효기간·재인증"],
] as const;
export const ValiditySchema = z.object({
  type: z.enum(["unknown", "months", "unlimited"]),
  months: z.number().int().min(1).max(1200).nullable(),
  reminderDays: z.array(z.number().int().min(1).max(36500)).max(20),
});
export type ValidityPolicy = z.infer<typeof ValiditySchema>;
export const QualificationVersionModeSchema = z.enum(["current", "new"]);
export type QualificationVersionMode = z.infer<
  typeof QualificationVersionModeSchema
>;
export const QualificationPolicySnapshotSchema = z.object({
  releaseVersion: ReleaseVersionSchema.optional(),
  id,
  entityId: id,
  version: z.number().int().positive(),
  revision: z.number().int().positive(),
  courseIds: z.array(id).max(100),
  validity: ValiditySchema,
  renewalLeadMonths: z.number().int().min(1).max(1200).default(3),
  renewalNoticeDaysBefore: z.number().int().min(0).max(365).default(7),
});
export type QualificationPolicySnapshot = z.infer<
  typeof QualificationPolicySnapshotSchema
>;
export const unknownValidity = (): ValidityPolicy => ({
  type: "unknown",
  months: null,
  reminderDays: [],
});
export function validityErrors(v: ValidityPolicy): string[] {
  if (v.type === "unknown")
    return ["인증기간을 기간제 또는 무기한으로 지정해 주세요."];
  if (v.type === "months" && !v.months)
    return ["유효 개월 수를 지정해 주세요."];
  if (new Set(v.reminderDays).size !== v.reminderDays.length)
    return ["알림 시점이 중복되었습니다."];
  if (v.type !== "months" && (v.months !== null || v.reminderDays.length))
    return ["무기한 자격에는 기간과 만료 알림을 설정할 수 없습니다."];
  return [];
}
export const LearningItemSchema = z.object({
  id,
  catalogCode: z.string().max(160).optional(),
  title: z.string().max(300),
  type: z.enum(["mtc", "team", "ojt"]),
  required: z.boolean(),
});
export const learningTypeLabels = {
  mtc: "MTC교육",
  team: "팀 특화 교육",
  ojt: "현업 OJT",
};
export const AwardSnapshotSchema = z.object({
  releaseVersion: ReleaseVersionSchema.optional(),
  learnerName: z.string().min(1),
  organizationPath: OrganizationPathSchema,
  title: z.string(),
  version: z.number().int().positive(),
  source: z.enum(["issued", "migration"]),
});
export const PlanningTargetSchema = z.object({
  releaseVersion: ReleaseVersionSchema.optional(),
  entityId: id,
  qualificationId: id,
  title: z.string(),
  version: z.number().int().positive(),
  previousCertificationId: id.optional(),
});
export const PlanningRequestSchema = z.object({
  qualificationType: QualificationTypeSchema.default("auditee"),
  id,
  lv1OrganizationId: id,
  learnerId: id,
  requestedBy: id,
  dueOn: z.iso.date(),
  message: z.string().max(2000),
  createdAt: z.iso.datetime(),
  revision: z.number().int().positive(),
  organizationId: id.optional(),
  organizationPath: OrganizationPathSchema.optional(),
  mode: z
    .enum(["fixed", "learner_choice", "organization_required"])
    .default("fixed"),
  selections: z.array(PlanningTargetSchema).default([]),
  requirementSnapshot: z
    .object({
      ruleVersion: z.literal(2).optional(),
      rules: z
        .array(
          z.object({
            organizationId: id,
            revision: z.number().int().nonnegative(),
            entityIds: z.array(id),
            excludedEntityIds: z.array(id),
          }),
        )
        .optional(),
      stateRevision: z.number().int().nonnegative(),
      organizationRevision: z.number().int().nonnegative(),
      sources: z.array(
        z.object({ entityId: id, organizations: OrganizationPathSchema }),
      ),
    })
    .optional(),
  closed: z
    .object({
      date: z.iso.datetime(),
      actorId: id,
      reason: z.string().trim().min(1).max(2000),
      replacementRequestId: id.optional(),
    })
    .optional(),
  completion: z
    .object({
      date: z.iso.datetime(),
      reason: z.enum(["planned", "no_additional"]),
      evidence: z.array(
        z.object({
          entityId: id,
          planId: id.optional(),
          assignmentId: id.optional(),
          certificationId: id.optional(),
        }),
      ),
    })
    .optional(),
  source: z.enum(["requested", "migration"]).optional(),
});
export type PlanningRequest = z.infer<typeof PlanningRequestSchema>;
export const PlanScheduleSchema = z.object({
  courseId: id,
  learningStart: dateOrEmpty,
  learningEnd: dateOrEmpty,
  assessmentOn: dateOrEmpty,
  goal: z.string().max(2000),
});
export const PersonalPlanSchema = z.object({
  frozenCriteria: FrozenCriteriaSchema.optional(),
  qualificationMetadata: QualificationMetadataSchema.optional(),
  qualificationPolicySnapshot: QualificationPolicySnapshotSchema.optional(),
  id,
  acquisitionCycleId: id.optional(),
  previousCertificationId: id.optional(),
  lv1OrganizationId: id,
  learnerId: id,
  requestId: id,
  qualificationId: id,
  workflowVersion: z.enum([
    "personal-certification-v2",
    "personal-certification-v3",
    "personal-certification-v4",
    "personal-certification-v5",
    WORKFLOW_VERSION,
  ]),
  organizationId: id.optional(),
  policyRevision: z.number().int().nonnegative().optional(),
  status: z.enum(["draft", "completed"]),
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  scheduleDefaultsAppliedAt: z.iso.datetime().optional(),
  deletedAt: z.iso.datetime().optional(),
  deletedBy: id.optional(),
  startOn: dateOrEmpty,
  endOn: dateOrEmpty,
  goal: z.string().max(2000),
  previousSchedule: z
    .object({
      workflowVersion: z.string(),
      targetOn: dateOrEmpty,
      schedules: z.array(PlanScheduleSchema).max(100),
      migratedAt: z.iso.datetime(),
      goalNeedsReview: z.boolean(),
    })
    .strict()
    .optional(),
  completedAt: z.iso.datetime().optional(),
  assignmentId: id.optional(),
  approval: z.literal("skipped_by_policy").optional(),
});
export const LegacyPersonalPlanSchema = PersonalPlanSchema.omit({
  startOn: true,
  endOn: true,
  goal: true,
  previousSchedule: true,
}).extend({
  workflowVersion: z.enum([
    "personal-certification-v2",
    "personal-certification-v3",
    "personal-certification-v4",
    "personal-certification-v5",
  ]),
  targetOn: dateOrEmpty,
  schedules: z.array(PlanScheduleSchema).max(100),
});
export type PersonalPlan = z.infer<typeof PersonalPlanSchema>;
export function planErrors(
  p: Pick<PersonalPlan, "startOn" | "endOn">,
  _type: QualificationType = "auditee",
): string[] {
  const errors: string[] = [];
  if (!p.startOn) errors.push("시작일을 입력해 주세요.");
  if (!p.endOn) errors.push("종료일을 입력해 주세요.");
  if (p.startOn && p.endOn && p.startOn > p.endOn)
    errors.push("종료일은 시작일 이후여야 합니다.");
  return errors;
}
export const LearningRecordSchema = z.object({
  id,
  enrollmentId: id,
  itemId: id,
  learnerId: id,
  revision: z.number().int().positive(),
  performedOn: z.iso.date(),
  content: z.string().trim().min(1).max(20000),
  evidenceUrl: z.union([
    z.literal(""),
    z.url().refine((v) => ["http:", "https:"].includes(new URL(v).protocol)),
  ]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type LearningRecord = z.infer<typeof LearningRecordSchema>;
export const NotificationSchema = z.object({
  auditorNotice: z
    .object({
      revision: z.number().int().nonnegative(),
      title: z.string(),
      body: z.string(),
      links: z.array(
        z.object({
          title: z.string(),
          url: z
            .url()
            .refine((v) => ["http:", "https:"].includes(new URL(v).protocol)),
        }),
      ),
    })
    .optional(),
  qualificationType: QualificationTypeSchema.optional(),
  id,
  key: z.string().max(500),
  lv1OrganizationId: id,
  recipientId: id,
  type: z.enum([
    "planning",
    "auditor_designation",
    "assessment",
    "result",
    "completion",
    "certification",
    "expiry",
    "expired",
    "renewal",
    "lifecycle",
  ]),
  title: z.string().max(500),
  body: z.string().max(2000),
  href: z.string().max(500).startsWith("/"),
  createdAt: z.iso.datetime(),
  scheduledOn: z.iso.date().optional(),
  readAt: z.iso.datetime().optional(),
  assignmentId: id.optional(),
  certificationId: id.optional(),
  periodId: id.optional(),
  resolvedAt: z.iso.datetime().optional(),
});
export type Notification = z.infer<typeof NotificationSchema>;
export function kstDate(value: string | Date = new Date()): string {
  return new Date(new Date(value).getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}
/** Calendar dates, independent of the server's local timezone and daylight saving. */
export function defaultPlanSchedule(
  value: string | Date = new Date(),
  existingStart?: string,
) {
  const addDays = (date: string, days: number) => {
    const result = new Date(`${date}T00:00:00.000Z`);
    result.setUTCDate(result.getUTCDate() + days);
    return result.toISOString().slice(0, 10);
  };
  const learningStart = existingStart || addDays(kstDate(value), 7);
  return {
    startOn: learningStart,
    endOn: addDays(learningStart, 21),
  };
}
export function expirationDate(
  issuedAt: string,
  policy: ValidityPolicy,
): string | undefined {
  if (policy.type !== "months" || !policy.months) return undefined;
  const [year, month, day] = kstDate(issuedAt).split("-").map(Number);
  const first = new Date(Date.UTC(year!, month! - 1 + policy.months, 1));
  const last = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day!, last)),
  )
    .toISOString()
    .slice(0, 10);
}
export function daysUntil(on: string, at: string | Date = new Date()): number {
  return Math.round((Date.parse(on) - Date.parse(kstDate(at))) / 86400000);
}
export function certificationStatus(
  c: {
    validity?: ValidityPolicy;
    expiresOn?: string;
    lifecycleStatus?: string;
    periods?: {
      validity: ValidityPolicy;
      expiresOn?: string;
      startsOn?: string;
      renewalLeadMonths?: number;
    }[];
  },
  at: string | Date = new Date(),
): "unknown" | "valid" | "expiring" | "expired" | "held" | "revoked" {
  const p = c.periods?.at(-1);
  c = { ...c, ...(p ? { validity: p.validity, expiresOn: p.expiresOn } : {}) };
  if (c.lifecycleStatus === "Revoke") return "revoked";
  if (!c.validity || c.validity.type === "unknown") return "unknown";
  if (c.expiresOn && daysUntil(c.expiresOn, at) < 0)
    return c.lifecycleStatus ? "revoked" : "expired";
  if (c.lifecycleStatus === "Hold") return "held";
  if (c.validity.type === "unlimited") return "valid";
  if (!c.expiresOn) return "unknown";
  const opensOn = renewalOpensOn({
    validity: c.validity,
    expiresOn: c.expiresOn,
    startsOn: p?.startsOn || "0001-01-01",
    renewalLeadMonths: p?.renewalLeadMonths ?? 3,
  });
  return opensOn && kstDate(at) >= opensOn ? "expiring" : "valid";
}
export const certificationStatusLabels = {
  held: "Hold · 효력 정지",
  revoked: "Revoke · 폐기",
  unknown: "유효기간 미설정 · 기존 기록",
  valid: "유효",
  expiring: "재인증 기간",
  expired: "만료",
};

export function defaultPlanningDueOn(value: string | Date = new Date()) {
  const date = new Date(`${kstDate(value)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 28);
  return date.toISOString().slice(0, 10);
}
