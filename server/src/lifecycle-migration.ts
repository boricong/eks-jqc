import { migrateAssessmentFlow } from "./assessment-flow-migration.ts";
import { LegacyStateSchema as StateSchema, type State } from "@eks/contracts";
import { migrationOrganizations as validateOrganizations } from "./automatic-criteria-migration.ts";
import { validateState } from "./integrity.ts";
import {
  initializeCertification,
  reconcileLifecycle,
} from "./qualification-lifecycle.ts";

export function migrateLifecycle(
  input: unknown,
  organizationInput: unknown,
  at = new Date().toISOString(),
) {
  const raw = input as any,
    organizations = validateOrganizations(organizationInput);
  if (
    ![
      8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    ].includes(raw?.schemaVersion)
  )
    throw new Error(
      "자격 상태 이관에는 업무 스키마 8과 조직 스키마 2가 필요합니다.",
    );
  const alreadyApplied = raw.schemaVersion >= 9;
  const next = structuredClone(raw);
  if (!alreadyApplied) {
    next.schemaVersion = 9;
    next.revision++;
    next.renewals = [];
    next.lifecycleEvents = [];
    for (const u of next.users) u.certificationEligibility = "eligible";
    for (const q of next.qualifications) {
      q.lifecycleStatus = "Active";
      q.renewalLeadMonths = 3;
    }
    for (const p of next.plans) p.acquisitionCycleId = p.id;
    for (const a of next.assignments) a.acquisitionCycleId = a.planId || a.id;
    const state = StateSchema.parse({
      ...next,
      schemaVersion: 11,
    }) as unknown as State;
    for (const c of state.certifications)
      initializeCertification(
        state,
        c,
        state.qualifications.find((q) => q.id === c.qualificationId)!,
        at,
        true,
      );
    reconcileLifecycle(state, at);
    state.audits.push({
      id: "qualification-lifecycle-v9",
      actorId: state.users.find((u) => u.roles.includes("system_operator"))!.id,
      action: "migration.lifecycle",
      targetId: "qualification-lifecycle-v9",
      date: at,
      reason: "인증Set·상태·재인증 스키마 9 보존 이관",
      details: { fromSchema: 8, progressReset: false },
    });
    Object.assign(next, state, { schemaVersion: 9 });
  }
  const state = migrateAssessmentFlow(next, organizations, at).state;
  return {
    state,
    organizations,
    report: {
      alreadyApplied: raw.schemaVersion === 24,
      revision: state.revision,
      schemaVersion: state.schemaVersion,
      users: state.users.length,
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
