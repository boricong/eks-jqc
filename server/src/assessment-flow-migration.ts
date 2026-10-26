import { migrateCatalogEditing } from "./catalog-editing-migration.ts";
import { type State } from "@eks/contracts";
import { migrationOrganizations as validateOrganizations } from "./automatic-criteria-migration.ts";
import { validateState } from "./integrity.ts";

export function migrateAssessmentFlow(
  input: unknown,
  organizationInput: unknown,
  at = new Date().toISOString(),
) {
  const raw = input as any,
    organizations = validateOrganizations(organizationInput);
  if (
    ![9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23].includes(
      raw?.schemaVersion,
    )
  )
    throw new Error(
      "평가 순서·단일 알림 이관에는 업무 스키마9와 조직 스키마2가 필요합니다.",
    );
  const next = structuredClone(raw),
    alreadyApplied = raw.schemaVersion >= 10;
  if (!alreadyApplied) {
    const invalid = next.courses.filter(
      (c: any) =>
        c.status === "published" &&
        c.assessmentKinds.includes("practical") &&
        !c.assessmentKinds.includes("objective"),
    );
    if (invalid.length)
      throw new Error(
        `실기 전용 게시 인증Set을 먼저 확인하세요: ${invalid.map((c: any) => c.id).join(", ")}`,
      );
    next.schemaVersion = 10;
    next.revision++;
    for (const q of next.qualifications) q.renewalNoticeDaysBefore = 7;
    for (const c of next.certifications)
      for (const p of c.periods || []) p.renewalNoticeDaysBefore = 7;
    for (const r of next.renewals) r.renewalNoticeDaysBefore = 7;
    for (const n of next.notifications)
      if (n.type === "expiry" || n.key.startsWith("renewal:open:"))
        n.resolvedAt ??= at;
    next.audits.push({
      id: "assessment-flow-v10",
      actorId: next.users.find((u: any) => u.roles.includes("system_operator"))
        .id,
      action: "migration.assessment-flow",
      targetId: "assessment-flow-v10",
      date: at,
      reason: "재인증 단일 사전 알림·지식 선행 평가·Excel v5 보존 이관",
      details: { fromSchema: 9, progressReset: false },
    });
  }
  const state: State = migrateCatalogEditing(next, organizations, at).state;
  return {
    state,
    organizations,
    report: {
      alreadyApplied: raw.schemaVersion === 23,
      schemaVersion: state.schemaVersion,
      revision: state.revision,
      qualifications: state.qualifications.length,
      courses: state.courses.length,
      plans: state.plans.length,
      assignments: state.assignments.length,
      attempts: state.attempts.length,
      completions: state.completions.length,
      certifications: state.certifications.length,
      organizationRevision: organizations.revision,
    },
  };
}
