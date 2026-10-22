import {
  requiredQualifications,
  planPolicyErrors,
  planningReadiness,
} from "./organization-policies.ts";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  PersonalPlanSchema,
  LearningRecordSchema,
  QualificationSchema,
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
import { demand } from "./errors.ts";
import { userView, organization } from "./organizations.ts";
import {
  requireEligible,
  openAssignment,
  lastRevoked,
} from "./qualification-lifecycle.ts";
import { notify } from "./notifications.ts";

export const qualificationTemplates: {
  id: string;
  title: string;
  englishName: string;
}[] = JSON.parse(
  readFileSync(
    new URL("./qualification-templates.json", import.meta.url),
    "utf8",
  ),
);
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
  demand(u.roles.includes("learner"), 403, "학습자 권한이 필요합니다.");
  let record: { learnerId: string; lv1OrganizationId: string };
  if (action === "plan.create")
    record = find(s.planningRequests, body.requestId);
  else if (action.startsWith("plan.")) record = find(s.plans, target);
  else record = find(s.assignments, find(s.enrollments, target).assignmentId);
  demand(
    record.learnerId === u.id &&
      record.lv1OrganizationId === u.lv1OrganizationId,
    403,
    "본인의 계획·학습만 처리할 수 있습니다.",
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
  if (["plan.create", "plan.complete"].includes(action)) requireEligible(u);
  const audit = (
    id: string,
    reason = "",
    assignmentId?: string,
    details: Record<string, any> = {},
  ) =>
    s.audits.push({
      id: randomUUID(),
      actorId: u.id,
      lv1OrganizationId: scope,
      date: at,
      action,
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
    const ids = z.array(z.string()).min(1).max(15).parse(body.templateIds);
    demand(new Set(ids).size === ids.length, 422, "자격이 중복되었습니다.");
    const imported: string[] = [],
      existing: string[] = [];
    for (const templateId of ids) {
      const template = find(qualificationTemplates, templateId);
      const previous = s.qualifications.find(
        (q) => q.lv1OrganizationId === scope && q.templateId === templateId,
      );
      if (previous) {
        existing.push(previous.id);
        continue;
      }
      const id = randomUUID();
      s.qualifications.push(
        QualificationSchema.parse({
          id,
          entityId: id,
          version: 1,
          revision: 1,
          lv1OrganizationId: scope,
          title: template.title,
          englishName: template.englishName,
          templateId,
          lifecycleStatus: "Active",
          renewalLeadMonths: 3,
          courseIds: [],
        }),
      );
      imported.push(id);
      audit(id, "기본 자격 가져오기", undefined, { templateId });
    }
    return { imported, existing };
  }
  if (action === "planning.request") {
    const input = z
      .object({
        learnerIds: z.array(z.string()).min(1).max(200),
        dueOn: z.iso.date().optional(),
        message: z.string().max(2000),
      })
      .parse(body);
    demand(
      new Set(input.learnerIds).size === input.learnerIds.length,
      422,
      "대상자가 중복되었습니다.",
    );
    input.dueOn ??= defaultPlanningDueOn(at);
    const ids: string[] = [];
    for (const learnerId of input.learnerIds) {
      const learner = userView(find(s.users, learnerId), organizations);
      demand(
        learner.roles.includes("learner") &&
          learner.lv1OrganizationId === scope &&
          learner.organizationActive,
        422,
        "같은 Lv1의 사용 중인 학습자를 선택해 주세요.",
      );
      requireEligible(learner);
      const readiness = planningReadiness(s, organizations, learner, at);
      demand(readiness.canRequest, 422, `${learner.name}: ${readiness.reason}`);
      const targets = requiredQualifications(s, organizations, learner, at)
        .items.filter((i) => ["ready", "waiting"].includes(i.status))
        .map((i) => ({
          entityId: i.entityId,
          qualificationId: i.qualificationId,
          title: i.title,
          version: i.version,
          ...(i.previousCertificationId
            ? { previousCertificationId: i.previousCertificationId }
            : {}),
        }));
      const id = randomUUID();
      ids.push(id);
      s.planningRequests.push({
        id,
        lv1OrganizationId: scope,
        learnerId,
        requestedBy: u.id,
        organizationId: learner.organizationId,
        organizationPath: learner.organizationPath,
        targets,
        source: "requested",
        dueOn: input.dueOn,
        message: input.message,
        createdAt: at,
        revision: 1,
      });
      notify(
        s,
        {
          key: `planning:${id}`,
          recipientId: learnerId,
          lv1OrganizationId: scope,
          type: "planning",
          title: "개인 인증 계획을 수립해 주세요",
          body: `계획 작성 기한 ${input.dueOn} · ${input.message}`.slice(
            0,
            2000,
          ),
          href: `/plans?request=${id}`,
        },
        at,
      );
      audit(id, "계획 수립 요청", undefined, { learnerId });
    }
    return { ids };
  }
  if (action === "plan.create") {
    const input = z
      .object({ requestId: z.string(), qualificationId: z.string() })
      .parse(body);
    const request = find(s.planningRequests, input.requestId),
      q = find(s.qualifications, input.qualificationId);
    demand(
      u.organizationActive &&
        q.lv1OrganizationId === u.lv1OrganizationId &&
        !q.deletedAt,
      422,
      "소속 조직의 계획 가능한 자격을 선택해 주세요.",
    );
    const policyErrors = planPolicyErrors(
      s,
      organizations,
      u,
      {
        qualificationId: q.id,
        requestId: request.id,
        organizationId: u.organizationId,
      },
      at,
    );
    demand(
      !policyErrors.length,
      409,
      policyErrors.join(" · "),
      "POLICY_CHANGED",
    );
    const row = requiredQualifications(s, organizations, u, at).items.find(
      (i) => i.entityId === q.entityId,
    );
    demand(
      row && !["fulfilled", "expired", "unknown"].includes(row.status),
      409,
      row?.reason || "필수 자격이 아닙니다.",
    );
    const errors = qualificationUseErrors(q, s.courses);
    demand(!errors.length, 422, errors.join("\n"));
    const previous = lastRevoked(s, u.id, q.entityId, at);
    const existing = s.plans.find(
      (p) =>
        !p.deletedAt &&
        p.learnerId === u.id &&
        p.previousCertificationId === previous?.id &&
        find(s.qualifications, p.qualificationId).entityId === q.entityId &&
        (!p.assignmentId ||
          openAssignment(s, find(s.assignments, p.assignmentId), at)),
    );
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
      policyRevision: organizations.revision,
      status: "draft",
      revision: 1,
      createdAt: at,
      updatedAt: at,
      scheduleDefaultsAppliedAt: at,
      targetOn: "",
      schedules: q.courseIds.map((courseId) => ({
        courseId,
        ...defaultPlanSchedule(at),
        goal: "",
      })),
    });
    p.acquisitionCycleId = p.id;
    s.plans.push(p);
    audit(p.id, "개인 계획 시작");
    return { id: p.id };
  }
  if (action.startsWith("plan.")) {
    const p = find(s.plans, target),
      q = find(s.qualifications, p.qualificationId);
    demand(
      !p.deletedAt,
      410,
      "삭제된 계획입니다. 내 계획에서 다시 작성해 주세요.",
      "PLAN_DELETED",
    );
    expected(p, body.revision);
    const before = structuredClone(p);
    if (action === "plan.delete" || action === "plan.schedule-defaults") {
      demand(
        p.status === "draft" &&
          !p.assignmentId &&
          !s.assignments.some((a) => a.planId === p.id),
        409,
        "확정되었거나 배정된 계획은 삭제하거나 기본 일정을 적용할 수 없습니다.",
      );
      if (action === "plan.delete") {
        p.deletedAt = at;
        p.deletedBy = u.id;
      } else {
        if (p.scheduleDefaultsAppliedAt)
          return { id: p.id, revision: p.revision };
        for (const schedule of p.schedules) {
          const defaults = defaultPlanSchedule(at, schedule.learningStart);
          // Existing values are never changed; initialization happens only once.
          schedule.learningStart ||= defaults.learningStart;
          schedule.learningEnd ||= defaults.learningEnd;
          schedule.assessmentOn ||= defaults.assessmentOn;
        }
        p.scheduleDefaultsAppliedAt = at;
      }
    } else if (action === "plan.save") {
      const value = PersonalPlanSchema.pick({
        targetOn: true,
        schedules: true,
      }).parse(body);
      demand(
        value.schedules.length === q.courseIds.length &&
          new Set(value.schedules.map((x) => x.courseId)).size ===
            q.courseIds.length &&
          value.schedules.every((x) => q.courseIds.includes(x.courseId)),
        422,
        "계획의 필수 인증Set은 변경할 수 없습니다.",
      );
      if (p.status === "completed") {
        demand(
          z.string().trim().min(1).max(2000).safeParse(body.reason).success,
          422,
          "계획 변경 사유를 입력해 주세요.",
        );
        const errors = planErrors(value);
        demand(!errors.length, 422, errors.join("\n"));
        demand(
          !find(s.assignments, p.assignmentId!).excludedReason,
          409,
          "제외된 계획입니다.",
        );
      }
      Object.assign(p, value);
    } else if (action === "plan.complete") {
      demand(p.status === "draft", 409, "이미 완료한 계획입니다.");
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
        ...planErrors(p),
        ...qualificationUseErrors(q, s.courses),
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
