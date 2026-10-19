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
  kstDate,
  defaultPlanSchedule,
  type State,
  type UserView,
  type OrganizationDocument,
} from "@eks/contracts";
import { demand } from "./errors.ts";
import { userView, organization } from "./organizations.ts";
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
) {
  const at = new Date().toISOString();
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
          status: "draft",
          courseIds: [],
        }),
      );
      imported.push(id);
      audit(id, "기본 자격 초안 가져오기", undefined, { templateId });
    }
    return { imported, existing };
  }
  if (action === "planning.request") {
    const input = z
      .object({
        learnerIds: z.array(z.string()).min(1).max(200),
        dueOn: z.iso.date(),
        message: z.string().max(2000),
        ftId: z.string().nullable().default(null),
      })
      .parse(body);
    demand(
      new Set(input.learnerIds).size === input.learnerIds.length,
      422,
      "대상자가 중복되었습니다.",
    );
    demand(
      s.qualifications.some(
        (q) =>
          q.lv1OrganizationId === scope &&
          q.status === "published" &&
          !qualificationUseErrors(q, s.courses).length,
      ),
      422,
      "계획할 수 있는 자격을 먼저 사용 등록해 주세요.",
    );
    if (input.ftId) {
      const ft = userView(find(s.users, input.ftId), organizations);
      demand(
        ft.roles.includes("ft") &&
          ft.lv1OrganizationId === scope &&
          ft.organizationActive &&
          !input.learnerIds.includes(ft.id),
        422,
        "같은 Lv1의 본인이 아닌 FT를 지정해 주세요.",
      );
    }
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
      const id = randomUUID();
      ids.push(id);
      s.planningRequests.push({
        id,
        lv1OrganizationId: scope,
        learnerId,
        requestedBy: u.id,
        ftId: input.ftId,
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
        q.status === "published",
      422,
      "소속 조직의 계획 가능한 자격을 선택해 주세요.",
    );
    const errors = qualificationUseErrors(q, s.courses);
    demand(!errors.length, 422, errors.join("\n"));
    const existing = s.plans.find(
      (p) =>
        !p.deletedAt &&
        p.learnerId === u.id &&
        find(s.qualifications, p.qualificationId).entityId === q.entityId &&
        (!p.assignmentId ||
          !find(s.assignments, p.assignmentId).excludedReason),
    );
    if (existing) return { id: existing.id };
    demand(
      !s.assignments.some(
        (a) =>
          a.learnerId === u.id &&
          !a.excludedReason &&
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
        "계획의 필수 과정은 변경할 수 없습니다.",
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
      const errors = [
        ...planErrors(p),
        ...qualificationUseErrors(q, s.courses),
      ];
      demand(
        q.status === "published" && !errors.length,
        422,
        errors.join("\n") || "자격을 먼저 사용 등록해 주세요.",
      );
      demand(
        !s.assignments.some(
          (a) =>
            a.learnerId === u.id &&
            !a.excludedReason &&
            find(s.qualifications, a.qualificationId).entityId === q.entityId,
        ),
        409,
        "이미 배정된 자격입니다.",
      );
      const request = find(s.planningRequests, p.requestId);
      const ft = s.users.find((x) => x.id === request.ftId);
      const needsFT = q.courseIds.some((id) =>
        find(s.courses, id).assessmentKinds.some(
          (kind) => kind !== "objective",
        ),
      );
      const ftView = ft && userView(ft, organizations);
      const ftId =
        needsFT &&
        ftView &&
        ftView.id !== u.id &&
        ftView.roles.includes("ft") &&
        ftView.organizationActive &&
        ftView.lv1OrganizationId === p.lv1OrganizationId
          ? ftView.id
          : null;
      const assignmentId = randomUUID();
      s.assignments.push({
        id: assignmentId,
        qualificationId: q.id,
        learnerId: u.id,
        ftId,
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
  if (action === "learning.save") {
    const e = find(s.enrollments, target),
      a = find(s.assignments, e.assignmentId),
      c = find(s.courses, e.courseId);
    demand(
      a.planId && !a.excludedReason,
      409,
      "학습 기록을 작성할 수 없는 배정입니다.",
    );
    find(c.learningItems, body.itemId);
    const old = s.learningRecords.find(
      (r) => r.enrollmentId === e.id && r.itemId === body.itemId,
    );
    if (old) expected(old, body.revision);
    else
      demand(
        body.revision === undefined || body.revision === 0,
        409,
        "기록이 변경되었습니다. 다시 불러와 주세요.",
      );
    const record = LearningRecordSchema.parse({
      ...body,
      id: old?.id || randomUUID(),
      learnerId: u.id,
      enrollmentId: e.id,
      revision: (old?.revision || 0) + 1,
      createdAt: old?.createdAt || at,
      updatedAt: at,
    });
    demand(
      record.performedOn <= kstDate(at),
      422,
      "학습 실시일은 오늘 이후일 수 없습니다.",
    );
    if (old) {
      demand(
        z.string().trim().min(1).max(2000).safeParse(body.reason).success,
        422,
        "학습 기록 수정 사유를 입력해 주세요.",
      );
      audit(record.id, body.reason, a.id, { before: old, after: record });
      Object.assign(old, record);
    } else {
      s.learningRecords.push(record);
      audit(record.id, "학습자 완료 기록", a.id);
    }
    return { id: record.id, revision: record.revision };
  }
  demand(false, 404, "지원하지 않는 절차입니다.");
}
