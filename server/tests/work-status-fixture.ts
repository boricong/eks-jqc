import { workRevokesOn, kstDate, type User } from "@eks/contracts";
/** Test-only fixture. Product status transitions still require the preview/apply API. */
export function setWorkStatus(
  user: User,
  status: "active" | "deactive",
  at = "2026-10-26T01:00:00.000Z",
) {
  user.workStatus = status;
  delete user.certificationEligibility;
  if (status === "active") delete user.workDeactivation;
  else
    user.workDeactivation = {
      id: `test-deactive-${user.id}`,
      startedAt: at,
      startedOn: kstDate(at),
      revokesOn: workRevokesOn(kstDate(at)),
      actorId: "operator-1",
      reason: "개발 시험",
      processedTeams: [],
    };
  return user;
}
