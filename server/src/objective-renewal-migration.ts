import { randomUUID } from "node:crypto";
import { validateState } from "./integrity.ts";
import { validateOrganizations } from "./organizations.ts";
export function initializeObjectiveRenewals(raw: any) {
  for (const q of [...raw.qualifications, ...raw.qualificationTemplates])
    q.purpose ||= "acquisition";
  raw.renewalBatches ||= [];
  raw.schemaVersion = 28;
  return raw;
}
export function migrateObjectiveRenewals(
  input: unknown,
  orgInput: unknown,
  at = new Date().toISOString(),
) {
  const raw = structuredClone(input) as any,
    organizations = validateOrganizations(orgInput);
  if (![27, 28].includes(raw?.schemaVersion))
    throw Error("객관식 재인증 이관은 업무27 또는 현행28 파일이 필요합니다.");
  const alreadyApplied = raw.schemaVersion === 28;
  if (!alreadyApplied) {
    validateState(raw, organizations);
    if (
      raw.renewalBatches?.length ||
      [...raw.qualifications, ...raw.qualificationTemplates].some(
        (q: any) => q.purpose && q.purpose !== "acquisition",
      )
    )
      throw Error(
        "구형 파일에 신규 재인증 데이터가 있습니다. 원본을 확인해 주세요.",
      );
    const changes: any[] = [];
    for (const r of raw.renewals || [])
      if (
        r.status === "draft" &&
        r.method === "mvp_completion" &&
        raw.qualifications.some(
          (q: any) =>
            q.id === r.qualificationId && q.qualificationType === "auditee",
        )
      ) {
        const before = structuredClone(r);
        r.status = "closed";
        r.closedAt = at;
        r.closeReason = "객관식 재인증 전환";
        r.revision++;
        changes.push({ before, after: structuredClone(r) });
      }
    initializeObjectiveRenewals(raw);
    raw.revision++;
    raw.audits.push({
      id: randomUUID(),
      actorId: raw.users.find((u: any) => u.roles.includes("system_operator"))
        .id,
      date: at,
      action: "migration.objective-renewals",
      targetId: "renewals-v28",
      reason: "객관식 재인증 도입·기존 인증과 완료 근거 보존",
      details: {
        fromSchema: 27,
        progressReset: false,
        closedLegacyRenewals: changes,
      },
    });
  }
  const state = validateState(raw, organizations);
  return {
    state,
    organizations,
    report: {
      alreadyApplied,
      schemaVersion: 28,
      revision: state.revision,
      organizationRevision: organizations.revision,
      progressReset: false,
      closedLegacyRenewals: alreadyApplied
        ? 0
        : state.renewals.filter(
            (r) => r.closeReason === "객관식 재인증 전환" && r.closedAt === at,
          ).length,
    },
  };
}
