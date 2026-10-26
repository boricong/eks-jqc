import { migrateRequiredQualifications } from "./required-qualification-migration.ts";
import { randomUUID } from "node:crypto";
import { validateState } from "./integrity.ts";
import { migrationOrganizations as validateOrganizations } from "./automatic-criteria-migration.ts";
/** Explicit preservation migration. Normal startup rejects schema 19. */
export function migrateCommonCourses(
  input: unknown,
  orgInput: unknown,
  at = new Date().toISOString(),
) {
  const state = structuredClone(input) as any,
    organizations = validateOrganizations(orgInput);
  if (![19, 20, 21, 22, 23, 24].includes(state?.schemaVersion))
    throw new Error("공통인증Set 이관에는 업무19·조직3이 필요합니다.");
  const alreadyApplied = state.schemaVersion >= 20;
  if (!alreadyApplied) {
    if (
      (state.commonCourses?.length ?? 0) > 0 ||
      state.courses.some(
        (c: any) =>
          (c.category !== undefined && c.category !== "specialized") ||
          c.commonCourseSource !== undefined,
      ) ||
      state.qualifications.some((q: any) => q.commonCourseEntityIds?.length) ||
      state.qualificationTemplates.some(
        (t: any) => t.defaultCommonCourseIds?.length,
      )
    )
      throw new Error(
        "업무19에 알 수 없는 공통인증Set 정보가 있습니다. 원본을 확인해 주세요.",
      );
    const actorId = state.users.find((u: any) =>
      u.roles.includes("system_operator"),
    )?.id;
    if (!actorId) throw new Error("시스템 운영자가 필요합니다.");
    state.schemaVersion = 20;
    state.revision++;
    state.commonCourses = [];
    for (const c of state.courses) c.category = "specialized";
    for (const q of state.qualifications) q.commonCourseEntityIds = [];
    for (const t of state.qualificationTemplates) t.defaultCommonCourseIds = [];
    state.audits.push({
      id: randomUUID(),
      actorId,
      date: at,
      action: "migration.common-courses",
      targetId: "common-courses-v20",
      reason:
        "공통 원본·등록 당시 선택 범위 추가, 기존 인증Set 특화 분류·업무 이력 보존",
      details: { fromSchema: 19, progressReset: false },
    });
  }
  const result = migrateRequiredQualifications(state, organizations, at, true);
  return {
    ...result,
    report: {
      ...result.report,
      alreadyApplied: alreadyApplied && result.report.alreadyApplied,
    },
  };
}
