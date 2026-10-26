import { readFileSync } from "node:fs";
import { designateAuditor } from "./auditor-program.ts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  OrganizationDocumentSchema,
  organizationEntries,
  organizationId,
  BaseRoleSchema,
  type OrganizationDocument,
  type OrganizationNode,
  type User,
  type UserView,
  type State,
} from "@eks/contracts";
import { demand } from "./errors.ts";

export const PHOTO_ID = "org-photo";
export function validateOrganizations(input: unknown): OrganizationDocument {
  const pending: unknown[] = [...((input as any)?.roots || [])],
    visited = new Set<unknown>();
  while (pending.length) {
    const node: any = pending.pop();
    demand(
      node && typeof node === "object" && !visited.has(node),
      422,
      "조직 트리에 순환 또는 중복 노드가 있습니다.",
    );
    visited.add(node);
    if (Array.isArray(node.children)) pending.push(...node.children);
  }
  const doc = OrganizationDocumentSchema.parse(input),
    ids = new Set<string>();
  function walk(nodes: OrganizationNode[]) {
    const names = new Set<string>();
    for (const node of nodes) {
      demand(!ids.has(node.id), 422, "조직 ID가 중복되었습니다.");
      const name = node.name.normalize("NFC").trim();
      demand(
        !names.has(name),
        422,
        "같은 상위 조직 안에 동일한 이름이 있습니다.",
      );
      ids.add(node.id);
      names.add(name);
      walk(node.children);
    }
  }
  walk(doc.roots);
  demand(
    new Set(doc.requests.map((r) => `${r.actorId}:${r.key}`)).size ===
      doc.requests.length,
    422,
    "조직 요청 식별자가 중복되었습니다.",
  );
  return doc;
}
export function seedOrganizations(): OrganizationDocument {
  return validateOrganizations(
    JSON.parse(
      readFileSync(
        new URL("./organization-seed.json", import.meta.url),
        "utf8",
      ),
    ),
  );
}
export function organization(doc: OrganizationDocument, id: string) {
  const entry = organizationEntries(doc).find((entry) => entry.id === id);
  demand(entry, 422, "소속 조직을 찾을 수 없습니다.");
  return entry;
}
export function userView(user: User, doc: OrganizationDocument): UserView {
  const entry = organization(doc, user.organizationId);
  return {
    ...user,
    roles:
      user.organizationAdministration?.organizationId === user.organizationId
        ? [...user.roles, "organization_admin"]
        : [...user.roles],
    lv1OrganizationId: entry.lv1OrganizationId,
    organizationPath: entry.path,
    organizationActive: entry.effectiveActive,
  };
}
export function systemOperator(user: User) {
  demand(
    user.roles.includes("system_operator"),
    403,
    "시스템 운영자만 사용할 수 있습니다.",
  );
}
function expected(current: number, value: number) {
  demand(
    current === value,
    409,
    "다른 창에서 변경되었습니다. 다시 불러온 뒤 확인해 주세요.",
    "REVISION_CONFLICT",
  );
}
export function nodeFor(
  nodes: OrganizationNode[],
  id: string,
): OrganizationNode | undefined {
  const pending = [...nodes];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.id === id) return node;
    pending.push(...node.children);
  }
}
const name = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .transform((v) => v.normalize("NFC"));
export function changeOrganization(
  doc: OrganizationDocument,
  actor: User,
  target: string | undefined,
  body: unknown,
) {
  systemOperator(actor);
  const input = z
    .object({
      revision: z.number().int().nonnegative(),
      name: name.optional(),
      parentId: organizationId.nullable().optional(),
      active: z.boolean().optional(),
      order: z.number().int().nonnegative().optional(),
    })
    .strict()
    .parse(body);
  expected(doc.revision, input.revision);
  const before = target ? organization(doc, target) : null;
  const parentId =
    input.parentId === undefined ? (before?.parentId ?? null) : input.parentId;
  const parent = parentId ? organization(doc, parentId) : null;
  let node = target ? nodeFor(doc.roots, target)! : undefined;
  if (!node) {
    demand(input.name, 422, "조직명을 입력해 주세요.");
    demand(
      !parent || parent.effectiveActive,
      422,
      "사용 중인 조직 아래에 추가해 주세요.",
    );
    node = { id: randomUUID(), name: input.name, active: true, children: [] };
  } else if (parentId !== before!.parentId) {
    demand(
      parent &&
        parent.effectiveActive &&
        parent.lv1OrganizationId === before!.lv1OrganizationId &&
        parent.level === before!.level - 1,
      422,
      "같은 Lv1 안에서 기존 레벨을 유지하는 상위 조직을 선택해 주세요.",
    );
  }
  if (input.name !== undefined) node.name = input.name;
  if (input.active !== undefined && (before || parentId))
    node.active = input.active;
  const siblings = parentId
    ? nodeFor(doc.roots, parentId)!.children
    : doc.roots;
  if (before) {
    const old = before.parentId
      ? nodeFor(doc.roots, before.parentId)!.children
      : doc.roots;
    old.splice(
      old.findIndex((n) => n.id === node!.id),
      1,
    );
  }
  const position =
    !before && !parentId
      ? siblings.length
      : (input.order ??
        (before?.parentId === parentId ? before.order : siblings.length));
  siblings.splice(Math.min(position, siblings.length), 0, node);
  validateOrganizations(doc);
  return { id: node.id, revision: doc.revision + 1 };
}
export function changeUser(
  s: State,
  doc: OrganizationDocument,
  actor: User,
  target: string | undefined,
  body: unknown,
) {
  systemOperator(actor);
  const input = z
    .object({
      name: z.string().trim().min(1).max(100),
      organizationId,
      roles: z
        .array(BaseRoleSchema)
        .min(1)
        .refine((r) => new Set(r).size === r.length),
      revision: z.number().int().positive().optional(),
    })
    .strict()
    .parse(body);
  const entry = organization(doc, input.organizationId);
  const user = target ? s.users.find((u) => u.id === target) : undefined;
  if (target) demand(user, 404, "사용자를 찾을 수 없습니다.");
  const before = user ? structuredClone(user) : null;
  if (user) {
    demand(input.revision !== undefined, 422, "사용자 버전을 확인해 주세요.");
    expected(user.revision, input.revision);
    demand(
      organization(doc, user.organizationId).lv1OrganizationId ===
        entry.lv1OrganizationId,
      422,
      "Lv1 간 전입·전출은 지원하지 않습니다.",
    );
    const open = s.assignments.filter(
      (a) =>
        !a.excludedReason &&
        !s.certifications.some((c) => c.assignmentId === a.id),
    );
    demand(
      !user.roles.includes("learner") ||
        input.roles.includes("learner") ||
        !open.some(
          (a) =>
            a.learnerId === user.id &&
            s.qualifications.find((q) => q.id === a.qualificationId)
              ?.qualificationType === "auditee",
        ),
      409,
      "진행 중인 학습자 배정을 먼저 정리해 주세요.",
    );
    demand(
      !user.roles.includes("system_operator") ||
        input.roles.includes("system_operator") ||
        s.users.some(
          (u) => u.id !== user.id && u.roles.includes("system_operator"),
        ),
      409,
      "마지막 시스템 운영자의 역할은 제거할 수 없습니다.",
    );
  }
  demand(
    user?.organizationId === input.organizationId || entry.effectiveActive,
    422,
    "사용 중인 조직을 선택해 주세요.",
  );
  const updated: User = {
    id: user?.id ?? randomUUID(),
    name: input.name,
    organizationId: input.organizationId,
    roles: input.roles,
    revision: (user?.revision ?? 0) + 1,
  };
  if (input.roles.includes("evaluator") && !before?.roles.includes("evaluator"))
    designateAuditor(
      s,
      updated,
      actor,
      entry.lv1OrganizationId,
      new Date().toISOString(),
    );
  if (user) {
    if (
      user.organizationId !== input.organizationId &&
      user.organizationAdministration
    ) {
      s.audits.push({
        id: randomUUID(),
        actorId: actor.id,
        date: new Date().toISOString(),
        action: "organization.administrator.revoke",
        targetId: user.id,
        lv1OrganizationId: entry.lv1OrganizationId,
        reason: "소속 이동에 따른 세부 조직 관리자 지정 해제",
        details: { previous: user.organizationAdministration },
      });
      delete user.organizationAdministration;
    }
    Object.assign(user, updated);
  } else s.users.push(updated);
  s.audits.push({
    id: randomUUID(),
    actorId: actor.id,
    date: new Date().toISOString(),
    action: user ? "user.update" : "user.create",
    targetId: updated.id,
    reason: "사용자 소속·역할 관리",
    details: { before, after: updated },
  });
  return { id: updated.id, revision: updated.revision };
}
