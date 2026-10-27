import {
  criteriaFingerprint,
  freezeCriteria,
  releaseInfo,
  releaseNumber,
} from "./releases.ts";
import { latestQualification, nextReleaseVersion } from "@eks/contracts";
import { auditorTemplateErrors } from "./auditor-pool.ts";
import {
  previewPlanningRequest,
  closePlanningRequest,
} from "./organization-requirements.ts";
import {
  copyCommonCourses,
  validateDefaultCommonCourses,
} from "./common-courses.ts";
import { numberedQualificationVersion } from "./qualification-templates.ts";
import { canContinueType } from "./personal-access.ts";
import { candidate, planningView, planRequestErrors } from "./planning.ts";
import {
  planPolicyErrors,
  planningReadiness,
} from "./organization-settings.ts";
import {
  currentQualification,
  metadata,
  requireQualificationProcess,
} from "./qualification-templates.ts";
export { qualificationTemplates } from "./qualification-templates.ts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  PersonalPlanSchema,
  PlanStartInputSchema,
  LearningRecordSchema,
  QualificationSchema,
  QualificationTypeSchema,
  hasQualificationRole,
  qualificationPolicySnapshot,
  qualificationUseErrors,
  planErrors,
  WORKFLOW_VERSION,
  defaultPlanningDueOn,
  kstDate,
  defaultPlanSchedule,
  type State,
  type UserView,
  type OrganizationDocument,
} from "@eks/contracts";
import { demand, DomainError } from "./errors.ts";
import { userView, organization } from "./organizations.ts";
import {
  requireEligible,
  openAssignment,
  lastRevoked,
} from "./qualification-lifecycle.ts";
import { notify } from "./notifications.ts";

const find = <T extends { id: string }>(xs: T[], id: string): T => {
  const value = xs.find((x) => x.id === id);
  demand(value, 404, "기록을 찾을 수 없습니다.");
  return value;
};
const expected = (item: { revision: number }, revision: unknown) =>
  demand(
    item.revision === revision,
    409,
    "다른 창에서 변경되었습니다. 다시 불러온 뒤 확인해 주세요.",
    "REVISION_CONFLICT",
  );
export const isWorkflowAction = (action: string) =>
  ["template.", "planning.", "plan.", "learning.", "notification."].some((p) =>
    action.startsWith(p),
  );

export function authorizeWorkflow(
  s: State,
  u: UserView,
  action: string,
  target: string,
  body: any,
  scope?: string,
) {
  if (action === "planning.request" && body.qualificationType === "auditor")
    throw new DomainError(
      410,
      "Auditor 계획 요청은 종료되었습니다. /admin/auditor에서 운영 기준을 관리해 주세요.",
      "AUDITOR_PLANNING_REMOVED",
      { replacementPath: "/admin/auditor" },
    );
  if (action === "planning.close") {
    demand(
      scope &&
        s.planningRequests.some(
          (r) => r.id === target && r.lv1OrganizationId === scope,
        ),
      403,
      "선택한 팀의 요청만 종료할 수 있습니다.",
    );
    return;
  }
  if (action === "template.import" || action === "planning.request") {
    demand(scope, 403, "관리할 Lv1 조직을 선택해 주세요.");
    if (action === "planning.request")
      for (const id of z
        .array(z.string())
        .min(1)
        .max(200)
        .parse(body.learnerIds))
        demand(
          find(s.users, id) && s.users.some((user) => user.id === id),
          422,
          "대상자를 확인해 주세요.",
        );
    return;
  }
  if (action === "learning.save")
    demand(
      false,
      410,
      "학습 완료 기록 기능은 종료되었습니다. 학습 안내에서 평가하기로 이동해 주세요.",
      "FEATURE_REMOVED",
    );
  if (action === "notification.read") {
    demand(
      find(s.notifications, target).recipientId === u.id,
      403,
      "본인의 알림만 처리할 수 있습니다.",
    );
    return;
  }

  let record: { learnerId: string; lv1OrganizationId: string };
  if (action.startsWith("planning.")) record = find(s.planningRequests, target);
  else if (action === "plan.create")
    record = find(s.planningRequests, body.requestId);
  else if (action.startsWith("plan.")) record = find(s.plans, target);
  else record = find(s.assignments, find(s.enrollments, target).assignmentId);
  const request =
    action.startsWith("planning.") || action === "plan.create"
      ? (record as import("@eks/contracts").PlanningRequest)
      : s.planningRequests.find(
          (r) =>
            r.id ===
            s.plans.find(
              (p) =>
                p.id ===
                (action.startsWith("plan.") ? target : (record as any).planId),
            )?.requestId,
        );
  demand(
    canContinueType(s, u, request?.qualificationType || "auditee"),
    403,
    "해당 인증 유형의 권한이나 기존 요청이 필요합니다.",
  );
  demand(
    record.learnerId === u.id &&
      record.lv1OrganizationId === u.lv1OrganizationId,
    403,
    "본인의 계획·학습만 처리할 수 있습니다.",
  );
  if (
    (action.startsWith("plan.") || action.startsWith("planning.")) &&
    request?.qualificationType === "auditor"
  )
    throw new DomainError(
      410,
      "Auditor 계획 작성은 종료되었습니다. /auditor에서 학습을 시작해 주세요.",
      "AUDITOR_PLANNING_REMOVED",
      { replacementPath: "/auditor" },
    );
  if (
    action.startsWith("plan.") &&
    action !== "plan.create" &&
    action !== "plan.delete"
  )
    demand(
      !find(s.plans, target).deletedAt,
      410,
      "삭제된 계획입니다. 내 계획에서 다시 작성해 주세요.",
      "PLAN_DELETED",
    );
}

export function executeWorkflow(
  s: State,
  u: UserView,
  action: string,
  target: string,
  body: any,
  organizations: OrganizationDocument,
  scope = u.lv1OrganizationId,
  at = new Date().toISOString(),
) {
  if (
    [
      "plan.create",
      "plan.complete",
      "planning.select",
      "planning.complete",
    ].includes(action)
  )
    requireEligible(u);
  const audit = (
    id: string,
    reason = "",
    assignmentId?: string,
    details: Record<string, any> = {},
    auditAction = action,
  ) =>
    s.audits.push({
      id: randomUUID(),
      actorId: u.id,
      lv1OrganizationId: scope,
      date: at,
      action: auditAction,
      targetId: id,
      reason,
      assignmentId,
      details: JSON.parse(JSON.stringify(details)),
    });
  if (action === "notification.read") {
    const n = find(s.notifications, target);
    n.readAt ||= at;
    return { id: n.id };
  }
  if (action === "template.import") {
    demand(
      organization(organizations, scope).effectiveActive,
      422,
      "사용 중인 Lv1을 선택해 주세요.",
    );
    const ids = z.array(z.string()).min(1).max(1000).parse(body.templateIds);
    const expectedType = QualificationTypeSchema.optional().parse(
      body.qualificationType,
    );
    demand(new Set(ids).size === ids.length, 422, "자격이 중복되었습니다.");
    const imported: string[] = [],
      existing: string[] = [];
    for (const templateId of ids) {
      const template = find(s.qualificationTemplates, templateId);
      demand(
        template.scope !== "team",
        409,
        "팀 소유 Auditor 자격은 Auditor 운영에서 관리해 주세요.",
      );
      demand(
        !expectedType || template.qualificationType === expectedType,
        409,
        "선택한 기본자격의 인증 유형이 변경되었습니다. 등록 목록을 다시 확인해 주세요.",
        "QUALIFICATION_TYPE_CHANGED",
      );
      const previous = s.qualifications
        .filter(
          (q) => q.lv1OrganizationId === scope && q.templateId === templateId,
        )
        .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0];
      if (
        previous &&
        s.qualifications.some(
          (q) => q.entityId === previous.entityId && !q.deletedAt,
        )
      ) {
        existing.push(
          s.qualifications
            .filter((q) => q.entityId === previous.entityId && !q.deletedAt)
            .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0]!.id,
        );
        continue;
      }
      const expected = body.templateRevisions?.[template.id];
      demand(
        (expected === undefined &&
          template.qualificationType !== "auditor" &&
          template.defaultCommonCourseIds.length === 0) ||
          expected === template.revision,
        409,
        "기본자격 기본 목록이 변경되었습니다. 등록 목록을 다시 확인해 주세요.",
        "TEMPLATE_CHANGED",
      );
      const auditorErrors = auditorTemplateErrors(s, template);
      demand(
        !auditorErrors.length,
        409,
        auditorErrors.join(" · "),
        "AUDITOR_NOT_READY",
      );
      const commonIds = previous ? [] : template.defaultCommonCourseIds;
      validateDefaultCommonCourses(
        s,
        template.qualificationType,
        commonIds,
        body.commonCourseRevisions,
      );
      const copies = copyCommonCourses(s, commonIds, scope);
      const id = randomUUID();
      const maximumVersion = Math.max(
        0,
        ...s.qualifications
          .filter((q) => q.entityId === previous?.entityId)
          .map((q) => q.version ?? 0),
      );
      const ready =
        template.qualificationType === "auditee" && maximumVersion === 0;
      s.qualifications.push(
        QualificationSchema.parse({
          id,
          entityId: previous?.entityId || id,
          parentId: previous?.version != null ? previous.id : undefined,
          version: ready ? null : maximumVersion + 1,
          releaseVersion: ready
            ? null
            : previous?.version
              ? nextReleaseVersion(releaseNumber(previous), "major")
              : { major: 1, minor: 0 },
          releaseInfo: releaseInfo("initial", u.id, "팀 자격 등록"),
          revision: 1,
          lv1OrganizationId: scope,
          qualificationType: template.qualificationType,
          title: template.title,
          englishName: template.englishName,
          templateId,
          templateRevision: template.revision,
          description: template.description,
          lifecycleStatus: ready
            ? "Ready"
            : template.qualificationType === "auditor"
              ? "Hold"
              : "Active",
          ...(template.auditorLevel
            ? {
                auditorCriteria: {
                  level: template.auditorLevel,
                  ...(template.prerequisiteTemplateId
                    ? {
                        prerequisiteTemplateId: template.prerequisiteTemplateId,
                      }
                    : {}),
                },
              }
            : {}),
          renewalLeadMonths: 3,
          commonCourseEntityIds:
            previous?.commonCourseEntityIds ?? copies.map((c) => c.entityId),
          courseIds: copies.map((c) => c.id),
        }),
      );
      imported.push(id);
      audit(id, "기본 자격 가져오기", undefined, {
        templateId,
        commonCourseIds: copies.map((c) => c.id),
      });
    }
    return { imported, existing };
  }
  if (action === "planning.close")
    return closePlanningRequest(s, u, scope!, target, body, at);
  if (action === "planning.request") {
    const input = z
      .object({
        qualificationType: QualificationTypeSchema.default("auditee"),
        learnerIds: z.array(z.string()).min(1).max(200),
        dueOn: z.iso.date().optional(),
        message: z.string().max(2000),
        stateRevision: z.number().int().nonnegative(),
        organizationRevision: z.number().int().nonnegative(),
        replaceRequestIds: z.array(z.string()).default([]),
      })
      .strict()
      .parse(body);
    demand(
      input.stateRevision === s.revision &&
        input.organizationRevision === organizations.revision,
      409,
      "확인 이후 조직·대상자·자격 기준이 변경되었습니다. 입력을 보존하고 다시 검토해 주세요.",
      "REVISION_CONFLICT",
    );
    const review = previewPlanningRequest(
      s,
      organizations,
      scope!,
      input.learnerIds,
      at,
    );
    demand(
      review.rows.every((r) => r.status === "ready"),
      409,
      review.rows
        .filter((r) => r.status !== "ready")
        .map((r) => `${r.name}: ${r.reasons.join(" · ")}`)
        .join("\n"),
      "PLANNING_REQUIREMENTS_UNAVAILABLE",
    );
    demand(
      new Set(input.replaceRequestIds).size ===
        input.replaceRequestIds.length &&
        input.replaceRequestIds.every((id) =>
          review.rows.some((r) => r.existingRequestIds.includes(id)),
        ),
      422,
      "교체할 이전 미완료 요청을 확인해 주세요.",
    );
    input.dueOn ??= defaultPlanningDueOn(at);
    const ids: string[] = [];
    for (const row of review.rows) {
      const id = randomUUID();
      ids.push(id);
      const learner = userView(find(s.users, row.learnerId), organizations);
      s.planningRequests.push({
        qualificationType: "auditee",
        id,
        lv1OrganizationId: scope!,
        learnerId: row.learnerId,
        requestedBy: u.id,
        organizationId: row.organizationId,
        organizationPath: row.organizationPath,
        selections: row.requirements.map((q) => ({
          entityId: q.entityId,
          qualificationId: q.qualificationId,
          title: q.title,
          version: q.version,
          ...(lastRevoked(s, learner.id, q.entityId, at)
            ? {
                previousCertificationId: lastRevoked(
                  s,
                  learner.id,
                  q.entityId,
                  at,
                )!.id,
              }
            : {}),
        })),
        mode: "organization_required",
        requirementSnapshot: {
          stateRevision: s.revision,
          organizationRevision: organizations.revision,
          sources: row.requirements.map((q) => ({
            entityId: q.entityId,
            organizations: q.sourceOrganizations,
          })),
        },
        source: "requested",
        dueOn: input.dueOn,
        message: input.message,
        createdAt: at,
        revision: 1,
      });
      for (const oldId of input.replaceRequestIds.filter((old) =>
        row.existingRequestIds.includes(old),
      )) {
        const old = s.planningRequests.find((r) => r.id === oldId)!;
        closePlanningRequest(
          s,
          u,
          scope!,
          oldId,
          { revision: old.revision, reason: "새 조직 필요자격 요청으로 교체" },
          at,
          id,
        );
      }
      notify(
        s,
        {
          key: `planning:${id}`,
          recipientId: row.learnerId,
          lv1OrganizationId: scope!,
          type: "planning",
          qualificationType: "auditee",
          title: "조직 필요자격의 개인 인증 계획을 수립해 주세요",
          body: `필요자격 ${row.requirements.length}개 · 계획 작성 기한 ${input.dueOn} · ${input.message}`.slice(
            0,
            2000,
          ),
          href: `/plans?request=${id}`,
        },
        at,
      );
      audit(id, "조직 필요자격 계획 요청", undefined, {
        learnerId: row.learnerId,
        qualificationType: "auditee",
        requirements: row.requirements.map((q) => ({
          entityId: q.entityId,
          sources: q.sourceOrganizations,
        })),
        replacedRequestIds: input.replaceRequestIds.filter((old) =>
          row.existingRequestIds.includes(old),
        ),
      });
    }
    return { ids };
  }
  if (action === "planning.select" || action === "planning.complete") {
    const r = find(s.planningRequests, target);
    expected(r, body.revision);
    demand(
      !r.completion && !r.closed,
      409,
      "완료되거나 종료된 계획 요청입니다.",
    );
    demand(
      r.organizationId === u.organizationId && u.organizationActive,
      409,
      "현재 소속의 사용 중인 요청을 확인해 주세요.",
    );
    const view = planningView(s, organizations, u, r, at);
    if (action === "planning.select") {
      demand(
        r.mode === "learner_choice",
        409,
        "이전 요청은 당시 대상 범위를 유지합니다. 새 요청을 받아 주세요.",
      );
      const input = z
        .object({
          revision: z.number(),
          entityIds: z.array(z.string()).max(1000),
        })
        .strict()
        .parse(body);
      demand(
        new Set(input.entityIds).size === input.entityIds.length,
        422,
        "선택한 자격이 중복되었습니다.",
      );
      const ids = input.entityIds;
      for (const c of view.candidates.filter(
        (c) => c.selected && !ids.includes(c.entityId),
      ))
        demand(
          !s.plans.some(
            (p) =>
              !p.deletedAt &&
              p.learnerId === u.id &&
              s.qualifications.find((q) => q.id === p.qualificationId)
                ?.entityId === c.entityId &&
              p.previousCertificationId ===
                r.selections.find((t) => t.entityId === c.entityId)
                  ?.previousCertificationId,
          ),
          409,
          "작성 중인 계획은 삭제 후 선택을 해제해 주세요. 확정한 계획은 해제할 수 없습니다.",
        );
      const before = structuredClone(r.selections);
      r.selections = ids.map((id) => {
        const existing = r.selections.find((t) => t.entityId === id);
        if (existing) return existing;
        const c = view.candidates.find((c) => c.entityId === id);
        demand(
          c && ["available", "draft"].includes(c.status),
          422,
          "현재 팀의 계획 가능한 자격을 선택해 주세요.",
        );
        return {
          entityId: c.entityId,
          qualificationId: c.qualificationId,
          title: c.title,
          version: c.version,
          ...(c.previousCertificationId
            ? { previousCertificationId: c.previousCertificationId }
            : {}),
        };
      });
      audit(r.id, "계획 자격 선택", undefined, { before, after: r.selections });
    } else {
      demand(
        view.canComplete,
        409,
        view.errors.join(" · "),
        "PLANNING_INCOMPLETE",
      );
      demand(
        !view.noAdditional || body.confirmNoAdditional === true,
        422,
        "추가 계획 대상이 없음을 확인해 주세요.",
      );
      const rows = view.candidates.filter(
        (c) => c.selected || view.noAdditional,
      );
      r.completion = {
        date: at,
        reason: view.noAdditional ? "no_additional" : "planned",
        evidence: rows.map((c) => ({
          entityId: c.entityId,
          ...(c.status === "valid"
            ? {
                certificationId: c.certificationId,
                assignmentId: s.certifications.find(
                  (cert) => cert.id === c.certificationId,
                )!.assignmentId,
              }
            : c.planId
              ? { planId: c.planId }
              : { assignmentId: c.assignmentId }),
        })),
      };
      audit(r.id, "계획 수립 전체 완료", undefined, {
        completion: r.completion,
      });
    }
    r.revision++;
    return { id: r.id, revision: r.revision };
  }
  if (action === "plan.create") {
    const input = PlanStartInputSchema.parse(body);
    const request = find(s.planningRequests, input.requestId),
      q = find(s.qualifications, input.qualificationId);
    expected(request, input.requestRevision);
    demand(
      u.organizationActive &&
        q.lv1OrganizationId === u.lv1OrganizationId &&
        !q.deletedAt,
      422,
      "소속 조직의 계획 가능한 자격을 선택해 주세요.",
    );
    const policyErrors = planRequestErrors(
      s,
      organizations,
      u,
      {
        qualificationId: q.id,
        requestId: request.id,
        organizationId: u.organizationId,
      },
      at,
      true,
    );
    demand(
      !policyErrors.length,
      409,
      policyErrors.join(" · "),
      "POLICY_CHANGED",
    );
    const row = candidate(s, organizations, u, q.entityId, at, request);
    demand(row.canStart, 409, row?.reason || "선택한 자격을 확인해 주세요.");
    requireQualificationProcess(q);
    const errors = qualificationUseErrors(
      currentQualification(s, q),
      s.courses,
    );
    demand(!errors.length, 422, errors.join("\n"));
    const previous = lastRevoked(s, u.id, q.entityId, at);
    // A draft is reusable only for the current organization, version and acquisition cycle.
    const existing = s.plans.find(
      (p) =>
        p.id === row.planId &&
        p.status === "draft" &&
        p.qualificationId === q.id &&
        p.organizationId === u.organizationId &&
        p.previousCertificationId === previous?.id,
    );
    if (!row.selected) {
      const before = structuredClone(request.selections);
      request.selections.push({
        entityId: q.entityId,
        qualificationId: q.id,
        title: row.title,
        version: numberedQualificationVersion(q),
        ...(previous ? { previousCertificationId: previous.id } : {}),
      });
      request.revision++;
      audit(
        request.id,
        "계획 시작으로 요청에 자격 포함",
        undefined,
        { before, after: request.selections },
        "planning.select",
      );
    }
    if (existing) return { id: existing.id };
    demand(
      !s.assignments.some(
        (a) =>
          a.learnerId === u.id &&
          openAssignment(s, a, at) &&
          find(s.qualifications, a.qualificationId).entityId === q.entityId,
      ),
      409,
      "이미 진행하거나 취득한 자격입니다. 기존 기록을 확인해 주세요.",
    );
    const p = PersonalPlanSchema.parse({
      id: randomUUID(),
      lv1OrganizationId: u.lv1OrganizationId,
      learnerId: u.id,
      requestId: request.id,
      qualificationId: q.id,
      workflowVersion: WORKFLOW_VERSION,
      ...(previous ? { previousCertificationId: previous.id } : {}),
      organizationId: u.organizationId,
      status: "draft",
      revision: 1,
      createdAt: at,
      updatedAt: at,
      scheduleDefaultsAppliedAt: at,
      ...defaultPlanSchedule(at),
      goal: "",
    });
    p.acquisitionCycleId = p.id;
    s.plans.push(p);
    audit(p.id, "개인 계획 시작");
    return { id: p.id };
  }
  if (action.startsWith("plan.")) {
    const p = find(s.plans, target),
      q = find(s.qualifications, p.qualificationId);
    requireQualificationProcess(q);
    demand(
      !p.deletedAt,
      410,
      "삭제된 계획입니다. 내 계획에서 다시 작성해 주세요.",
      "PLAN_DELETED",
    );
    demand(
      !s.planningRequests.find((r) => r.id === p.requestId)?.closed,
      409,
      "종료된 요청의 계획은 읽기 전용입니다.",
      "PLANNING_CLOSED",
    );
    expected(p, body.revision);
    const before = structuredClone(p);
    if (action === "plan.review-criteria") {
      demand(
        p.status === "draft",
        409,
        "확정 계획은 기준을 변경할 수 없습니다.",
      );
      const latest = latestQualification(s, p.lv1OrganizationId, q.entityId);
      demand(
        latest &&
          body.qualificationId === latest.id &&
          body.criteriaToken === criteriaFingerprint(s, latest),
        409,
        "다시 변경된 기준을 확인해 주세요.",
        "CRITERIA_CHANGED",
      );
      const errors = planPolicyErrors(
        s,
        organizations,
        u,
        { ...p, qualificationId: latest.id },
        at,
      );
      demand(!errors.length, 409, errors.join(" · "), "POLICY_CHANGED");
      p.qualificationId = latest.id;
      p.qualificationMetadata = metadata(latest);
      delete p.qualificationPolicySnapshot;
    } else if (
      action === "plan.delete" ||
      action === "plan.schedule-defaults"
    ) {
      demand(
        p.status === "draft" &&
          !p.assignmentId &&
          !s.assignments.some((a) => a.planId === p.id),
        409,
        "확정되었거나 배정된 계획은 삭제하거나 기본 일정을 적용할 수 없습니다.",
      );
      if (action === "plan.delete") {
        // Resolve the shared draft before deleting it; older, superseded drafts must
        // not remove the selection attached to the current draft.
        for (const r of s.planningRequests.filter(
          (r) =>
            !r.completion &&
            !r.closed &&
            r.mode !== "organization_required" &&
            r.learnerId === u.id &&
            r.organizationId === p.organizationId &&
            r.selections.some(
              (t) =>
                t.entityId === q.entityId &&
                t.previousCertificationId === p.previousCertificationId,
            ) &&
            candidate(
              s,
              organizations,
              { ...u, organizationId: p.organizationId! },
              q.entityId,
              at,
              r,
            ).planId === p.id,
        )) {
          const before = structuredClone(r.selections);
          r.selections = r.selections.filter((t) => t.entityId !== q.entityId);
          r.revision++;
          audit(
            r.id,
            "미확정 계획 삭제로 요청에서 자격 제외",
            undefined,
            { planId: p.id, before, after: r.selections },
            "planning.select",
          );
        }
        p.deletedAt = at;
        p.deletedBy = u.id;
      } else {
        if (p.scheduleDefaultsAppliedAt)
          return { id: p.id, revision: p.revision };
        const defaults = defaultPlanSchedule(at, p.startOn);
        p.startOn ||= defaults.startOn;
        p.endOn ||= defaults.endOn;
        p.scheduleDefaultsAppliedAt = at;
      }
    } else if (action === "plan.save") {
      const value = PersonalPlanSchema.pick({
        startOn: true,
        endOn: true,
        goal: true,
      })
        .extend({
          revision: z.number().int().positive(),
          reason: z.string().max(2000).optional(),
        })
        .strict()
        .parse(body);
      if (p.status === "completed") {
        demand(
          z.string().trim().min(1).max(2000).safeParse(body.reason).success,
          422,
          "계획 변경 사유를 입력해 주세요.",
        );
        const errors = planErrors(value, q.qualificationType);
        demand(!errors.length, 422, errors.join("\n"));
        demand(
          !find(s.assignments, p.assignmentId!).excludedReason,
          409,
          "제외된 계획입니다.",
        );
      }
      Object.assign(p, {
        startOn: value.startOn,
        endOn: value.endOn,
        goal: value.goal,
      });
    } else if (action === "plan.complete") {
      demand(p.status === "draft", 409, "이미 완료한 계획입니다.");
      demand(
        body.criteriaToken === criteriaFingerprint(s, q),
        409,
        "최종 확인 기준이 변경되었습니다. 다시 검토해 주세요.",
        "CRITERIA_CHANGED",
      );
      demand(
        u.organizationActive,
        422,
        "사용 중인 조직에서 계획을 완료할 수 있습니다.",
      );
      const policyErrors = planPolicyErrors(s, organizations, u, p, at);
      demand(
        !policyErrors.length,
        409,
        policyErrors.join(" · "),
        "POLICY_CHANGED",
      );
      const errors = [
        ...planErrors(p, q.qualificationType),
        ...qualificationUseErrors(currentQualification(s, q), s.courses),
      ];
      demand(
        !q.deletedAt && !errors.length,
        422,
        errors.join("\n") || "자격의 미완성 기준을 보완해 주세요.",
      );
      demand(
        !s.assignments.some(
          (a) =>
            a.learnerId === u.id &&
            openAssignment(s, a, at) &&
            find(s.qualifications, a.qualificationId).entityId === q.entityId,
        ),
        409,
        "이미 배정된 자격입니다.",
      );
      const request = find(s.planningRequests, p.requestId);
      const assignmentId = randomUUID();
      s.assignments.push({
        id: assignmentId,
        acquisitionCycleId: p.acquisitionCycleId || p.id,
        ...(p.previousCertificationId
          ? { previousCertificationId: p.previousCertificationId }
          : {}),
        qualificationId: q.id,
        qualificationMetadata: metadata(currentQualification(s, q)),
        qualificationPolicySnapshot: qualificationPolicySnapshot(q),
        frozenCriteria: freezeCriteria(s, q, u.id, "plan", at),
        learnerId: u.id,
        ownerAdminId: request.requestedBy,
        createdBy: u.id,
        planId: p.id,
        lv1OrganizationId: u.lv1OrganizationId,
        organizationPath: u.organizationPath,
        organizationSource: "assigned",
        assignedAt: at,
        revision: 1,
      });
      q.courseIds.forEach((courseId) =>
        s.enrollments.push({ id: randomUUID(), assignmentId, courseId }),
      );
      Object.assign(p, {
        status: "completed",
        frozenCriteria: freezeCriteria(s, q, u.id, "plan", at),
        qualificationMetadata: metadata(currentQualification(s, q)),
        qualificationPolicySnapshot: qualificationPolicySnapshot(q),
        completedAt: at,
        assignmentId,
        approval: "skipped_by_policy",
      });
    } else demand(false, 404, "지원하지 않는 계획 작업입니다.");
    p.revision++;
    p.updatedAt = at;
    audit(
      p.id,
      action === "plan.complete"
        ? "현 운영정책에 따라 결재를 생략하고 계획 완료"
        : action === "plan.delete"
          ? "학습자 미확정 계획 삭제"
          : action === "plan.schedule-defaults"
            ? "빈 일정 최초 기본값 적용"
            : body.reason || "계획 저장",
      p.assignmentId,
      { before, after: p },
    );
    return { id: p.id, revision: p.revision, assignmentId: p.assignmentId };
  }
  demand(false, 404, "지원하지 않는 절차입니다.");
}
