import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  currentTeamQualifications,
  resolveRequirementRules,
  type RequirementRule,
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
import {
  policyScope,
  fullManager,
  administersSubtree,
} from "./organization-administrators.ts";
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
  const map = resolveRequirementRules(
    org.path,
    new Map(
      s.organizationQualificationRequirements.map((r) => [r.organizationId, r]),
    ),
  ).sources;
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
export function requirementRules(
  s: State,
  doc: OrganizationDocument,
  ids: string[],
): RequirementRule[] {
  const entries = organizationEntries(doc);
  return ids.flatMap((id) => {
    const org = entries.find((e) => e.id === id),
      r = s.organizationQualificationRequirements.find(
        (r) => r.organizationId === id,
      );
    return org
      ? [
          {
            organization: { id: org.id, name: org.name },
            entityIds: r?.entityIds || [],
            exclusions: r?.exclusions || [],
            revision: r?.revision || 0,
          },
        ]
      : [];
  });
}
export function checkRequirementContract(body: unknown) {
  demand(
    (body as any)?.contractVersion === 2,
    409,
    "상속 예외 계약이 변경되었습니다. 입력을 보존하고 새로고침해 주세요.",
    "REQUIREMENT_CONTRACT_CHANGED",
  );
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
      (fullManager(u) || administersSubtree(u, e)),
  );
  return {
    stateRevision: s.revision,
    organizationRevision: doc.revision,
    ancestorRules: requirementRules(
      s,
      doc,
      [...new Set(entries.flatMap((e) => e.path.map((p) => p.id)))].filter(
        (id) => !entries.some((e) => e.id === id),
      ),
    ),
    entries: entries.map((e) => ({
      id: e.id,
      name: e.name,
      path: e.path,
      parentId: e.parentId,
      level: e.level,
      effectiveActive: e.effectiveActive,
      editable: fullManager(u) || administersSubtree(u, e),
      directEntityIds:
        s.organizationQualificationRequirements.find(
          (r) => r.organizationId === e.id,
        )?.entityIds || [],
      exclusions:
        s.organizationQualificationRequirements.find(
          (r) => r.organizationId === e.id,
        )?.exclusions || [],
      excluded: [
        ...resolveRequirementRules(
          e.path,
          new Map(
            s.organizationQualificationRequirements.map((r) => [
              r.organizationId,
              r,
            ]),
          ),
        ).excluded.values(),
      ],
      effective: effectiveRequirements(s, doc, e.id),
    })),
    qualifications: currentTeamQualifications(s)
      .filter((p) => p.lv1OrganizationId === scope)
      .flatMap((p) => {
        const q = s.qualifications.find((q) => q.id === p.qualificationId)!;
        return q.qualificationType === "auditee" && q.purpose !== "renewal"
          ? [
              {
                entityId: q.entityId,
                id: q.id,
                title: q.title,
                version: q.version || 0,
                ...(q.releaseVersion
                  ? { releaseVersion: q.releaseVersion }
                  : {}),
                issues: qualificationUseErrors(q, s.courses),
              },
            ]
          : [];
      }),
  };
}
const ExclusionInput = z
  .object({
    entityId: z.string().min(1).max(160),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export const RequirementChanges = z
  .object({
    contractVersion: z.literal(2),
    stateRevision: z.number().int().nonnegative(),
    organizationRevision: z.number().int().nonnegative(),
    changes: z
      .array(
        z
          .object({
            organizationId: z.string().min(1),
            entityIds: z.array(z.string().min(1)).max(1000),
            exclusions: z.array(ExclusionInput).max(1000),
            removalReasons: z.array(ExclusionInput).max(1000),
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
  checkRequirementContract(body);
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
  const exceptionChanges: RequirementsPreview["exceptionChanges"] = [];
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
        version &&
          version.qualificationType === "auditee" &&
          version.purpose !== "renewal",
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
        exclusions: [],
        revision: 1,
        updatedAt: new Date().toISOString(),
        updatedBy: u.id,
      });
    const oldExclusions =
      s.organizationQualificationRequirements.find(
        (r) => r.organizationId === org.id,
      )?.exclusions || [];
    demand(
      new Set(change.exclusions.map((e) => e.entityId)).size ===
        change.exclusions.length &&
        new Set(change.removalReasons.map((e) => e.entityId)).size ===
          change.removalReasons.length,
      422,
      "예외 또는 해제 사유가 중복되었습니다.",
    );
    demand(
      !change.exclusions.some((e) => change.entityIds.includes(e.entityId)),
      422,
      "직접 지정과 상속 제외는 함께 저장할 수 없습니다.",
    );
    const removed = oldExclusions.filter(
      (e) => !change.exclusions.some((n) => n.entityId === e.entityId),
    );
    demand(
      removed.length === change.removalReasons.length &&
        removed.every((e) =>
          change.removalReasons.some((n) => n.entityId === e.entityId),
        ),
      422,
      "예외 해제 사유를 입력해 주세요.",
    );
    for (const e of change.exclusions) {
      demand(
        org.parentId &&
          s.qualifications.some(
            (q) =>
              q.entityId === e.entityId &&
              q.lv1OrganizationId === scope &&
              q.qualificationType === "auditee" &&
              !q.deletedAt,
          ),
        422,
        "같은 팀 하위 조직의 Auditee 상속만 제외할 수 있습니다.",
      );
      const old = oldExclusions.find((o) => o.entityId === e.entityId);
      if (!old)
        demand(
          org.effectiveActive,
          409,
          "사용 중인 조직에서만 새 예외를 설정할 수 있습니다.",
        );
      if (!old || old.reason !== e.reason)
        exceptionChanges.push({
          organizationId: org.id,
          entityId: e.entityId,
          action: old ? "reason" : "exclude",
          reason: e.reason,
        });
    }
    for (const e of change.removalReasons)
      exceptionChanges.push({
        organizationId: org.id,
        entityId: e.entityId,
        action: "restore",
        reason: e.reason,
      });
    next.organizationQualificationRequirements.find(
      (r) => r.organizationId === org.id,
    )!.exclusions = change.exclusions.map((e) => {
      const old = oldExclusions.find(
        (o) => o.entityId === e.entityId && o.reason === e.reason,
      );
      return (
        old || { ...e, updatedBy: u.id, updatedAt: new Date().toISOString() }
      );
    });
  }
  // Check additions against the final parent configuration, independent of batch order.
  for (const change of input.changes) {
    const org = entries.find((e) => e.id === change.organizationId)!;
    const inherited = resolveRequirementRules(
      org.path.slice(0, -1),
      new Map(
        next.organizationQualificationRequirements.map((r) => [
          r.organizationId,
          r,
        ]),
      ),
    ).sources;
    const old =
      s.organizationQualificationRequirements.find(
        (r) => r.organizationId === org.id,
      )?.exclusions || [];
    for (const e of change.exclusions)
      if (!old.some((o) => o.entityId === e.entityId))
        demand(
          inherited.has(e.entityId),
          409,
          "현재 상속받는 자격만 새로 제외할 수 있습니다. 상위 변경을 확인해 주세요.",
        );
  }
  const affected = entries
    .filter(
      (e) =>
        e.lv1OrganizationId === scope &&
        (fullManager(u) || administersSubtree(u, e)),
    )
    .flatMap((e) => {
      const before = effectiveRequirements(s, doc, e.id),
        after = effectiveRequirements(next, doc, e.id);
      const added = after
        .filter((r) => !before.some((b) => b.entityId === r.entityId))
        .map((r) => r.entityId);
      const removed = before
        .filter((r) => !after.some((a) => a.entityId === r.entityId))
        .map((r) => r.entityId);
      const sourceChanged = after.flatMap((r) => {
        const old = before.find((b) => b.entityId === r.entityId);
        return old &&
          JSON.stringify(old.sourceOrganizations) !==
            JSON.stringify(r.sourceOrganizations)
          ? [
              {
                entityId: r.entityId,
                before: old.sourceOrganizations,
                after: r.sourceOrganizations,
              },
            ]
          : [];
      });
      const beforeExcluded = resolveRequirementRules(
        e.path,
        new Map(
          s.organizationQualificationRequirements.map((r) => [
            r.organizationId,
            r,
          ]),
        ),
      ).excluded;
      const afterExcluded = resolveRequirementRules(
        e.path,
        new Map(
          next.organizationQualificationRequirements.map((r) => [
            r.organizationId,
            r,
          ]),
        ),
      ).excluded;
      const exclusionChanged = [
        ...new Set([...beforeExcluded.keys(), ...afterExcluded.keys()]),
      ].filter(
        (id) =>
          JSON.stringify(beforeExcluded.get(id)) !==
          JSON.stringify(afterExcluded.get(id)),
      );
      return added.length ||
        removed.length ||
        sourceChanged.length ||
        exclusionChanged.length
        ? [
            {
              organizationId: e.id,
              name: e.name,
              added,
              removed,
              sourceChanged,
              exclusionChanged,
              issues: after.flatMap((r) =>
                r.issues.map((i) => `${r.title}: ${i}`),
              ),
            },
          ]
        : [];
    });
  const changedIds = new Set(
    affected
      .filter((e) => e.added.length || e.removed.length)
      .map((e) => e.organizationId),
  );
  const activeIds = new Set(
    entries
      .filter((e) => e.effectiveActive && changedIds.has(e.id))
      .map((e) => e.id),
  );
  return {
    ...input,
    exceptionChanges,
    affected,
    summary: {
      affectedOrganizations: affected.length,
      membershipChangedOrganizations: changedIds.size,
      sourceOnlyOrganizations: affected.filter(
        (e) => !e.added.length && !e.removed.length && !!e.sourceChanged.length,
      ).length,
      exceptionOnlyOrganizations: affected.filter(
        (e) =>
          !e.added.length &&
          !e.removed.length &&
          !e.sourceChanged.length &&
          !!e.exclusionChanged.length,
      ).length,
      affectedMembers: new Set(
        s.users
          .filter((user) => activeIds.has(user.organizationId))
          .map((user) => user.id),
      ).size,
    },
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
    const exclusions = change.exclusions.map(
      (e) =>
        before?.exclusions.find(
          (o) => o.entityId === e.entityId && o.reason === e.reason,
        ) || { ...e, updatedBy: u.id, updatedAt: at },
    );
    if (r) {
      r.entityIds = change.entityIds;
      r.exclusions = exclusions;
      r.revision++;
      r.updatedAt = at;
      r.updatedBy = u.id;
    } else {
      s.organizationQualificationRequirements.push({
        organizationId: change.organizationId,
        entityIds: change.entityIds,
        exclusions,
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
      reason: "조직 필요자격 지정·상속 예외 변경·새 요청부터 적용",
      details: {
        before,
        after: { ...change },
        exceptionChanges: preview.exceptionChanges.filter(
          (e) => e.organizationId === change.organizationId,
        ),
        affected: preview.affected,
        summary: preview.summary,
      },
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
    demand(
      new Set(r.exclusions.map((e) => e.entityId)).size ===
        r.exclusions.length &&
        !r.exclusions.some((e) => r.entityIds.includes(e.entityId)),
      422,
      "필요자격 직접 지정·제외 중복을 확인해 주세요.",
    );
    for (const e of r.exclusions)
      demand(
        org.parentId && s.users.some((u) => u.id === e.updatedBy),
        422,
        "상속 예외 조직 또는 설정자를 확인해 주세요.",
      );
    for (const id of [...r.entityIds, ...r.exclusions.map((e) => e.entityId)])
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
    const snapshot = r.requirementSnapshot;
    if (snapshot?.ruleVersion === 2) {
      const path = r.organizationPath || [],
        rules = snapshot.rules || [];
      demand(
        rules.length === path.length &&
          rules.every(
            (v, i) =>
              v.organizationId === path[i]?.id &&
              new Set(v.entityIds).size === v.entityIds.length &&
              new Set(v.excludedEntityIds).size ===
                v.excludedEntityIds.length &&
              !v.entityIds.some((id) => v.excludedEntityIds.includes(id)),
          ),
        422,
        "계획 요청의 상속 예외 근거를 확인해 주세요.",
      );
      const resolved = resolveRequirementRules(
        path,
        new Map(
          rules.map((v) => [
            v.organizationId,
            {
              entityIds: v.entityIds,
              exclusions: v.excludedEntityIds.map((entityId) => ({
                entityId,
                reason: "snapshot",
                updatedAt: r.createdAt,
                updatedBy: r.requestedBy,
              })),
            },
          ]),
        ),
      ).sources;
      demand(
        resolved.size === snapshot.sources.length &&
          snapshot.sources.every(
            (v) =>
              JSON.stringify(resolved.get(v.entityId)?.map((o) => o.id)) ===
              JSON.stringify(v.organizations.map((o) => o.id)),
          ),
        422,
        "계획 요청의 적용 목록과 상속 근거가 다릅니다.",
      );
    } else
      demand(
        !snapshot?.rules,
        422,
        "상속 예외 근거의 계약 버전을 확인해 주세요.",
      );
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
