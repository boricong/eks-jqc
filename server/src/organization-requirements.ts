import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  currentTeamQualifications,
  organizationEntries,
  qualificationUseErrors,
  type State,
  type OrganizationDocument,
  type UserView,
  type EffectiveRequirement,
  type OrganizationRequirementsView,
  type RequirementsPreview,
  type PlanningRequestPreview,
} from "@eks/contracts";
import { policyScope, fullManager } from "./organization-administrators.ts";
import { userView } from "./organizations.ts";
import { candidate } from "./planning.ts";
import { demand } from "./errors.ts";

export function effectiveRequirements(
  s: State,
  doc: OrganizationDocument,
  organizationId: string,
): EffectiveRequirement[] {
  const org = organizationEntries(doc).find((e) => e.id === organizationId);
  if (!org) return [];
  const map = new Map<string, { id: string; name: string }[]>();
  for (const ancestor of org.path) {
    for (const entityId of s.organizationQualificationRequirements.find(
      (r) => r.organizationId === ancestor.id,
    )?.entityIds || []) {
      const sources = map.get(entityId) || [];
      sources.push(ancestor);
      map.set(entityId, sources);
    }
  }
  const pool = currentTeamQualifications(s);
  return [...map].map(([entityId, sourceOrganizations]) => {
    const entry = pool.find(
      (p) =>
        p.entityId === entityId &&
        p.lv1OrganizationId === org.lv1OrganizationId,
    );
    const q =
      s.qualifications.find((q) => q.id === entry?.qualificationId) ||
      s.qualifications.find(
        (q) =>
          q.entityId === entityId &&
          q.lv1OrganizationId === org.lv1OrganizationId,
      );
    return {
      entityId,
      qualificationId: q?.id || "",
      title: q?.title || "삭제된 자격",
      version: q?.version || 1,
      sourceOrganizations,
      issues:
        !entry || !q
          ? ["현재 사용할 팀 자격이 없습니다."]
          : qualificationUseErrors(q, s.courses),
    };
  });
}
export function requirementsView(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  scope: string,
): OrganizationRequirementsView {
  policyScope(u, doc, scope);
  const entries = organizationEntries(doc).filter(
    (e) =>
      e.lv1OrganizationId === scope &&
      (fullManager(u) || e.id === u.organizationId),
  );
  return {
    stateRevision: s.revision,
    organizationRevision: doc.revision,
    entries: entries.map((e) => ({
      id: e.id,
      name: e.name,
      path: e.path,
      effectiveActive: e.effectiveActive,
      editable: fullManager(u) || e.id === u.organizationId,
      directEntityIds:
        s.organizationQualificationRequirements.find(
          (r) => r.organizationId === e.id,
        )?.entityIds || [],
      effective: effectiveRequirements(s, doc, e.id),
    })),
    qualifications: currentTeamQualifications(s)
      .filter((p) => p.lv1OrganizationId === scope)
      .flatMap((p) => {
        const q = s.qualifications.find((q) => q.id === p.qualificationId)!;
        return q.qualificationType === "auditee"
          ? [
              {
                entityId: q.entityId,
                id: q.id,
                title: q.title,
                version: q.version || 0,
                issues: qualificationUseErrors(q, s.courses),
              },
            ]
          : [];
      }),
  };
}
export const RequirementChanges = z
  .object({
    stateRevision: z.number().int().nonnegative(),
    organizationRevision: z.number().int().nonnegative(),
    changes: z
      .array(
        z
          .object({
            organizationId: z.string().min(1),
            entityIds: z.array(z.string().min(1)).max(1000),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict();
export function previewRequirements(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  scope: string,
  body: unknown,
): RequirementsPreview {
  const input = RequirementChanges.parse(body);
  demand(
    input.stateRevision === s.revision &&
      input.organizationRevision === doc.revision,
    409,
    "조직 또는 자격 기준이 변경되었습니다. 입력을 보존하고 다시 검토해 주세요.",
    "REVISION_CONFLICT",
  );
  demand(
    new Set(input.changes.map((c) => c.organizationId)).size ===
      input.changes.length,
    422,
    "변경 조직이 중복되었습니다.",
  );
  const entries = organizationEntries(doc);
  const next = structuredClone(s);
  for (const change of input.changes) {
    policyScope(u, doc, scope, change.organizationId);
    const org = entries.find((e) => e.id === change.organizationId)!;
    demand(org, 422, "조직을 확인해 주세요.");
    demand(
      new Set(change.entityIds).size === change.entityIds.length,
      422,
      "지정 자격이 중복되었습니다.",
    );
    const before =
      s.organizationQualificationRequirements.find(
        (r) => r.organizationId === org.id,
      )?.entityIds || [];
    for (const id of change.entityIds) {
      const q = currentTeamQualifications(s).find(
        (p) => p.entityId === id && p.lv1OrganizationId === scope,
      );
      const version = s.qualifications.find((v) => v.id === q?.qualificationId);
      demand(
        version && version.qualificationType === "auditee",
        422,
        "같은 팀의 Auditee 자격만 지정할 수 있습니다.",
      );
      if (!before.includes(id))
        demand(
          org.effectiveActive &&
            !qualificationUseErrors(version, s.courses).length,
          409,
          `${version.title}: 운영 준비를 완료한 활성 조직·자격만 새로 지정할 수 있습니다.`,
        );
    }
    const record = next.organizationQualificationRequirements.find(
      (r) => r.organizationId === org.id,
    );
    if (record) record.entityIds = change.entityIds;
    else
      next.organizationQualificationRequirements.push({
        organizationId: org.id,
        entityIds: change.entityIds,
        revision: 1,
        updatedAt: new Date().toISOString(),
        updatedBy: u.id,
      });
  }
  const affected = entries
    .filter((e) => e.lv1OrganizationId === scope)
    .flatMap((e) => {
      const before = effectiveRequirements(s, doc, e.id).map((r) => r.entityId),
        after = effectiveRequirements(next, doc, e.id).map((r) => r.entityId);
      const added = after.filter((id) => !before.includes(id)),
        removed = before.filter((id) => !after.includes(id));
      return added.length || removed.length
        ? [{ organizationId: e.id, name: e.name, added, removed }]
        : [];
    });
  return {
    ...input,
    affected: fullManager(u)
      ? affected
      : affected.filter((e) => e.organizationId === u.organizationId),
  };
}
export function saveRequirements(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  scope: string,
  body: unknown,
) {
  const preview = previewRequirements(s, doc, u, scope, body),
    at = new Date().toISOString();
  for (const change of preview.changes) {
    let r = s.organizationQualificationRequirements.find(
      (r) => r.organizationId === change.organizationId,
    );
    const before = r ? structuredClone(r) : null;
    if (r) {
      r.entityIds = change.entityIds;
      r.revision++;
      r.updatedAt = at;
      r.updatedBy = u.id;
    } else {
      s.organizationQualificationRequirements.push({
        organizationId: change.organizationId,
        entityIds: change.entityIds,
        revision: 1,
        updatedAt: at,
        updatedBy: u.id,
      });
    }
    s.audits.push({
      id: randomUUID(),
      actorId: u.id,
      date: at,
      action: "organization.requirements",
      targetId: change.organizationId,
      lv1OrganizationId: scope,
      reason: "조직 필요자격 직접 지정 변경·새 요청부터 적용",
      details: { before, after: change },
    });
  }
  return { revision: s.revision + 1 };
}
export function previewPlanningRequest(
  s: State,
  doc: OrganizationDocument,
  scope: string,
  learnerIds: string[],
  at: string,
): PlanningRequestPreview {
  demand(
    learnerIds.length > 0 &&
      learnerIds.length <= 200 &&
      new Set(learnerIds).size === learnerIds.length,
    422,
    "대상자를 확인해 주세요.",
  );
  return {
    stateRevision: s.revision,
    organizationRevision: doc.revision,
    rows: learnerIds.map((id) => {
      const raw = s.users.find((u) => u.id === id);
      demand(raw, 422, "대상자를 찾을 수 없습니다.");
      const u = userView(raw, doc);
      demand(
        u.lv1OrganizationId === scope,
        403,
        "선택한 팀의 대상자만 확인할 수 있습니다.",
      );
      const requirements = effectiveRequirements(s, doc, u.organizationId);
      const reasons = [
        ...(!u.roles.includes("learner") ? ["학습자 역할이 필요합니다."] : []),
        ...(!u.organizationActive ? ["사용 중지된 소속입니다."] : []),
        ...(u.certificationEligibility === "hold"
          ? ["취득 대상자 Hold 상태입니다."]
          : []),
        ...requirements.flatMap((r) => r.issues.map((i) => `${r.title}: ${i}`)),
      ];
      return {
        learnerId: id,
        name: u.name,
        organizationId: u.organizationId,
        organizationPath: u.organizationPath,
        status: reasons.length
          ? "blocked"
          : requirements.length
            ? "ready"
            : "excluded",
        reasons: requirements.length
          ? reasons
          : [...reasons, "조직 필요자격이 지정되지 않았습니다."],
        requirements,
        existingRequestIds: s.planningRequests
          .filter(
            (r) =>
              r.learnerId === id &&
              r.lv1OrganizationId === scope &&
              r.qualificationType === "auditee" &&
              !r.completion &&
              !r.closed,
          )
          .map((r) => r.id),
        coveredEntityIds: requirements
          .filter((r) =>
            ["valid", "planned"].includes(
              candidate(s, doc, u, r.entityId, at).status,
            ),
          )
          .map((r) => r.entityId),
      };
    }),
  };
}
export function closePlanningRequest(
  s: State,
  u: UserView,
  scope: string,
  id: string,
  body: unknown,
  at: string,
  replacementRequestId?: string,
) {
  const input = z
    .object({
      revision: z.number().int().positive(),
      reason: z.string().trim().min(1).max(2000),
    })
    .strict()
    .parse(body);
  const r = s.planningRequests.find((r) => r.id === id);
  demand(
    r && r.lv1OrganizationId === scope && r.qualificationType === "auditee",
    403,
    "선택한 팀의 Auditee 요청만 종료할 수 있습니다.",
  );
  demand(
    !r.completion && !r.closed && r.revision === input.revision,
    409,
    "요청 상태가 변경되었습니다. 다시 확인해 주세요.",
  );
  r.closed = {
    date: at,
    actorId: u.id,
    reason: input.reason,
    ...(replacementRequestId ? { replacementRequestId } : {}),
  };
  r.revision++;
  for (const n of s.notifications.filter(
    (n) => n.key === `planning:${id}` && !n.resolvedAt,
  ))
    n.resolvedAt = at;
  s.audits.push({
    id: randomUUID(),
    actorId: u.id,
    date: at,
    action: "planning.close",
    targetId: r.id,
    lv1OrganizationId: scope,
    reason: input.reason,
    details: { closed: r.closed },
  });
  return { id: r.id, revision: r.revision };
}
export function validateRequirements(s: State, doc: OrganizationDocument) {
  const entries = organizationEntries(doc),
    seen = new Set<string>();
  for (const r of s.organizationQualificationRequirements) {
    const org = entries.find((e) => e.id === r.organizationId);
    demand(
      org && !seen.has(r.organizationId),
      422,
      "필요자격 조직 참조 또는 중복을 확인해 주세요.",
    );
    seen.add(r.organizationId);
    demand(
      new Set(r.entityIds).size === r.entityIds.length &&
        s.users.some((u) => u.id === r.updatedBy),
      422,
      "필요자격 중복 또는 수정자를 확인해 주세요.",
    );
    for (const id of r.entityIds)
      demand(
        s.qualifications.some(
          (q) =>
            q.entityId === id &&
            q.lv1OrganizationId === org.lv1OrganizationId &&
            q.qualificationType === "auditee" &&
            !q.deletedAt,
        ),
        422,
        "필요자격의 팀·유형·계보 참조를 확인해 주세요.",
      );
  }
  for (const r of s.planningRequests) {
    demand(
      !(r.closed && r.completion),
      422,
      "종료 요청은 완료 처리할 수 없습니다.",
    );
    if (r.closed) {
      demand(
        s.users.some((u) => u.id === r.closed!.actorId),
        422,
        "요청 종료자를 확인해 주세요.",
      );
      if (r.closed.replacementRequestId)
        demand(
          s.planningRequests.some(
            (n) =>
              n.id === r.closed!.replacementRequestId &&
              n.id !== r.id &&
              n.learnerId === r.learnerId &&
              n.lv1OrganizationId === r.lv1OrganizationId,
          ),
          422,
          "대체 요청을 확인해 주세요.",
        );
    }
    if (r.mode === "organization_required") {
      demand(
        r.qualificationType === "auditee" &&
          r.selections.length &&
          r.requirementSnapshot &&
          r.requirementSnapshot.sources.length === r.selections.length,
        422,
        "필요자격 요청의 고정 근거를 확인해 주세요.",
      );
      demand(
        new Set(r.requirementSnapshot.sources.map((x) => x.entityId)).size ===
          r.selections.length &&
          r.requirementSnapshot.sources.every(
            (x) =>
              r.selections.some((t) => t.entityId === x.entityId) &&
              x.organizations.every((o) =>
                r.organizationPath?.some((p) => p.id === o.id),
              ),
          ),
        422,
        "필요자격 상속 근거를 확인해 주세요.",
      );
    }
  }
}
