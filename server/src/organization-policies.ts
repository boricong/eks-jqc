import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  organizationEntries,
  qualificationUseErrors,
  certificationStatus,
  type State,
  type OrganizationDocument,
  type UserView,
  type PersonalPlan,
  type RequiredQualificationsView,
  type RequiredQualification,
  type RequestProgress,
  type OrganizationPoliciesView,
} from "@eks/contracts";
import { organization, nodeFor, userView } from "./organizations.ts";
import { demand } from "./errors.ts";
import { fullManager, policyScope } from "./organization-administrators.ts";

export function validatePolicies(s: State, doc: OrganizationDocument) {
  const entries = organizationEntries(doc);
  const seen = new Set<string>();
  for (const p of doc.qualificationPools) {
    const q = s.qualifications.find((q) => q.id === p.qualificationId);
    demand(
      entries.some((e) => e.id === p.lv1OrganizationId && e.level === 1) &&
        q?.status === "published" &&
        q.lv1OrganizationId === p.lv1OrganizationId &&
        q.entityId === p.entityId,
      422,
      "팀 자격 목록의 조직·게시 버전 참조를 확인해 주세요.",
    );
    const key = `${p.lv1OrganizationId}:${p.entityId}`;
    demand(!seen.has(key), 422, "팀 자격 목록이 중복되었습니다.");
    seen.add(key);
  }
  for (const e of entries) {
    const ids = e.requiredQualifications || [];
    demand(
      new Set(ids).size === ids.length &&
        ids.every((id) => seen.has(`${e.lv1OrganizationId}:${id}`)),
      422,
      `${e.name}의 필수 자격은 팀 선정 목록에서 선택해 주세요.`,
    );
  }
  for (const r of s.planningRequests) {
    if (r.organizationId)
      demand(
        entries.some(
          (e) =>
            e.id === r.organizationId &&
            e.lv1OrganizationId === r.lv1OrganizationId,
        ),
        422,
        "계획 요청의 당시 조직 참조를 확인해 주세요.",
      );
    if (r.targets)
      demand(
        new Set(r.targets.map((t) => t.entityId)).size === r.targets.length &&
          r.targets.every((t) =>
            s.qualifications.some(
              (q) =>
                q.id === t.qualificationId &&
                q.entityId === t.entityId &&
                q.version === t.version &&
                q.lv1OrganizationId === r.lv1OrganizationId,
            ),
          ),
        422,
        "계획 요청의 당시 자격 참조를 확인해 주세요.",
      );
  }
  for (const p of s.plans)
    if (p.organizationId)
      demand(
        entries.some(
          (e) =>
            e.id === p.organizationId &&
            e.lv1OrganizationId === p.lv1OrganizationId,
        ),
        422,
        "계획의 적용 조직 참조를 확인해 주세요.",
      );
}

export function requiredQualifications(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  at = new Date().toISOString(),
): RequiredQualificationsView {
  const org = organization(doc, u.organizationId);
  const items = (org.requiredQualifications || []).map((entityId) => {
    const pool = doc.qualificationPools.find(
      (p) =>
        p.lv1OrganizationId === org.lv1OrganizationId &&
        p.entityId === entityId,
    )!;
    const q = s.qualifications.find((q) => q.id === pool.qualificationId)!;
    const assignments = s.assignments.filter(
      (a) =>
        a.learnerId === u.id &&
        !a.excludedReason &&
        s.qualifications.find((q) => q.id === a.qualificationId)?.entityId ===
          entityId,
    );
    const certs = s.certifications.filter((c) =>
      s.assignments.some(
        (a) =>
          a.id === c.assignmentId &&
          a.learnerId === u.id &&
          s.qualifications.find((q) => q.id === a.qualificationId)?.entityId ===
            entityId,
      ),
    );
    const valid = certs.find((c) =>
      ["valid", "expiring"].includes(certificationStatus(c, at)),
    );
    const plan = s.plans.find(
      (p) =>
        p.learnerId === u.id &&
        !p.deletedAt &&
        s.qualifications.find((q) => q.id === p.qualificationId)?.entityId ===
          entityId &&
        (!p.assignmentId || assignments.some((a) => a.id === p.assignmentId)),
    );
    const request = [...s.planningRequests]
      .reverse()
      .find(
        (r) =>
          r.learnerId === u.id &&
          r.organizationId === org.id &&
          r.targets?.some((t) => t.entityId === entityId),
      );
    const errors = qualificationUseErrors(q, s.courses);
    const row: RequiredQualification = {
      entityId,
      qualificationId: q.id,
      title: q.title,
      version: q.version,
      status: "waiting",
      reason: "관리자의 계획 요청을 기다리고 있습니다.",
      canStart: false,
      ...(request
        ? {
            requestId: request.id,
            requestedVersion: request.targets!.find(
              (t) => t.entityId === entityId,
            )!.version,
          }
        : {}),
      ...(plan ? { planId: plan.id } : {}),
      ...(assignments[0] ? { assignmentId: assignments[0].id } : {}),
    };
    if (valid)
      Object.assign(row, {
        status: "fulfilled",
        reason: "같은 자격의 유효한 인증을 보유하고 있습니다.",
        assignmentId: valid.assignmentId,
        certificationId: valid.id,
      });
    else if (certs.length)
      Object.assign(row, {
        status:
          certificationStatus(certs[0]!, at) === "expired"
            ? "expired"
            : "unknown",
        reason:
          certificationStatus(certs[0]!, at) === "expired"
            ? "인증이 만료되었습니다. 재인증 절차는 관리자와 확인해 주세요."
            : "기존 인증의 유효기간을 확인해야 합니다.",
        certificationId: certs[0]!.id,
        assignmentId: certs[0]!.assignmentId,
      });
    else if (assignments.length)
      Object.assign(row, {
        status: "progress",
        reason: "확정한 계획의 기준으로 계속 진행할 수 있습니다.",
      });
    else if (plan)
      Object.assign(row, {
        status: "draft",
        reason: "작성 중인 계획을 확인해 주세요.",
      });
    else if (!org.effectiveActive || errors.length)
      Object.assign(row, {
        status: "blocked",
        reason: !org.effectiveActive
          ? "사용 중지된 조직입니다."
          : errors.join(" · "),
      });
    else if (request)
      Object.assign(row, {
        status: "ready",
        reason: "요청받은 필수 자격의 계획을 작성할 수 있습니다.",
        canStart: true,
      });
    return row;
  });
  return {
    revision: doc.revision,
    organizationId: org.id,
    organizationPath: org.path,
    description: org.description,
    duties: org.duties,
    configured: org.requiredQualifications !== null,
    items,
  };
}

export function planPolicyErrors(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  p: Pick<PersonalPlan, "qualificationId" | "requestId" | "organizationId">,
): string[] {
  const q = s.qualifications.find((q) => q.id === p.qualificationId);
  const r = s.planningRequests.find((r) => r.id === p.requestId);
  const org = organization(doc, u.organizationId);
  if (
    !q ||
    !r ||
    r.learnerId !== u.id ||
    r.organizationId !== org.id ||
    (p.organizationId && p.organizationId !== org.id)
  )
    return [
      "계획 요청 이후 소속이 달라졌거나 이전 요청입니다. 현재 소속의 새 요청을 확인해 주세요.",
    ];
  if (!org.effectiveActive)
    return ["사용 중인 소속 조직에서 계획을 확정해 주세요."];
  if (!org.requiredQualifications?.includes(q.entityId))
    return [
      "현재 소속 조직의 필수 자격이 아닙니다. 작성 내용은 보존되며 새 기준으로 재작성하거나 삭제할 수 있습니다.",
    ];
  if (!r.targets?.some((t) => t.entityId === q.entityId))
    return [
      "이 요청의 대상 자격이 아닙니다. 추가된 필수 자격은 별도 요청이 필요합니다.",
    ];
  if (
    !doc.qualificationPools.some(
      (v) =>
        v.lv1OrganizationId === org.lv1OrganizationId &&
        v.entityId === q.entityId &&
        v.qualificationId === q.id,
    )
  )
    return [
      "팀 적용 버전이 변경되었습니다. 현재 버전으로 계획을 다시 작성해 주세요.",
    ];
  return qualificationUseErrors(q, s.courses);
}

export function planningReadiness(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  at: string,
) {
  const view = requiredQualifications(s, doc, u, at);
  const ready = view.items.filter((i) =>
    ["ready", "waiting"].includes(i.status),
  );
  return {
    learnerId: u.id,
    canRequest:
      u.roles.includes("learner") && u.organizationActive && ready.length > 0,
    count: ready.length,
    reason: !u.organizationActive
      ? "사용 중지된 소속"
      : !view.configured
        ? "소속 조직 필수 자격 미설정"
        : !view.items.length
          ? "필수 자격 없음"
          : ready.length
            ? "계획 요청 가능"
            : view.items
                .map((i) => i.reason)
                .filter((x, i, a) => a.indexOf(x) === i)
                .join(" · "),
  };
}

export function requestProgress(
  s: State,
  doc: OrganizationDocument,
  requestId: string,
  at: string,
): RequestProgress {
  const r = s.planningRequests.find((r) => r.id === requestId)!;
  const u = userView(
    s.users.find((u) => u.id === r.learnerId)!,
    doc,
  );
  const own = requiredQualifications(s, doc, u, at),
    targets = r.targets || [];
  let planned = 0,
    valid = 0,
    excluded = 0,
    drafts = 0,
    covered = 0;
  for (const t of targets) {
    const item = own.items.find((i) => i.entityId === t.entityId);
    if (r.organizationId !== u.organizationId || !item) {
      excluded++;
      continue;
    }
    if (item.status === "fulfilled") valid++;
    const p = s.plans.find(
      (p) =>
        !p.deletedAt &&
        p.learnerId === u.id &&
        s.qualifications.find((q) => q.id === p.qualificationId)?.entityId ===
          t.entityId &&
        (!p.assignmentId ||
          !s.assignments.find((a) => a.id === p.assignmentId)?.excludedReason),
    );
    if (p?.status === "completed") planned++;
    if (p?.status === "completed" || item.status === "fulfilled") covered++;
    if (p?.status === "draft") drafts++;
  }
  const active = targets.length - excluded;
  return {
    id: r.id,
    learnerId: r.learnerId,
    total: targets.length,
    planned,
    valid,
    excluded,
    stage: !r.targets
      ? "이전 요청 · 기준 확인 필요"
      : !active
        ? "현재 대상 없음"
        : covered >= active
          ? "계획 완료"
          : planned || drafts
            ? "작성 중"
            : "미착수",
  };
}

export function policiesView(
  s: State,
  doc: OrganizationDocument,
  scope: string,
  u?: UserView,
): OrganizationPoliciesView {
  return {
    revision: doc.revision,
    stateRevision: s.revision,
    canManagePool: !u || fullManager(u),
    canAssignAdministrators: !u || fullManager(u),
    lv1OrganizationId: scope,
    entries: organizationEntries(doc)
      .filter(
        (e) =>
          e.lv1OrganizationId === scope &&
          (!u || fullManager(u) || e.id === u.organizationId),
      )
      .map((e) => ({
        ...e,
        userCount: s.users.filter((u) => u.organizationId === e.id).length,
        draftCount: s.plans.filter(
          (p) =>
            p.status === "draft" &&
            !p.deletedAt &&
            s.users.find((u) => u.id === p.learnerId)?.organizationId === e.id,
        ).length,
      })),
    pool: doc.qualificationPools
      .filter((p) => p.lv1OrganizationId === scope)
      .map((p) => {
        const q = s.qualifications.find((q) => q.id === p.qualificationId)!;
        return {
          ...p,
          title: q.title,
          version: q.version,
          errors: qualificationUseErrors(q, s.courses),
        };
      }),
  };
}

export function changePolicy(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  scope: string,
  target: string,
  body: unknown,
  pool: boolean,
) {
  policyScope(u, doc, scope, target, pool);
  const org = organization(doc, target);
  demand(
    org.lv1OrganizationId === scope,
    403,
    "다른 Lv1의 조직 설정을 변경할 수 없습니다.",
  );
  const base = z
    .object({ revision: z.number().int().nonnegative() })
    .parse(body);
  demand(
    base.revision === doc.revision,
    409,
    "조직 설정이 변경되었습니다. 다시 불러온 뒤 확인해 주세요.",
    "REVISION_CONFLICT",
  );
  let before: unknown, after: unknown;
  if (pool) {
    demand(target === scope, 422, "Lv1의 팀 자격 목록을 선택해 주세요.");
    const input = z
      .object({
        revision: z.number(),
        qualificationIds: z.array(z.string()).max(1000),
      })
      .strict()
      .parse(body);
    before = doc.qualificationPools.filter(
      (p) => p.lv1OrganizationId === scope,
    );
    const next = input.qualificationIds.map((id) => {
      const q = s.qualifications.find((q) => q.id === id);
      demand(
        q?.status === "published" && q.lv1OrganizationId === scope,
        422,
        "같은 Lv1의 게시 자격 버전을 선택해 주세요.",
      );
      return {
        lv1OrganizationId: scope,
        entityId: q.entityId,
        qualificationId: q.id,
      };
    });
    const blocked = organizationEntries(doc).filter(
      (e) =>
        e.lv1OrganizationId === scope &&
        e.requiredQualifications?.some(
          (id) => !next.some((p) => p.entityId === id),
        ),
    );
    demand(
      !blocked.length,
      409,
      `필수 지정부터 해제해 주세요: ${blocked.map((e) => e.path.map((p) => p.name).join(" › ")).join(", ")}`,
    );
    doc.qualificationPools = [
      ...doc.qualificationPools.filter((p) => p.lv1OrganizationId !== scope),
      ...next,
    ];
    after = next;
  } else {
    const input = z
      .object({
        revision: z.number(),
        description: z.string().max(4000),
        duties: z.string().max(4000),
        requiredQualifications: z.array(z.string()).nullable(),
      })
      .strict()
      .parse(body);
    const node = nodeFor(doc.roots, target)!;
    before = {
      description: node.description,
      duties: node.duties,
      requiredQualifications: node.requiredQualifications,
    };
    const { revision, ...values } = input;
    Object.assign(node, values);
    after = values;
  }
  validatePolicies(s, doc);
  doc.audits.push({
    id: randomUUID(),
    actorId: u.id,
    date: new Date().toISOString(),
    targetId: target,
    action: pool ? "organization.pool" : "organization.policy",
    before: JSON.parse(JSON.stringify(before)),
    after: JSON.parse(JSON.stringify(after)),
  });
  return { id: target, revision: doc.revision + 1 };
}
