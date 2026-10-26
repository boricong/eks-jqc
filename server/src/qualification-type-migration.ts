import { migrateCourseTypes } from "./course-type-migration.ts";
import { randomUUID } from "node:crypto";
import { migrationOrganizations as validateOrganizations } from "./automatic-criteria-migration.ts";

// Only explicit maintenance calls this function. Normal startup never upgrades files.
export function migrateQualificationTypes(
  input: unknown,
  organizationInput: unknown,
  at = new Date().toISOString(),
) {
  const raw = input as any;
  if (![13, 14, 15, 16, 17, 18, 19].includes(raw?.schemaVersion))
    throw new Error("인증 유형 이관에는 업무13·조직2가 필요합니다.");
  const organizations = validateOrganizations(organizationInput);
  const next = structuredClone(raw);
  const alreadyApplied = raw.schemaVersion === 19;
  const counts = {
    templates: next.qualificationTemplates.length,
    qualifications: next.qualifications.length,
    metadata: 0,
  };
  if (raw.schemaVersion === 13) {
    const values = [...next.qualificationTemplates, ...next.qualifications];
    for (const record of [
      ...next.plans,
      ...next.assignments,
      ...next.certifications,
    ]) {
      if (record.qualificationMetadata) {
        values.push(record.qualificationMetadata);
        counts.metadata++;
      }
    }
    for (const value of values) {
      if (
        value.qualificationType !== undefined &&
        value.qualificationType !== "auditee"
      )
        throw new Error(
          "구형 기록에 예상하지 못한 인증 유형이 있습니다. 원본을 확인해 주세요.",
        );
      value.qualificationType = "auditee";
    }
    next.schemaVersion = 14;
    next.revision++;
    const actorId = next.users.find((u: any) =>
      u.roles.includes("system_operator"),
    )?.id;
    if (!actorId) throw new Error("이관 기록을 남길 시스템 운영자가 없습니다.");
    next.audits.push({
      id: randomUUID(),
      actorId,
      date: at,
      action: "migration.qualification-types",
      targetId: "qualification-types-v14",
      reason: "기존 자격·보존 정보의 Auditee 유형 명시적 보존 이관",
      details: { fromSchema: 13, progressReset: false, ...counts },
    });
  }
  const state = migrateCourseTypes(next, organizations, at).state;
  return {
    state,
    organizations,
    report: {
      alreadyApplied,
      schemaVersion: state.schemaVersion,
      revision: state.revision,
      ...counts,
      organizationRevision: organizations.revision,
    },
  };
}
