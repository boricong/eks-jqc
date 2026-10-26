import type { OrganizationDocument, UserView } from "@eks/contracts";
import { demand } from "./errors.ts";
import { organization } from "./organizations.ts";

export const isManagementAction = (action: string) =>
  [
    "catalog.",
    "course.",
    "qualification.delete",
    "assignment.",
    "notice.",
    "template.",
    "planning.request",
    "planning.close",
  ].some((prefix) => action.startsWith(prefix));

// A management context never changes the actor's affiliation or roles.
export function managementScope(
  user: UserView,
  organizations: OrganizationDocument,
  requested?: string,
): string {
  const operator = user.roles.includes("system_operator");
  demand(
    operator || user.roles.includes("admin"),
    403,
    "인증 업무 관리 권한이 없습니다.",
  );
  demand(
    !operator || !!requested,
    403,
    "관리할 Lv1 조직을 먼저 선택해 주세요.",
    "MANAGEMENT_SCOPE_REQUIRED",
  );
  const scope = requested || user.lv1OrganizationId;
  demand(
    operator || scope === user.lv1OrganizationId,
    403,
    "다른 Lv1의 업무를 관리할 수 없습니다.",
  );
  demand(
    organization(organizations, scope).level === 1,
    422,
    "Lv1 조직을 선택해 주세요.",
  );
  return scope;
}
