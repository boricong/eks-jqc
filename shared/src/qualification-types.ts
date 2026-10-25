import { z } from "zod";
export const QualificationTypeSchema = z.enum(["auditee", "auditor"]);
export type QualificationType = z.infer<typeof QualificationTypeSchema>;
export const qualificationTypeLabels: Record<QualificationType, string> = {
  auditee: "Auditee",
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

export const roleForQualificationType = (type: QualificationType) =>
  type === "auditor" ? "evaluator" : "learner";
export const hasQualificationRole = (
  roles: readonly string[],
  type: QualificationType,
) => roles.includes(roleForQualificationType(type));
export const hasPersonalRole = (roles: readonly string[]) =>
  roles.includes("learner") || roles.includes("evaluator");
