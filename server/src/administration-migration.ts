import { migrationOrganizations as validateOrganizations } from "./automatic-criteria-migration.ts";
import { migrateLifecycle } from "./lifecycle-migration.ts";

export function migrateAdministration(
  input: unknown,
  organizationInput: unknown,
) {
  const raw = input as any,
    organizations = validateOrganizations(organizationInput);
  if (
    ![
      7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
    ].includes(raw?.schemaVersion)
  )
    throw new Error(
      "업무 스키마 7과 조직 스키마 2가 필요합니다. 이전 버전은 먼저 조직 정책 이관을 실행하세요.",
    );
  const next = structuredClone(raw),
    alreadyApplied = raw.schemaVersion >= 8;
  if (!alreadyApplied) {
    next.schemaVersion = 8;
    next.revision++;
    next.notices = next.notices.map((n: any) => ({ ...n, scope: "team" }));
    next.audits.push({
      id: "administration-v8",
      actorId: next.users.find((u: any) => u.roles.includes("system_operator"))
        .id,
      date: new Date().toISOString(),
      action: "migration.administration",
      targetId: "administration-v8",
      reason:
        "팀·세부 조직 관리자 분리 및 시스템·팀 공지 구분. 기존 역할·공지·진행 보존",
      details: { fromSchema: 7 },
    });
  }
  const state = migrateLifecycle(next, organizations).state;
  return {
    state,
    organizations,
    report: {
      alreadyApplied: raw.schemaVersion === 25,
      revision: state.revision,
      organizationRevision: organizations.revision,
      notices: state.notices.length,
      users: state.users.length,
      plans: state.plans.length,
      assignments: state.assignments.length,
      attempts: state.attempts.length,
      completions: state.completions.length,
      certifications: state.certifications.length,
    },
  };
}
