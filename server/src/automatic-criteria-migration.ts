import { migrateOrganizationRequirements } from "./required-qualification-migration.ts";
import { randomUUID } from "node:crypto";
import { migrateReadyQualifications } from "./ready-qualification-migration.ts";
import { validateOrganizations } from "./organizations.ts";

/** Only explicit migration/import paths call this converter. Normal loads reject v2. */
export function migrationOrganizations(
  input: unknown,
  actorId = "migration",
  at = new Date().toISOString(),
) {
  const org = structuredClone(input) as any;
  if (org?.schemaVersion === 2) {
    const before = org.qualificationPools || [];
    delete org.qualificationPools;
    org.schemaVersion = 3;
    org.revision++;
    org.audits.push({
      id: randomUUID(),
      actorId,
      date: at,
      targetId: "automatic-criteria-v3",
      action: "migration.automatic-criteria",
      before,
      after: { selection: "latest-non-deleted" },
    });
  }
  return migrateOrganizationRequirements(org, actorId, at);
}

export function migrateAutomaticCriteria(
  input: unknown,
  organizationInput: unknown,
  at = new Date().toISOString(),
) {
  const state = structuredClone(input) as any;
  if (![17, 18, 19, 20, 21, 22, 23, 24, 25].includes(state?.schemaVersion))
    throw new Error("최신 기준 이관에는 업무17·조직2가 필요합니다.");
  const actorId = state.users.find((u: any) =>
    u.roles.includes("system_operator"),
  )?.id;
  if (!actorId) throw new Error("시스템 운영자가 필요합니다.");
  const organizations = migrationOrganizations(organizationInput, actorId, at);
  const alreadyApplied = state.schemaVersion >= 18;
  if (!alreadyApplied) {
    for (const program of state.auditorPrograms)
      for (const level of ["general", "main"]) {
        const ref = program[level];
        if (!ref) continue;
        const q = state.qualifications.find(
          (q: any) => q.id === ref.qualificationId,
        );
        if (
          !q ||
          q.templateId !== ref.templateId ||
          q.lv1OrganizationId !== program.lv1OrganizationId
        )
          throw new Error("Auditor 기준 계보 연결을 확인해 주세요.");
        program[level] = { templateId: ref.templateId, entityId: q.entityId };
      }
    state.schemaVersion = 18;
    state.revision++;
    state.audits.push({
      id: randomUUID(),
      actorId,
      date: at,
      action: "migration.automatic-criteria",
      targetId: "automatic-criteria-v18",
      reason: "설명 선택화·최신 기준 자동 사용, 확정 근거 보존",
      details: { fromSchema: 17, progressReset: false },
    });
  }
  return migrateReadyQualifications(state, organizations, at);
}
