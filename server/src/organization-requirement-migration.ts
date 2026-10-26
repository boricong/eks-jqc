import { migrateAuditorPool } from "./auditor-pool-migration.ts";
import { randomUUID } from "node:crypto";
import { validateState } from "./integrity.ts";
import { validateOrganizations } from "./organizations.ts";
export function migrateOrganizationNeeds(
  input: unknown,
  orgInput: unknown,
  at = new Date().toISOString(),
) {
  const raw = structuredClone(input) as any,
    organizations = validateOrganizations(orgInput);
  if (![22, 23, 24].includes(raw?.schemaVersion))
    throw Error(
      "조직 필요자격 이관에는 업무22·조직4 또는 현행 파일이 필요합니다.",
    );
  if (raw.schemaVersion >= 23)
    return migrateAuditorPool(raw, organizations, at);
  const alreadyApplied = false;
  if (!alreadyApplied) {
    if (
      raw.organizationQualificationRequirements?.length ||
      raw.planningRequests?.some(
        (r: any) =>
          r.mode === "organization_required" ||
          r.requirementSnapshot ||
          r.closed,
      )
    )
      throw Error(
        "구형 스키마에 새 필요자격 정보가 있습니다. 원본을 확인해 주세요.",
      );
    raw.organizationQualificationRequirements = [];
    raw.schemaVersion = 23;
    raw.revision++;
    const actorId = raw.users.find((u: any) =>
      u.roles.includes("system_operator"),
    )?.id;
    if (!actorId) throw Error("시스템 운영자가 필요합니다.");
    raw.audits.push({
      id: randomUUID(),
      actorId,
      date: at,
      action: "migration.organization-needs",
      targetId: "organization-needs-v23",
      reason: "조직 필요자격 상속 추가·기존 요청과 업무 기록 보존",
      details: { fromSchema: 22, progressReset: false },
    });
  }
  const state = migrateAuditorPool(raw, organizations, at).state;
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
