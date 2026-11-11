import { randomUUID } from "node:crypto";
import type { State } from "@eks/contracts";
import { validateState } from "./integrity.ts";
import { validateOrganizations } from "./organizations.ts";

/** Opt-in migration. Historic contents, hashes, roles and awards remain unchanged. */
export function migrateMentorPractical(
  input: unknown,
  orgInput: unknown,
  at = new Date().toISOString(),
) {
  if (![32, 33, 34].includes((input as State)?.schemaVersion))
    throw Error("업무32~34 파일이 필요합니다.");
  const organizations = validateOrganizations(orgInput),
    state = validateState(structuredClone(input), organizations);
  if (organizations.schemaVersion !== 5)
    throw Error("조직5 파일이 필요합니다.");
  const alreadyApplied = state.schemaVersion === 34,
    fromSchema = state.schemaVersion;
  if (!alreadyApplied) {
    const actor = state.users.find((u) => u.roles.includes("system_operator"));
    if (!actor) throw Error("이관 기록을 남길 시스템 운영자가 필요합니다.");
    state.schemaVersion = 34;
    state.revision++;
    state.audits.push({
      id: randomUUID(),
      actorId: actor.id,
      date: at,
      action: "migration.mentor-practical",
      targetId: "mentor-practical-v34",
      reason: "FT 멘토 실기 필수 평가 이관 · 과거 평가와 역할 보존",
      details: { fromSchema },
    });
  }
  return {
    state: validateState(state, organizations),
    organizations,
    report: {
      alreadyApplied,
      schemaVersion: state.schemaVersion,
      revision: state.revision,
      certificationsChanged: 0,
      progressReset: false,
      rolesChanged: 0,
    },
  };
}
