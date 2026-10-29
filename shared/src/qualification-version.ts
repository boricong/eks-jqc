import type { Qualification } from "./index.ts";

export function isVersionedQualification(
  q: Qualification,
): q is Qualification & { version: number } {
  return q.version !== null && q.lifecycleStatus !== "Ready";
}
export function qualificationVersionLabel(version: number | null | undefined) {
  return version == null ? "—" : `v${version}.0`;
}
/** A registered placeholder becomes v1 only when its operational criteria change. */
export function configureInitialQualification(
  source: Qualification,
  candidate: Qualification,
  changed: boolean,
) {
  if (!changed || source.version !== null || source.lifecycleStatus !== "Ready")
    return false;
  const criteria = (q: Qualification) =>
    JSON.stringify({
      validity: q.validity,
      courseIds: q.courseIds,
      planningDeadlineMonths: q.planningDeadlineMonths,
      renewalLeadMonths: q.renewalLeadMonths ?? 3,
      renewalNoticeDaysBefore: q.renewalNoticeDaysBefore ?? 7,
    });
  if (criteria(source) === criteria(candidate)) return false;
  candidate.version = 1;
  candidate.lifecycleStatus = "Active";
  return true;
}
