import {
  type State,
  type OrganizationDocument,
  organizationEntries,
} from "@eks/contracts";
import { validateState } from "./integrity.ts";
import { validateOrganizations } from "./organizations.ts";

export function migrateAuditorTeams(input: unknown, orgInput: unknown) {
  const s = structuredClone(input) as State;
  const org = validateOrganizations(orgInput);
  if (![30, 31, 32].includes(s.schemaVersion))
    throw Error("업무30 또는31 파일이 필요합니다.");
  const alreadyApplied = s.schemaVersion >= 31 && org.schemaVersion === 5;
  const enabledTeams: string[] = [];
  if (!alreadyApplied) {
    if (s.schemaVersion !== 30 || org.schemaVersion !== 4)
      throw Error("업무/조직 이관 쌍을 확인해 주세요.");
    const entries = new Map(organizationEntries(org).map((e) => [e.id, e]));
    const existing = new Set(
      s.users
        .filter((u) => u.roles.includes("evaluator") || u.auditorDesignation)
        .map((u) => {
          const entry = entries.get(u.organizationId);
          if (!entry) throw Error("과거 대상자의 조직 참조를 확인해 주세요.");
          return entry.lv1OrganizationId;
        }),
    );
    for (const q of s.qualifications.filter(
      (q) => q.qualificationType === "auditor",
    ))
      existing.add(q.lv1OrganizationId);
    for (const a of s.assignments.filter((a) => a.auditor))
      existing.add(a.lv1OrganizationId);
    for (const root of org.roots) {
      root.auditorEnabled = existing.has(root.id);
      if (root.auditorEnabled) enabledTeams.push(root.id);
    }
    for (const team of existing)
      if (!org.roots.some((r) => r.id === team))
        throw Error("과거 Auditor 팀 참조를 확인해 주세요.");
    org.schemaVersion = 5;
    org.revision++;
    s.schemaVersion = 31;
    s.revision++;
  } else
    for (const root of org.roots)
      if (root.auditorEnabled) enabledTeams.push(root.id);
  return {
    state: validateState(s, org),
    organizations: org,
    report: {
      alreadyApplied,
      schemaVersion: s.schemaVersion,
      organizationSchemaVersion: 5,
      revision: s.revision,
      organizationRevision: org.revision,
      enabledTeams,
      usersChanged: 0,
      certificationsChanged: 0,
    },
  };
}
