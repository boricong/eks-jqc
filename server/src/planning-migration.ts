import { migrateQualificationTypes } from "./qualification-type-migration.ts";
import { randomUUID } from "node:crypto";
import { validateState } from "./integrity.ts";
import { migrationOrganizations as validateOrganizations } from "./automatic-criteria-migration.ts";
export function migratePlanning(
  input: unknown,
  organizationInput: unknown,
  at = new Date().toISOString(),
) {
  const raw = input as any;
  if (
    ![12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24].includes(
      raw?.schemaVersion,
    )
  )
    throw new Error("계획 요청 이관에는 업무12·조직2가 필요합니다.");
  const organizations = validateOrganizations(organizationInput),
    next = structuredClone(raw);
  const alreadyApplied = raw.schemaVersion >= 13;
  if (!alreadyApplied) {
    next.schemaVersion = 13;
    next.revision++;
    for (const r of next.planningRequests) {
      r.mode = "fixed";
      r.selections = [];
      // Historical request scope is evidence, never infer it from current policies.
    }
    next.audits.push({
      id: randomUUID(),
      actorId: next.users.find((u: any) => u.roles.includes("system_operator"))
        .id,
      date: at,
      action: "migration.planning",
      targetId: "planning-v13",
      reason: "선택적 조직 필수 자격·학습자 선택·요청 전체 완료 보존 이관",
      details: { fromSchema: 12, progressReset: false },
    });
  }
  const state = migrateQualificationTypes(next, organizations, at).state;
  return {
    state,
    organizations,
    report: {
      alreadyApplied: raw.schemaVersion === 24,
      schemaVersion: state.schemaVersion,
      revision: state.revision,
      requests: state.planningRequests.length,
      plans: state.plans.length,
      assignments: state.assignments.length,
      certifications: state.certifications.length,
      organizationRevision: organizations.revision,
    },
  };
}
