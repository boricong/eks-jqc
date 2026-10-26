import { migrateAuditorProgram } from "./auditor-program-migration.ts";
import { randomUUID } from "node:crypto";
import { validateState } from "./integrity.ts";
import { migrationOrganizations as validateOrganizations } from "./automatic-criteria-migration.ts";

export function migrateAuditorWorkflow(
  input: unknown,
  organizationInput: unknown,
  at = new Date().toISOString(),
) {
  const raw = input as any;
  if (![15, 16, 17, 18].includes(raw?.schemaVersion))
    throw new Error("Auditor 학습 확인 이관에는 업무15·조직2가 필요합니다.");
  const next = structuredClone(raw),
    organizations = validateOrganizations(organizationInput);
  const alreadyApplied = raw.schemaVersion === 18;
  if (raw.schemaVersion === 15) {
    if ((next.learningChecklists || []).length)
      throw new Error("구형 데이터의 학습 확인 기록을 먼저 검토해 주세요.");
    next.learningChecklists = [];
    for (const r of next.planningRequests) {
      if (r.qualificationType && r.qualificationType !== "auditee")
        throw new Error("구형 요청에 예상하지 못한 Auditor 유형이 있습니다.");
      r.qualificationType = "auditee";
    }
    for (const c of next.completions) {
      if (c.method && c.method !== "assessment")
        throw new Error("구형 수료 방식을 검토해 주세요.");
      c.method = "assessment";
      c.learningEvidence = [];
    }
    next.schemaVersion = 16;
    next.revision++;
    const actorId = next.users.find((u: any) =>
      u.roles.includes("system_operator"),
    )?.id;
    if (!actorId) throw new Error("이관을 기록할 시스템 운영자가 없습니다.");
    next.audits.push({
      id: randomUUID(),
      actorId,
      date: at,
      action: "migration.auditor-workflow",
      targetId: "auditor-workflow-v16",
      reason: "유형별 요청과 본인 학습 확인 수료 근거 도입",
      details: {
        fromSchema: 15,
        progressReset: false,
        requests: next.planningRequests.length,
        completions: next.completions.length,
      },
    });
  }
  const state = migrateAuditorProgram(next, organizations, at).state;
  return {
    state,
    organizations,
    report: {
      alreadyApplied,
      schemaVersion: state.schemaVersion,
      revision: state.revision,
      organizationRevision: organizations.revision,
      requests: state.planningRequests.length,
      completions: state.completions.length,
    },
  };
}
