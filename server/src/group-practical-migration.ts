import { randomUUID } from "node:crypto";
import type { State } from "@eks/contracts";
import { validateState } from "./integrity.ts";
import { validateOrganizations } from "./organizations.ts";

/** Explicitly marks a separate trial dataset; never changes historic course content/hashes. */
export function migrateGroupPractical(
  input: unknown,
  orgInput: unknown,
  at = new Date().toISOString(),
) {
  const raw = input as State;
  if (![32, 33].includes(raw.schemaVersion))
    throw Error("업무32 또는33 파일이 필요합니다.");
  const organizations = validateOrganizations(orgInput);
  if (organizations.schemaVersion !== 5)
    throw Error("조직5 파일이 필요합니다.");
  const state = validateState(structuredClone(input), organizations);
  const alreadyApplied = state.schemaVersion === 33;
  if (alreadyApplied && state.groupPracticalEnvironment !== "trial")
    throw Error("업무33 시험환경 표시가 없습니다.");
  if (!alreadyApplied) {
    if (
      state.groupAssessments.length ||
      state.groupAssessmentFiles.length ||
      state.courses.some((c) => c.groupPractical)
    )
      throw Error("구형 데이터에 그룹 실기 기록이 포함되어 있습니다.");
    const operator = state.users.find((u) =>
      u.roles.includes("system_operator"),
    );
    if (!operator) throw Error("이관 기록을 남길 시스템 운영자가 필요합니다.");
    state.schemaVersion = 33;
    state.groupPracticalEnvironment = "trial";
    state.revision++;
    state.audits.push({
      id: randomUUID(),
      actorId: operator.id,
      date: at,
      action: "migration.group-practical",
      targetId: "group-practical-v33",
      reason: "별도 시험환경 그룹 실기 기능 이관 · 과거 인증 근거 보존",
      details: { fromSchema: 32, environment: "trial" },
    });
  }
  return {
    state: validateState(state, organizations),
    organizations,
    report: {
      alreadyApplied,
      schemaVersion: state.schemaVersion,
      revision: state.revision,
      environment: state.groupPracticalEnvironment,
      certificationsChanged: 0,
      progressReset: false,
    },
  };
}
