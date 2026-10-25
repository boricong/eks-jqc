import {
  hasQualificationRole,
  type State,
  type UserView,
  type QualificationType,
} from "@eks/contracts";

// A revoked evaluator role does not revoke an already issued personal request.
// This is a record-scoped continuation grant, never an administrative permission.
export function canContinueType(
  s: State,
  u: UserView,
  type: QualificationType,
) {
  return (
    hasQualificationRole(u.roles, type) ||
    (type === "auditor" &&
      s.planningRequests.some(
        (r) =>
          r.learnerId === u.id &&
          r.lv1OrganizationId === u.lv1OrganizationId &&
          r.qualificationType === "auditor",
      ))
  );
}
export function canReadPersonal(s: State, u: UserView) {
  return canContinueType(s, u, "auditee") || canContinueType(s, u, "auditor");
}
