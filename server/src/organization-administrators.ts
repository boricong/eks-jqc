import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  organizationEntries,
  type State,
  type UserView,
  type OrganizationDocument,
  type OrganizationEntry,
  type OrganizationAdministratorsView,
} from "@eks/contracts";
import { demand } from "./errors.ts";
import { organization } from "./organizations.ts";
import { managementScope } from "./management.ts";

export const fullManager = (u: UserView) =>
  u.roles.includes("admin") || u.roles.includes("system_operator");
// Use entries from the current organization document, never a client-supplied path.
export function administersSubtree(
  u: UserView,
  entry: OrganizationEntry | undefined,
) {
  return (
    !!entry &&
    u.roles.includes("organization_admin") &&
    u.organizationAdministration?.organizationId === u.organizationId &&
    entry.lv1OrganizationId === u.lv1OrganizationId &&
    entry.path.some((p) => p.id === u.organizationId)
  );
}
export function policyScope(
  u: UserView,
  doc: OrganizationDocument,
  requested?: string,
  target?: string,
  pool = false,
) {
  if (fullManager(u)) {
    const scope = managementScope(u, doc, requested);
    if (target)
      demand(
        organization(doc, target).lv1OrganizationId === scope,
        403,
        "관리 대상 Lv1의 조직만 설정할 수 있습니다.",
      );
    return scope;
  }
  demand(
    u.roles.includes("organization_admin") &&
      u.organizationAdministration?.organizationId === u.organizationId,
    403,
    "조직 정보 관리 권한이 없습니다.",
    "POLICY_ACCESS_REVOKED",
  );
  demand(
    !requested || requested === u.lv1OrganizationId,
    403,
    "다른 Lv1의 조직 설정에 접근할 수 없습니다.",
  );
  demand(
    !pool,
    403,
    "팀 자격 후보 목록은 팀 조직 관리자만 변경할 수 있습니다.",
  );
  demand(
    !target ||
      administersSubtree(
        u,
        organizationEntries(doc).find((e) => e.id === target),
      ),
    403,
    "본인 조직 및 모든 하위 조직만 설정할 수 있습니다.",
  );
  return u.lv1OrganizationId;
}
export function editableOrganizations(
  u: UserView,
  doc: OrganizationDocument,
  scope?: string,
) {
  if (fullManager(u))
    return organizationEntries(doc)
      .filter((e) => e.lv1OrganizationId === scope)
      .map((e) => e.id);
  return organizationEntries(doc)
    .filter((e) => administersSubtree(u, e))
    .map((e) => e.id);
}
export function administratorsView(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  target: string,
  scope?: string,
): OrganizationAdministratorsView {
  policyScope(u, doc, scope, target);
  const manage = fullManager(u);
  return {
    revision: s.revision,
    organizationRevision: doc.revision,
    organizationId: target,
    candidates: s.users
      .filter(
        (user) =>
          user.organizationId === target &&
          (manage ||
            user.organizationAdministration?.organizationId === target),
      )
      .map((user) => ({
        id: user.id,
        name: user.name,
        assigned: user.organizationAdministration?.organizationId === target,
      })),
  };
}
export function changeAdministrators(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  target: string,
  scope: string,
  body: unknown,
) {
  managementScope(u, doc, scope);
  policyScope(u, doc, scope, target);
  const input = z
    .object({
      revision: z.number().int(),
      organizationRevision: z.number().int(),
      userIds: z.array(z.string()).max(10000),
    })
    .strict()
    .parse(body);
  demand(
    input.revision === s.revision &&
      input.organizationRevision === doc.revision,
    409,
    "사용자 또는 조직이 변경되었습니다. 다시 불러온 뒤 지정해 주세요.",
    "REVISION_CONFLICT",
  );
  demand(
    new Set(input.userIds).size === input.userIds.length,
    422,
    "중복 사용자를 지정할 수 없습니다.",
  );
  for (const id of input.userIds)
    demand(
      s.users.some((user) => user.id === id && user.organizationId === target),
      422,
      "선택 조직에 직접 소속된 사용자만 지정할 수 있습니다.",
    );
  const entry = organization(doc, target);
  const date = new Date().toISOString();
  for (const user of s.users.filter((user) => user.organizationId === target)) {
    const assigned = !!user.organizationAdministration;
    const next = input.userIds.includes(user.id);
    if (assigned === next) continue;
    if (next)
      demand(
        entry.effectiveActive,
        422,
        "사용 중지 조직에 새 관리자를 지정할 수 없습니다.",
      );
    const before = user.organizationAdministration;
    if (next)
      user.organizationAdministration = {
        organizationId: target,
        grantedBy: u.id,
        grantedAt: date,
      };
    else delete user.organizationAdministration;
    user.revision++;
    s.audits.push({
      id: randomUUID(),
      actorId: u.id,
      date,
      action: next
        ? "organization.administrator.grant"
        : "organization.administrator.revoke",
      targetId: user.id,
      lv1OrganizationId: scope,
      reason: "세부 조직 관리자 지정 관리",
      details: {
        organizationId: target,
        before: before || null,
        after: user.organizationAdministration || null,
      },
    });
  }
  return { id: target, revision: s.revision + 1 };
}
