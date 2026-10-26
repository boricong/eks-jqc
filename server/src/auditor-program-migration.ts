import { migrateAutomaticCriteria } from "./automatic-criteria-migration.ts";
import { randomUUID } from "node:crypto";
import { validateState } from "./integrity.ts";
import { migrationOrganizations as validateOrganizations } from "./automatic-criteria-migration.ts";

export function migrateAuditorProgram(
  input: unknown,
  organizationInput: unknown,
  at = new Date().toISOString(),
) {
  const raw = input as any;
  if (![16, 17, 18, 19].includes(raw?.schemaVersion))
    throw new Error("Auditor 자율 학습 이관에는 업무16·조직2가 필요합니다.");
  const next = structuredClone(raw),
    organizations = validateOrganizations(organizationInput),
    alreadyApplied = raw.schemaVersion === 19;
  if (raw.schemaVersion === 16) {
    if ((next.auditorPrograms || []).length)
      throw new Error("구형 데이터의 Auditor 운영 기준을 검토해 주세요.");
    const actorId = next.users.find((u: any) =>
      u.roles.includes("system_operator"),
    )?.id;
    if (!actorId) throw new Error("시스템 운영자가 필요합니다.");
    next.auditorPrograms = [];
    for (const t of next.qualificationTemplates) {
      if (t.scope && t.scope !== "system")
        throw new Error("구형 기본자격 소유권을 검토해 주세요.");
      t.scope = "system";
    }
    for (const u of next.users)
      if (u.roles.includes("evaluator")) {
        if (u.auditorDesignation)
          throw new Error("구형 지정 이력을 검토해 주세요.");
        u.auditorDesignation = {
          id: randomUUID(),
          actorId,
          at,
          source: "migration",
        };
      }
    next.schemaVersion = 17;
    next.revision++;
    next.audits.push({
      id: randomUUID(),
      actorId,
      date: at,
      action: "migration.auditor-program",
      targetId: "auditor-program-v17",
      reason:
        "Auditor 자율 학습·일반/메인 인증 도입, 기존 등급 미지정 기록 보존",
      details: { fromSchema: 16, progressReset: false, noticesSent: 0 },
    });
  }
  const state = migrateAutomaticCriteria(next, organizations, at).state;
  return {
    state,
    organizations,
    report: {
      alreadyApplied,
      schemaVersion: state.schemaVersion,
      revision: state.revision,
      organizationRevision: organizations.revision,
      existingAuditors: state.users.filter((u) => u.roles.includes("evaluator"))
        .length,
      legacyAuditorCertifications: state.certifications.filter(
        (c) =>
          !c.auditor &&
          state.qualifications.find((q) => q.id === c.qualificationId)
            ?.qualificationType === "auditor",
      ).length,
      noticesSent: 0,
    },
  };
}
