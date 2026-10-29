import { randomUUID } from "node:crypto";
import {
  currentTeamQualifications,
  usesPlanningDeadline,
  type State,
} from "@eks/contracts";
import { validateState } from "./integrity.ts";
import { validateOrganizations } from "./organizations.ts";
import { appendQualification } from "./releases.ts";

/** Fresh installations and isolated fixtures have no historical releases to preserve. */
export function initializePlanningSchedule(raw: State): State {
  for (const q of raw.qualifications)
    if (usesPlanningDeadline(q)) q.planningDeadlineMonths ??= 6;
  raw.schemaVersion = 29;
  return raw;
}

export function migratePlanningSchedule(
  input: unknown,
  orgInput: unknown,
  at = new Date().toISOString(),
) {
  const raw = structuredClone(input) as State,
    organizations = validateOrganizations(orgInput);
  if (![28, 29].includes(raw?.schemaVersion))
    throw Error("전체 일정 이관은 업무28 또는 현행29 파일이 필요합니다.");
  validateState(raw, organizations);
  const alreadyApplied = raw.schemaVersion === 29;
  const changes: { previousId: string; id: string; ready: boolean }[] = [];
  if (!alreadyApplied) {
    const actor = raw.users.find((u) => u.roles.includes("system_operator"));
    if (!actor)
      throw Error("이관 근거를 기록할 시스템 운영자 계정이 없습니다.");
    for (const ref of currentTeamQualifications(raw)) {
      const q = raw.qualifications.find((q) => q.id === ref.qualificationId)!;
      if (!usesPlanningDeadline(q) || q.planningDeadlineMonths !== undefined)
        continue;
      const next = appendQualification(
        raw,
        q,
        { ...q, planningDeadlineMonths: 6 },
        actor.id,
        "전체 일정 수립 도입 · 최대 완료 6개월",
      );
      if (next.releaseInfo && next !== q) next.releaseInfo.createdAt = at;
      changes.push({
        previousId: q.id,
        id: next.id,
        ready: next.version === null,
      });
    }
    raw.schemaVersion = 29;
    raw.revision++;
    raw.audits.push({
      id: randomUUID(),
      actorId: actor.id,
      date: at,
      action: "migration.planning-schedule",
      targetId: "planning-schedule-v29",
      reason: "최신 Auditee 취득 자격 최대 완료6개월·과거 근거 보존",
      details: { fromSchema: 28, changes },
    });
  }
  const state = validateState(raw, organizations);
  return {
    state,
    organizations,
    report: {
      alreadyApplied,
      schemaVersion: 29,
      revision: state.revision,
      organizationRevision: organizations.revision,
      changes,
      progressReset: false,
    },
  };
}
