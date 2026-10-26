import { migrateCommonCourses } from "./common-course-migration.ts";
import { randomUUID } from "node:crypto";
import { validateState } from "./integrity.ts";
import { migrationOrganizations as validateOrganizations } from "./automatic-criteria-migration.ts";

export function migrateReadyQualifications(
  input: unknown,
  orgInput: unknown,
  at = new Date().toISOString(),
) {
  const state = structuredClone(input) as any;
  if (![18, 19, 20, 21, 22, 23, 24].includes(state?.schemaVersion))
    throw new Error("Ready 이관에는 업무18·조직3이 필요합니다.");
  const organizations = validateOrganizations(orgInput),
    alreadyApplied = state.schemaVersion >= 19;
  if (!alreadyApplied) {
    if (
      !state.qualifications.every(
        (q: any) =>
          Number.isInteger(q.version) &&
          q.version > 0 &&
          q.lifecycleStatus !== "Ready",
      )
    )
      throw new Error("이전 자격 버전 근거를 확인해 주세요.");
    const actorId = state.users.find((u: any) =>
      u.roles.includes("system_operator"),
    )?.id;
    if (!actorId) throw new Error("시스템 운영자가 필요합니다.");
    state.schemaVersion = 19;
    state.revision++;
    state.audits.push({
      id: randomUUID(),
      actorId,
      date: at,
      action: "migration.ready-qualifications",
      targetId: "ready-v19",
      reason: "Auditee Ready 최초 등록·v1 시작 분리, 기존 버전 보존",
      details: { fromSchema: 18, progressReset: false },
    });
  }
  const result = migrateCommonCourses(state, organizations, at);
  return {
    ...result,
    report: {
      ...result.report,
      alreadyApplied: alreadyApplied && result.report.alreadyApplied,
    },
  };
}
