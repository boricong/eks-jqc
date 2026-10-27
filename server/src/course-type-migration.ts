import { migrateAuditorWorkflow } from "./auditor-migration.ts";
import { randomUUID } from "node:crypto";
import { classifyCourseTypes } from "./course-types.ts";
import { validateState } from "./integrity.ts";
import { migrationOrganizations as validateOrganizations } from "./automatic-criteria-migration.ts";
export function migrateCourseTypes(
  input: unknown,
  organizationInput: unknown,
  at = new Date().toISOString(),
) {
  const raw = input as any;
  if (
    ![14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28].includes(
      raw?.schemaVersion,
    )
  )
    throw new Error("인증Set 유형 이관에는 업무14·조직2가 필요합니다.");
  const next = structuredClone(raw),
    organizations = validateOrganizations(organizationInput);
  const alreadyApplied = raw.schemaVersion >= 25;
  const classifications =
    raw.schemaVersion >= 15 ? [] : classifyCourseTypes(next);
  if (raw.schemaVersion === 14) {
    next.schemaVersion = 15;
    next.revision++;
    const actorId = next.users.find((u: any) =>
      u.roles.includes("system_operator"),
    )?.id;
    if (!actorId) throw new Error("이관 기록을 남길 시스템 운영자가 없습니다.");
    next.audits.push({
      id: randomUUID(),
      actorId,
      date: at,
      action: "migration.course-types",
      targetId: "course-types-v15",
      reason: "인증Set 계보의 연결 근거에 따른 유형 보존 이관",
      details: { fromSchema: 14, progressReset: false, classifications },
    });
  }
  const state = migrateAuditorWorkflow(next, organizations, at).state;
  return {
    state,
    organizations,
    report: {
      alreadyApplied,
      schemaVersion: state.schemaVersion,
      revision: state.revision,
      organizationRevision: organizations.revision,
      courses: state.courses.length,
      classifications,
    },
  };
}
