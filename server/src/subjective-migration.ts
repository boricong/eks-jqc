import { migrateOrganizationNeeds } from "./organization-requirement-migration.ts";
import { randomUUID } from "node:crypto";
import { validateState } from "./integrity.ts";
import { validateOrganizations } from "./organizations.ts";
export function migrateSubjective(
  input: unknown,
  orgInput: unknown,
  at = new Date().toISOString(),
) {
  const raw = structuredClone(input) as any;
  const organizations = validateOrganizations(orgInput);
  if (![21, 22, 23].includes(raw?.schemaVersion))
    throw new Error(
      "주관식 답변 이관에는 업무21·조직4 또는 현행 파일이 필요합니다.",
    );
  if (raw.schemaVersion >= 22)
    return migrateOrganizationNeeds(raw, organizations, at);
  const alreadyApplied = false;
  if (!alreadyApplied) {
    if (raw.subjectiveResponses?.length)
      throw new Error(
        "이전 스키마에 주관식 답변이 있습니다. 원본을 확인해 주세요.",
      );
    for (const c of [...raw.courses, ...raw.commonCourses]) {
      if (c.subjectiveEnabled || c.subjectiveQuestions?.length)
        throw new Error(
          "이전 스키마에 주관식 내용이 있습니다. 원본을 확인해 주세요.",
        );
      c.subjectiveEnabled = false;
      c.subjectiveQuestions = [];
    }
    raw.subjectiveResponses = [];
    raw.schemaVersion = 22;
    raw.revision++;
    const actorId = raw.users.find((u: any) =>
      u.roles.includes("system_operator"),
    )?.id;
    if (!actorId) throw new Error("시스템 운영자가 필요합니다.");
    raw.audits.push({
      id: randomUUID(),
      actorId,
      date: at,
      action: "migration.subjective",
      targetId: "subjective-v22",
      reason: "수료 영향 없는 주관식 답변 수집 추가·기존 기록 보존",
      details: { fromSchema: 21, progressReset: false },
    });
  }
  const state = migrateOrganizationNeeds(raw, organizations, at).state;
  return {
    state,
    organizations,
    report: {
      alreadyApplied,
      schemaVersion: 23,
      organizationSchemaVersion: 4,
      revision: state.revision,
      organizationRevision: organizations.revision,
      progressReset: false,
    },
  };
}
