import { migrateTemplates } from "./template-migration.ts";
import { migrationOrganizations as validateOrganizations } from "./automatic-criteria-migration.ts";

export function migrateCatalogEditing(
  input: unknown,
  organizationInput: unknown,
  at = new Date().toISOString(),
) {
  const raw = input as any;
  if (
    ![10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25].includes(
      raw?.schemaVersion,
    )
  )
    throw new Error(
      "기준 편집 보존 이관에는 업무 스키마10·조직 스키마2가 필요합니다.",
    );
  const organizations = validateOrganizations(organizationInput);
  const next = structuredClone(raw),
    alreadyApplied = raw.schemaVersion >= 11;
  if (!alreadyApplied) {
    next.schemaVersion = 11;
    next.revision++;
    for (const item of [...next.qualifications, ...next.courses]) {
      delete item.status;
      delete item.publishedAt;
    }
    next.audits.push({
      id: "catalog-editing-v11",
      actorId: next.users.find((u: any) => u.roles.includes("system_operator"))
        ?.id,
      action: "migration.catalog-editing",
      targetId: "catalog-editing-v11",
      date: at,
      reason: "기준 직접 저장·참조별 자동 버전·선택 자격 삭제 보존 이관",
      details: { fromSchema: 10, progressReset: false },
    });
  }
  const state = migrateTemplates(next, organizations, at).state;
  return {
    state,
    organizations,
    report: {
      alreadyApplied: raw.schemaVersion === 25,
      schemaVersion: state.schemaVersion,
      revision: state.revision,
      qualifications: state.qualifications.length,
      courses: state.courses.length,
      plans: state.plans.length,
      assignments: state.assignments.length,
      attempts: state.attempts.length,
      completions: state.completions.length,
      certifications: state.certifications.length,
      organizationRevision: organizations.revision,
    },
  };
}
