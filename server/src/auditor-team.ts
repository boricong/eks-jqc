import {
  organizationEntries,
  type OrganizationDocument,
  type State,
} from "@eks/contracts";
import { demand } from "./errors.ts";

export const auditorTeamEnabled = (doc: OrganizationDocument, team: string) =>
  doc.roots.find((root) => root.id === team)?.auditorEnabled === true;
export function requireAuditorTeam(doc: OrganizationDocument, team: string) {
  demand(
    auditorTeamEnabled(doc, team),
    409,
    "Auditor 대상 팀이 아닙니다. 시스템 운영자에게 팀 설정을 요청해 주세요.",
    "AUDITOR_DISABLED",
  );
}
export function auditorTeamImpact(
  s: State,
  doc: OrganizationDocument,
  team: string,
) {
  const organizations = new Set(
    organizationEntries(doc)
      .filter((e) => e.lv1OrganizationId === team)
      .map((e) => e.id),
  );
  const assignments = s.assignments.filter(
    (a) =>
      a.lv1OrganizationId === team &&
      s.qualifications.find((q) => q.id === a.qualificationId)
        ?.qualificationType === "auditor",
  );
  const ids = new Set(assignments.map((a) => a.id));
  return {
    members: s.users.filter((u) => organizations.has(u.organizationId)).length,
    ongoing: assignments.filter(
      (a) =>
        !a.acquisitionClosedAt &&
        !s.certifications.some((c) => c.assignmentId === a.id),
    ).length,
    certifications: s.certifications.filter((c) => ids.has(c.assignmentId))
      .length,
  };
}
