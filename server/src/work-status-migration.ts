import type { State } from "@eks/contracts";
import { validateState } from "./integrity.ts";
import { validateOrganizations } from "./organizations.ts";

export function initializeWorkStatus(s: State): State {
  s.schemaVersion = 30;
  for (const u of s.users) u.workStatus ??= "active";
  return s;
}
export function migrateWorkStatus(input: unknown, orgInput: unknown) {
  const raw = structuredClone(input) as State;
  const organizations = validateOrganizations(orgInput);
  if (![29, 30].includes(raw?.schemaVersion))
    throw Error("업무 상태 이관은 업무29 또는 현행30 파일이 필요합니다.");
  validateState(raw, organizations);
  const alreadyApplied = raw.schemaVersion === 30;
  if (!alreadyApplied) {
    for (const u of raw.users) {
      if ((u.workStatus && u.workStatus !== "active") || u.workDeactivation)
        throw Error("기존 파일의 업무 상태를 확인해 주세요.");
      u.workStatus = "active";
    }
    raw.schemaVersion = 30;
    raw.revision++;
  }
  return {
    state: validateState(raw, organizations),
    organizations,
    report: {
      alreadyApplied,
      schemaVersion: 30,
      revision: raw.revision,
      organizationRevision: organizations.revision,
      activeUsers: raw.users.length,
      certificationsChanged: 0,
      progressReset: false,
    },
  };
}
