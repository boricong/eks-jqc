import {
  currentTeamQualifications,
  effectiveCredentialStatus,
  qualificationUseErrors,
  type State,
  type Qualification,
  type QualificationTemplate,
  type StoredAssignment,
} from "@eks/contracts";
import { demand } from "./errors.ts";
export function auditorCriteria(
  s: Pick<State, "qualificationTemplates">,
  q: Qualification,
) {
  const t = s.qualificationTemplates.find((t) => t.id === q.templateId);
  return (
    q.auditorCriteria ||
    (t?.auditorLevel
      ? {
          level: t.auditorLevel,
          ...(t.prerequisiteTemplateId
            ? { prerequisiteTemplateId: t.prerequisiteTemplateId }
            : {}),
        }
      : undefined)
  );
}
export function auditorTemplateErrors(s: State, t: QualificationTemplate) {
  if (t.qualificationType !== "auditor") return [];
  const errors: string[] = [];
  if (!t.auditorLevel) errors.push("Auditor 등급을 지정해 주세요.");
  if (t.auditorLevel === "main" && t.scope !== "team") {
    const g = s.qualificationTemplates.find(
      (x) => x.id === t.prerequisiteTemplateId,
    );
    if (
      !g ||
      g.qualificationType !== "auditor" ||
      g.auditorLevel !== "general" ||
      g.scope === "team"
    )
      errors.push("선행 일반 기본자격 1개를 지정해 주세요.");
  }
  return errors;
}
export function currentAuditorQualifications(s: State, team: string) {
  return currentTeamQualifications(s)
    .filter((p) => p.lv1OrganizationId === team)
    .map((p) => s.qualifications.find((q) => q.id === p.qualificationId)!)
    .filter((q) => q.qualificationType === "auditor");
}
export function activeAuditorQualifications(s: State, team: string) {
  return currentAuditorQualifications(s, team).filter(
    (q) =>
      (q.lifecycleStatus || "Active") === "Active" && auditorCriteria(s, q),
  );
}
export function validateAuditorActivation(s: State, q: Qualification) {
  if (q.qualificationType !== "auditor") return;
  const t = s.qualificationTemplates.find((t) => t.id === q.templateId)!;
  const issues = [
    ...auditorTemplateErrors(s, t),
    ...qualificationUseErrors({ ...q, lifecycleStatus: "Active" }, s.courses),
  ];
  const c = auditorCriteria(s, q);
  demand(
    c && !issues.length,
    409,
    issues.join(" · ") || "Auditor 등급을 확인해 주세요.",
    "AUDITOR_NOT_READY",
  );
  const collision = activeAuditorQualifications(s, q.lv1OrganizationId).find(
    (other) =>
      other.entityId !== q.entityId &&
      auditorCriteria(s, other)?.level === c.level,
  );
  demand(
    !collision,
    409,
    `${collision?.title || ""}: 같은 등급의 Active 자격이 있습니다. 기존 자격을 Hold로 전환해 주세요.`,
    "AUDITOR_LEVEL_ACTIVE_CONFLICT",
  );
}
export function prerequisiteCertification(
  s: State,
  learnerId: string,
  team: string,
  templateId: string,
  at: string,
) {
  return s.certifications.find((c) => {
    const a = s.assignments.find((a) => a.id === c.assignmentId),
      q = s.qualifications.find((q) => q.id === c.qualificationId);
    return (
      c.learnerId === learnerId &&
      a?.lv1OrganizationId === team &&
      !a.excludedReason &&
      q?.templateId === templateId &&
      c.auditor?.level === "general" &&
      effectiveCredentialStatus(c, at) === "Active"
    );
  });
}
export function assignmentPrerequisite(
  s: State,
  a: StoredAssignment,
  at: string,
) {
  if (a.auditor?.criteriaPolicy === "pool")
    return a.auditor.prerequisiteTemplateId
      ? prerequisiteCertification(
          s,
          a.learnerId,
          a.lv1OrganizationId,
          a.auditor.prerequisiteTemplateId,
          at,
        )
      : undefined;
  return s.certifications.find(
    (c) =>
      c.learnerId === a.learnerId &&
      c.auditor?.level === "general" &&
      effectiveCredentialStatus(c, at) === "Active" &&
      !s.assignments.find((x) => x.id === c.assignmentId)?.excludedReason,
  );
}
export function validateAuditorPool(s: State) {
  const seen = new Set<string>();
  for (const t of s.qualificationTemplates) {
    if (t.qualificationType !== "auditor")
      demand(
        !t.auditorLevel && !t.prerequisiteTemplateId,
        422,
        "Auditee에는 Auditor 등급을 지정할 수 없습니다.",
      );
    if (t.prerequisiteTemplateId) {
      const g = s.qualificationTemplates.find(
        (g) => g.id === t.prerequisiteTemplateId,
      );
      demand(
        t.auditorLevel === "main" &&
          g?.qualificationType === "auditor" &&
          g.auditorLevel === "general" &&
          g.scope !== "team",
        422,
        "선행 일반 기본자격 참조를 확인해 주세요.",
      );
    }
  }
  for (const team of new Set(s.qualifications.map((q) => q.lv1OrganizationId)))
    for (const q of activeAuditorQualifications(s, team)) {
      const key = team + ":" + auditorCriteria(s, q)!.level;
      demand(
        !seen.has(key),
        422,
        "팀의 같은 등급 Active 자격은 하나만 허용합니다.",
      );
      seen.add(key);
    }
  for (const q of s.qualifications)
    if (q.auditorCriteria) {
      const t = s.qualificationTemplates.find((t) => t.id === q.templateId);
      demand(
        q.qualificationType === "auditor" &&
          t?.auditorLevel === q.auditorCriteria.level &&
          t.prerequisiteTemplateId === q.auditorCriteria.prerequisiteTemplateId,
        422,
        "팀 자격의 Auditor 기준 근거를 확인해 주세요.",
      );
    }
  for (const a of s.assignments)
    if (a.auditor?.criteriaPolicy === "pool") {
      const q = s.qualifications.find((q) => q.id === a.qualificationId)!;
      demand(
        a.auditor.level === auditorCriteria(s, q)?.level &&
          a.auditor.prerequisiteTemplateId ===
            auditorCriteria(s, q)?.prerequisiteTemplateId &&
          (a.auditor.level !== "main" || !!a.auditor.prerequisiteTemplateId),
        422,
        "Auditor 배정의 선행 조건 근거를 확인해 주세요.",
      );
    }
}
