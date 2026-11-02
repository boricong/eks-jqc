import { z } from "zod";
export const QualificationTypeSchema = z.enum(["auditee", "auditor"]);
export type QualificationType = z.infer<typeof QualificationTypeSchema>;
export const qualificationTypeLabels: Record<QualificationType, string> = {
  auditee: "자격",
  auditor: "Auditor",
};
export const AUDITOR_PREPARATION_MESSAGE =
  "Auditor는 필수 학습항목을 본인이 모두 확인하면 수료됩니다.";
export function qualificationProcessErrors(q: {
  qualificationType: QualificationType;
}): string[] {
  return [];
}
export function recordQualificationType(
  q: { qualificationType: QualificationType },
  record: {
    qualificationMetadata?: { qualificationType: QualificationType };
    certification?: {
      qualificationMetadata?: { qualificationType: QualificationType };
    };
  },
): QualificationType {
  return (
    record.certification?.qualificationMetadata?.qualificationType ??
    record.qualificationMetadata?.qualificationType ??
    q.qualificationType
  );
}

/** 과거 개인 지정 기록을 해석하는 호환 함수. 현재 권한에는 hasQualificationEligibility를 사용한다. */
export const roleForQualificationType = (type: QualificationType) =>
  type === "auditor" ? "evaluator" : "learner";
export const hasQualificationRole = (
  roles: readonly string[],
  type: QualificationType,
) => roles.includes(roleForQualificationType(type));
export const hasPersonalRole = (roles: readonly string[]) =>
  roles.includes("learner") || roles.includes("evaluator");
export const hasQualificationEligibility = (
  user: { roles: readonly string[]; auditorEnabled?: boolean },
  type: QualificationType,
) =>
  type === "auditor"
    ? user.auditorEnabled === true
    : user.roles.includes("learner");
