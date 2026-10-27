import { migrateObjectiveRenewals } from "./objective-renewal-migration.ts";
import { randomUUID } from "node:crypto";
import { validateState } from "./integrity.ts";
import { validateOrganizations } from "./organizations.ts";

export function initializeRequirementExceptions(raw: any) {
  for (const r of raw.organizationQualificationRequirements || [])
    r.exclusions ||= [];
  raw.schemaVersion = 27;
  return raw;
}
export function migrateRequirementExceptions(
  input: unknown,
  orgInput: unknown,
  at = new Date().toISOString(),
) {
  const raw = structuredClone(input) as any,
    organizations = validateOrganizations(orgInput);
  if (![26, 27, 28].includes(raw?.schemaVersion))
    throw Error("상속 예외 이관은 업무26 또는 현행27 파일이 필요합니다.");
  const alreadyApplied = raw.schemaVersion >= 27;
  if (!alreadyApplied) {
    if (
      raw.organizationQualificationRequirements?.some(
        (r: any) => r.exclusions?.length,
      )
    )
      throw Error("구형 업무26에 상속 예외가 있습니다. 원본을 확인해 주세요.");
    validateState(raw, organizations);
    initializeRequirementExceptions(raw);
    raw.revision++;
    raw.audits.push({
      id: randomUUID(),
      actorId: raw.users.find((u: any) => u.roles.includes("system_operator"))!
        .id,
      date: at,
      action: "migration.requirement-exceptions",
      targetId: "requirements-v27",
      reason: "상속 예외 추가·기존 필요자격과 업무 기록 보존",
      details: { fromSchema: 26, progressReset: false },
    });
  }
  const state = migrateObjectiveRenewals(raw, organizations, at).state;
  return {
    state,
    organizations,
    report: {
      alreadyApplied: alreadyApplied && (input as any).schemaVersion === 28,
      schemaVersion: 28,
      revision: state.revision,
      organizationRevision: organizations.revision,
      progressReset: false,
      requirements: state.organizationQualificationRequirements.length,
    },
  };
}
