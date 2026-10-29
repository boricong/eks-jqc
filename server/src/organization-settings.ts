import { effectiveRequirements } from "./organization-requirements.ts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  currentTeamQualifications,
  organizationEntries,
  hasQualificationRole,
  type QualificationType,
  type State,
  type OrganizationDocument,
  type UserView,
  type PersonalPlan,
  type RequestProgress,
  type OrganizationSettingsView,
} from "@eks/contracts";
import { candidate, planningView, planRequestErrors } from "./planning.ts";
import { requireQualificationProcess } from "./qualification-templates.ts";
import { nodeFor, userView } from "./organizations.ts";
import { demand } from "./errors.ts";
import {
  fullManager,
  policyScope,
  administersSubtree,
} from "./organization-administrators.ts";

export function validatePolicies(s: State, doc: OrganizationDocument) {
  const entries = organizationEntries(doc);
  const seen = new Set<string>();
  for (const p of currentTeamQualifications(s)) {
    const q = s.qualifications.find((q) => q.id === p.qualificationId);
    demand(
      entries.some((e) => e.id === p.lv1OrganizationId && e.level === 1) &&
        q &&
        !q.deletedAt &&
        q.lv1OrganizationId === p.lv1OrganizationId &&
        q.entityId === p.entityId,
      422,
      "팀 자격의 조직 참조·현재 버전을 확인해 주세요.",
    );
    requireQualificationProcess(q!);
    const key = `${p.lv1OrganizationId}:${p.entityId}`;
    demand(!seen.has(key), 422, "팀 자격 목록이 중복되었습니다.");
    if (q!.version !== null) seen.add(key);
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
    if (r.selections)
      demand(
        new Set(r.selections.map((t) => t.entityId)).size ===
          r.selections.length &&
          r.selections.every((t) =>
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
  const requirements =
    type === "auditee" ? effectiveRequirements(s, doc, u.organizationId) : [];
  const requirementReason = !requirements.length
    ? "조직 필요자격 미지정"
    : requirements.some((r) => r.issues.length)
      ? "필요자격 운영 준비 확인 필요"
      : "";
  const rows = requirements.map((r) => candidate(s, doc, u, r.entityId, at));
  return {
    qualificationType: type,
    learnerId: u.id,
    canRequest:
      !requirementReason &&
      hasQualificationRole(u.roles, type) &&
      u.organizationActive &&
      u.certificationEligibility !== "hold" &&
      !workDeactive(u, type),
    count: rows.filter((c) => c.status === "available").length,
    draftCount: s.plans.filter(
      (p) =>
        p.learnerId === u.id &&
        s.qualifications.find((q) => q.id === p.qualificationId)
          ?.qualificationType === type &&
        p.lv1OrganizationId === u.lv1OrganizationId &&
        p.status === "draft" &&
        !s.planningRequests.find((r) => r.id === p.requestId)?.closed &&
        !p.deletedAt,
    ).length,
    reason: !hasQualificationRole(u.roles, type)
      ? "요청 유형에 맞는 역할이 필요합니다."
      : !u.organizationActive
        ? "사용 중지된 소속"
        : workDeactive(u, type)
          ? WORK_DEACTIVE_MESSAGE
          : u.certificationEligibility === "hold"
            ? "취득 대상자 Hold"
            : requirementReason || "계획 요청 가능",
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

export function organizationSettingsView(
  s: State,
  doc: OrganizationDocument,
  scope: string,
  u: UserView,
): OrganizationSettingsView {
  return {
    revision: doc.revision,
    stateRevision: s.revision,
    canAssignAdministrators: fullManager(u),
    lv1OrganizationId: scope,
    entries: organizationEntries(doc)
      .filter(
        (e) =>
          e.lv1OrganizationId === scope &&
          (fullManager(u) || administersSubtree(u, e)),
      )
      .map((e) => ({
        ...e,
        userCount: s.users.filter((u) => u.organizationId === e.id).length,
      })),
  };
}
export function changeOrganizationSettings(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  scope: string,
  target: string,
  body: unknown,
) {
  policyScope(u, doc, scope, target);
  const input = z
    .object({
      revision: z.number().int().nonnegative(),
      description: z.string().max(4000),
      duties: z.string().max(4000),
    })
    .strict()
    .parse(body);
  demand(
    input.revision === doc.revision,
    409,
    "조직 정보가 변경되었습니다. 다시 불러온 뒤 확인해 주세요.",
    "REVISION_CONFLICT",
  );
  const node = nodeFor(doc.roots, target)!;
  const before = { description: node.description, duties: node.duties };
  const { revision, ...after } = input;
  Object.assign(node, after);
  doc.audits.push({
    id: randomUUID(),
    actorId: u.id,
    date: new Date().toISOString(),
    targetId: target,
    action: "organization.settings",
    before: JSON.parse(JSON.stringify(before)),
    after,
  });
  return { id: target, revision: doc.revision + 1 };
}
import { workDeactive, WORK_DEACTIVE_MESSAGE } from "@eks/contracts";
