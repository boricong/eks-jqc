import { randomUUID } from "node:crypto";
import { validateState } from "./integrity.ts";
import { validateOrganizations } from "./organizations.ts";
export function migrateAuditorPool(
  input: unknown,
  orgInput: unknown,
  at = new Date().toISOString(),
) {
  const raw = structuredClone(input) as any,
    organizations = validateOrganizations(orgInput);
  if (![23, 24].includes(raw?.schemaVersion))
    throw Error("Auditor 풀 이관은 업무23·조직4 또는 현행 파일이 필요합니다.");
  const alreadyApplied = raw.schemaVersion === 24;
  if (!alreadyApplied) {
    if (
      raw.qualifications?.some((q: any) => q.auditorCriteria) ||
      raw.qualificationTemplates?.some(
        (t: any) =>
          t.prerequisiteTemplateId || (t.scope !== "team" && t.auditorLevel),
      ) ||
      raw.assignments?.some((a: any) => a.auditor?.criteriaPolicy)
    )
      throw Error("구형 파일에 신규 Auditor 기준이 있습니다.");
    raw.schemaVersion = 24;
    raw.revision++;
    const actorId = raw.users.find((u: any) =>
      u.roles.includes("system_operator"),
    )?.id;
    if (!actorId) throw Error("시스템 운영자가 필요합니다.");
    raw.audits.push({
      id: randomUUID(),
      actorId,
      date: at,
      action: "migration.auditor-pool",
      targetId: "auditor-pool-v24",
      reason: "Auditor 풀 등록 전환·등급 추정 없이 기존 업무 보존",
      details: { fromSchema: 23, progressReset: false },
    });
  }
  const state = validateState(raw, organizations);
  return {
    state,
    organizations,
    report: {
      alreadyApplied,
      schemaVersion: 24,
      organizationSchemaVersion: 4,
      revision: state.revision,
      organizationRevision: organizations.revision,
      progressReset: false,
    },
  };
}
