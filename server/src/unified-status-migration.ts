import { randomUUID } from "node:crypto";
import type { State } from "@eks/contracts";
import { validateState } from "./integrity.ts";
import { validateOrganizations, userView } from "./organizations.ts";

/** Explicit retirement: never infer a deactive start date from a legacy Hold. */
export function migrateUnifiedStatus(
  input: unknown,
  orgInput: unknown,
  at = new Date().toISOString(),
) {
  const state = structuredClone(input) as State;
  const organizations = validateOrganizations(orgInput);
  if (
    ![31, 32].includes(state.schemaVersion) ||
    organizations.schemaVersion !== 5
  )
    throw Error("업무31·조직5 또는 이관 완료된 업무32 파일이 필요합니다.");
  const alreadyApplied = state.schemaVersion === 32;
  const activatedUsers: string[] = [],
    preservedDeactiveUsers: string[] = [];
  if (!alreadyApplied) {
    validateState(state, organizations);
    const actor = state.users.find((u) => u.roles.includes("system_operator"));
    if (!actor) throw Error("이관 근거를 기록할 시스템 운영자가 필요합니다.");
    for (const user of state.users) {
      if (user.certificationEligibility === undefined) continue;
      const before = user.certificationEligibility;
      if (user.workStatus === "deactive") preservedDeactiveUsers.push(user.id);
      else if (before === "hold") {
        user.workStatus = "active";
        activatedUsers.push(user.id);
      }
      delete user.certificationEligibility;
      user.revision++;
      state.audits.push({
        id: randomUUID(),
        actorId: actor.id,
        date: at,
        lv1OrganizationId: userView(user, organizations).lv1OrganizationId,
        action: "user-eligibility.retired",
        targetId: user.id,
        reason: "취득 대상자 Hold 제거 및 업무 상태 통합",
        details: {
          beforeEligibility: before,
          workStatus: user.workStatus || "active",
          deactivePeriodPreserved: user.workStatus === "deactive",
        },
      });
    }
    state.schemaVersion = 32;
    state.revision++;
  }
  return {
    state: validateState(state, organizations),
    organizations,
    report: {
      alreadyApplied,
      schemaVersion: state.schemaVersion,
      revision: state.revision,
      activatedUsers,
      preservedDeactiveUsers,
      certificationsChanged: 0,
      progressReset: false,
    },
  };
}
