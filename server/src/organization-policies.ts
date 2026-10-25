import { candidate, planningView, planRequestErrors } from "./planning.ts";
import {
  currentQualification,
  requireQualificationProcess,
} from "./qualification-templates.ts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  organizationEntries,
  hasQualificationRole,
  type QualificationType,
  qualificationUseErrors,
  qualificationReadinessErrors,
  certificationStatus,
  effectiveCredentialStatus,
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
import { openAssignment, lastRevoked } from "./qualification-lifecycle.ts";
import { fullManager, policyScope } from "./organization-administrators.ts";

export function validatePolicies(s: State, doc: OrganizationDocument) {
  const entries = organizationEntries(doc);
  const seen = new Set<string>();
  for (const p of doc.qualificationPools) {
    const q = s.qualifications.find((q) => q.id === p.qualificationId);
    demand(
      entries.some((e) => e.id === p.lv1OrganizationId && e.level === 1) &&
        q &&
        !q.deletedAt &&
        q.lv1OrganizationId === p.lv1OrganizationId &&
        q.entityId === p.entityId,
      422,
      "팀 자격 목록의 조직·게시 버전 참조를 확인해 주세요.",
    );
    requireQualificationProcess(q!);
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
          new Set([...r.targets, ...r.selections].map((t) => t.entityId))
            .size ===
            r.targets.length + r.selections.length &&
          [...r.targets, ...r.selections].every((t) =>
            s.qualifications.some(
              (q) =>
                q.id === t.qualificationId &&
                q.entityId === t.entityId &&
                q.version === t.version &&
                q.qualificationType === r.qualificationType &&
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
  type?: QualificationType,
): RequiredQualificationsView {
  const org = organization(doc, u.organizationId);
  const items = (org.requiredQualifications || [])
    .filter((entityId) => {
      const q = s.qualifications.find((q) => q.entityId === entityId);
      return (
        q &&
        (type
          ? q.qualificationType === type
          : hasQualificationRole(u.roles, q.qualificationType))
      );
    })
    .map((entityId) => {
      const pool = doc.qualificationPools.find(
        (p) =>
          p.lv1OrganizationId === org.lv1OrganizationId &&
          p.entityId === entityId,
      )!;
      const q = currentQualification(
        s,
        s.qualifications.find((q) => q.id === pool.qualificationId)!,
      );
      const all = s.assignments.filter(
        (a) =>
          a.learnerId === u.id &&
          !a.excludedReason &&
          s.qualifications.find((q) => q.id === a.qualificationId)?.entityId ===
            entityId,
      );
      const assignments = all.filter((a) => openAssignment(s, a, at));
      const certs = s.certifications.filter((c) =>
        all.some((a) => a.id === c.assignmentId),
      );
      const valid = certs.find(
        (c) => effectiveCredentialStatus(c, at) === "Active",
      );
      const held = certs.find(
        (c) => effectiveCredentialStatus(c, at) === "Hold",
      );
      const previous = lastRevoked(s, u.id, entityId, at);
      const plan = [...s.plans]
        .reverse()
        .find(
          (p) =>
            p.learnerId === u.id &&
            !p.deletedAt &&
            s.qualifications.find((q) => q.id === p.qualificationId)
              ?.entityId === entityId &&
            (p.assignmentId
              ? assignments.some((a) => a.id === p.assignmentId)
              : p.previousCertificationId === previous?.id),
        );
      const request = [...s.planningRequests]
        .reverse()
        .find(
          (r) =>
            r.learnerId === u.id &&
            r.organizationId === org.id &&
            !r.completion &&
            [...(r.targets || []), ...(r.selections || [])].some(
              (t) =>
                t.entityId === entityId &&
                t.previousCertificationId === previous?.id,
            ),
        );
      const errors = qualificationUseErrors(q, s.courses);
      const row: RequiredQualification = {
        entityId,
        qualificationId: q.id,
        title: q.title,
        version: q.version,
        status: "waiting",
        reason: previous
          ? "Revoke · 다시 취득하려면 관리자의 새 계획 요청이 필요합니다."
          : "관리자의 계획 요청을 기다리고 있습니다.",
        canStart: false,
        ...(previous ? { previousCertificationId: previous.id } : {}),
        ...(request
          ? {
              requestId: request.id,
              requestedVersion: [
                ...(request.targets || []),
                ...request.selections,
              ].find((t) => t.entityId === entityId)!.version,
            }
          : {}),
        ...(plan ? { planId: plan.id } : {}),
        ...(assignments[0] ? { assignmentId: assignments[0].id } : {}),
      };
      if (u.certificationEligibility === "hold")
        Object.assign(row, {
          status: "blocked",
          reason: "취득 대상자 Hold · 대상자 통계에서 제외됩니다.",
        });
      else if (valid)
        Object.assign(row, {
          status: "fulfilled",
          reason: "같은 자격의 유효한 인증을 보유하고 있습니다.",
          assignmentId: valid.assignmentId,
          certificationId: valid.id,
        });
      else if (held)
        Object.assign(row, {
          status: "unknown",
          reason: held.validityNeedsCorrection
            ? "Hold · 기존 인증의 유효기간을 확인해야 합니다."
            : "Hold · 개인 자격 효력이 정지되었습니다. 관리자 확인이 필요합니다.",
          assignmentId: held.assignmentId,
          certificationId: held.id,
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
          reason: previous
            ? "새 요청으로 재취득 계획을 작성할 수 있습니다."
            : "요청받은 필수 자격의 계획을 작성할 수 있습니다.",
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
  at = new Date().toISOString(),
): string[] {
  return planRequestErrors(s, doc, u, p, at);
}

export function planningReadiness(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  at: string,
  type: QualificationType = "auditee",
) {
  const org = organization(doc, u.organizationId);
  const rows = doc.qualificationPools
    .filter(
      (p) =>
        p.lv1OrganizationId === u.lv1OrganizationId &&
        s.qualifications.find((q) => q.id === p.qualificationId)
          ?.qualificationType === type,
    )
    .map((p) => candidate(s, doc, u, p.entityId, at));
  return {
    qualificationType: type,
    learnerId: u.id,
    canRequest:
      hasQualificationRole(u.roles, type) &&
      u.organizationActive &&
      u.certificationEligibility !== "hold",
    count: rows.filter((c) => c.status === "available").length,
    requiredCount: (org.requiredQualifications || []).filter((id) =>
      s.qualifications.some(
        (q) => q.entityId === id && q.qualificationType === type,
      ),
    ).length,
    draftCount: s.plans.filter(
      (p) =>
        p.learnerId === u.id &&
        s.qualifications.find((q) => q.id === p.qualificationId)
          ?.qualificationType === type &&
        p.lv1OrganizationId === u.lv1OrganizationId &&
        p.status === "draft" &&
        !p.deletedAt,
    ).length,
    reason: !hasQualificationRole(u.roles, type)
      ? "요청 유형에 맞는 역할이 필요합니다."
      : !u.organizationActive
        ? "사용 중지된 소속"
        : u.certificationEligibility === "hold"
          ? "취득 대상자 Hold"
          : "계획 요청 가능",
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
  const v = planningView(s, doc, u, r, at);
  const rows = v.candidates.filter((c) => c.selected);
  const evidence = r.completion?.evidence;
  return {
    id: r.id,
    learnerId: r.learnerId,
    total: evidence ? evidence.length : rows.length,
    planned: evidence
      ? evidence.filter(
          (e) => e.planId || (e.assignmentId && !e.certificationId),
        ).length
      : rows.filter((c) =>
          s.plans.some((p) => p.id === c.planId && p.status === "completed"),
        ).length,
    valid: evidence
      ? evidence.filter((e) => e.certificationId).length
      : rows.filter((c) => c.status === "valid").length,
    excluded: 0,
    stage: v.stage,
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
        const q = currentQualification(
          s,
          s.qualifications.find((q) => q.id === p.qualificationId)!,
        );
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
      if (q) requireQualificationProcess(q);
      demand(
        q &&
          !q.deletedAt &&
          q.lv1OrganizationId === scope &&
          !qualificationReadinessErrors(currentQualification(s, q), s.courses)
            .length,
        422,
        "같은 팀의 설정이 완료된 자격 버전을 선택해 주세요.",
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
