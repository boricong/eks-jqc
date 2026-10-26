import type { Qualification } from "./index.ts";

/** Current means newest non-deleted version, not newest usable version. */
export function currentTeamQualifications(s: {
  qualifications: Qualification[];
}) {
  const latest = new Map<string, Qualification>();
  for (const q of s.qualifications) {
    if (q.deletedAt) continue;
    const key = `${q.lv1OrganizationId}:${q.entityId}`;
    const previous = latest.get(key);
    if (!previous || (q.version ?? 0) > (previous.version ?? 0))
      latest.set(key, q);
  }
  return [...latest.values()].map((q) => ({
    lv1OrganizationId: q.lv1OrganizationId,
    entityId: q.entityId,
    qualificationId: q.id,
  }));
}

export function latestQualification(
  s: { qualifications: Qualification[] },
  team: string,
  entityId: string,
) {
  const ref = currentTeamQualifications(s).find(
    (q) => q.lv1OrganizationId === team && q.entityId === entityId,
  );
  return s.qualifications.find((q) => q.id === ref?.qualificationId);
}
