import { z } from "zod";
import {
  workDeactive,
  WORK_DEACTIVE_MESSAGE,
  ScheduleSaveInputSchema,
  defaultPlanSchedule,
  kstDate,
  planningWindow,
  scheduleFieldErrors,
  type State,
  type UserView,
  type OrganizationDocument,
  type PlanningSchedule,
  type ScheduleRow,
} from "@eks/contracts";
import { planningView } from "./planning.ts";
import { canonicalHash, criteriaFingerprint } from "./releases.ts";
import { authorizeWorkflow, executeWorkflow } from "./workflow.ts";
import { demand, DomainError } from "./errors.ts";

export function planningSchedule(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  id: string,
  at: string,
): PlanningSchedule {
  authorizeWorkflow(s, u, "planning.schedule.read", id, {});
  const request = s.planningRequests.find((r) => r.id === id)!;
  const view = planningView(s, doc, u, request, at),
    serverDate = kstDate(at);
  const errors: string[] = [];
  const readOnly = !!(request.closed || request.completion);
  if (
    request.organizationId !== u.organizationId ||
    request.lv1OrganizationId !== u.lv1OrganizationId
  )
    errors.push(
      "계획 요청 이후 소속이 달라졌습니다. 현재 소속의 요청을 확인해 주세요.",
    );
  if (!u.organizationActive) errors.push("사용 중지된 소속입니다.");
  if (u.certificationEligibility === "hold")
    errors.push("취득 대상자 Hold 상태입니다.");
  if (workDeactive(u)) errors.push(WORK_DEACTIVE_MESSAGE);
  if (!view.candidates.length)
    errors.push("현재 계획할 자격이 없어 준비를 기다리고 있습니다.");
  const rows: ScheduleRow[] = view.candidates.map((c) => {
    const plan = s.plans.find((p) => p.id === c.planId && !p.deletedAt);
    const qualification = s.qualifications.find(
      (q) =>
        q.id ===
        (plan?.status === "completed"
          ? plan.qualificationId
          : c.qualificationId),
    );
    const previousQualification =
      plan && s.qualifications.find((q) => q.id === plan.qualificationId);
    const window =
      plan?.status === "completed"
        ? plan.planningWindow
        : qualification && planningWindow(qualification, serverDate);
    const dates = plan || {
      ...(["valid", "planned"].includes(c.status)
        ? { startOn: "", endOn: "" }
        : defaultPlanSchedule(at)),
      goal: "",
    };
    const editable =
      !readOnly && c.canStart && ["available", "draft"].includes(c.status);
    const fieldErrors = editable
      ? scheduleFieldErrors(dates, window?.deadlineOn)
      : {};
    if (c.selected && c.status === "blocked")
      fieldErrors.qualification = c.reason;
    const criteriaChanged =
      !!plan &&
      plan.status === "draft" &&
      plan.qualificationId !== c.qualificationId;
    if (c.selected && criteriaChanged)
      fieldErrors.criteria =
        "최신 자격 기준을 확인해 주세요. 일정과 목표는 유지됩니다.";
    return {
      ...c,
      title:
        plan?.status === "completed"
          ? plan.qualificationMetadata?.title || qualification?.title || c.title
          : c.title,
      qualification,
      previousQualification,
      plan,
      required:
        request.mode !== "learner_choice" ||
        !!request.requirementSnapshot?.sources.some(
          (t) => t.entityId === c.entityId,
        ),
      editable,
      criteriaChanged,
      criteriaToken: qualification?.version
        ? criteriaFingerprint(s, qualification)
        : "",
      window,
      startOn: dates.startOn,
      endOn: dates.endOn,
      goal: dates.goal,
      errors: fieldErrors,
      courseTitles: (qualification?.courseIds || []).map(
        (id) =>
          s.courses.find((c) => c.id === id)?.title || "인증Set 확인 필요",
      ),
    };
  });
  const selected = rows.filter((r) => r.selected);
  if (!selected.length && !view.noAdditional && rows.length)
    errors.push("최소 1개 자격을 추가해 계획을 작성해 주세요.");
  const canComplete =
    !readOnly &&
    !errors.length &&
    (view.noAdditional || selected.length > 0) &&
    selected.every(
      (r) =>
        ["valid", "planned"].includes(r.status) ||
        (r.editable && !!r.plan && !Object.keys(r.errors).length),
    );
  const result: PlanningSchedule = {
    requestId: id,
    requestRevision: request.revision,
    serverDate,
    rows,
    errors,
    noAdditional: view.noAdditional,
    readOnly,
    canComplete,
  };
  if (canComplete)
    result.reviewToken = canonicalHash({
      request,
      serverDate,
      organizationRevision: doc.revision,
      actor: {
        id: u.id,
        revision: u.revision,
        organizationId: u.organizationId,
        roles: u.roles,
        eligibility: u.certificationEligibility,
      },
      rows: rows
        .filter((r) => r.selected || view.noAdditional)
        .map((r) => ({
          entityId: r.entityId,
          status: r.status,
          plan: r.plan,
          criteriaToken: r.criteriaToken,
          certificationId: r.certificationId,
          assignmentId: r.assignmentId,
          window: r.window,
        })),
    });
  return result;
}

export function executePlanningSchedule(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  id: string,
  action: string,
  body: unknown,
  at: string,
): unknown {
  const request = s.planningRequests.find((r) => r.id === id)!;
  const initial = planningSchedule(s, doc, u, id, at);
  demand(
    !initial.readOnly &&
      !initial.errors.some((e) => e.includes("소속") || e.includes("Hold")),
    409,
    initial.errors.join(" · ") || "완료되거나 종료된 요청입니다.",
    "POLICY_CHANGED",
  );
  const run = (action: string, target: string, input: unknown) => {
    authorizeWorkflow(s, u, action, target, input);
    return executeWorkflow(
      s,
      u,
      action,
      target,
      input,
      doc,
      u.lv1OrganizationId,
      at,
    ) as any;
  };
  if (action === "planning.schedule.save") {
    const input = ScheduleSaveInputSchema.parse(body);
    demand(
      input.requestRevision === request.revision,
      409,
      "요청이 변경되었습니다. 입력을 보존한 채 다시 확인해 주세요.",
      "REVISION_CONFLICT",
    );
    demand(
      new Set(input.rows.map((r) => r.entityId)).size === input.rows.length,
      422,
      "자격이 중복되었습니다.",
    );
    const saved: { entityId: string; id: string; revision: number }[] = [];
    for (const value of input.rows) {
      const row = initial.rows.find((r) => r.entityId === value.entityId);
      demand(
        row?.editable,
        409,
        row?.reason || "계획 가능한 본인 자격을 확인해 주세요.",
        "POLICY_CHANGED",
      );
      let plan = row.plan;
      demand(
        (plan?.id || undefined) === value.planId &&
          (!plan || plan.revision === value.revision),
        409,
        "다른 창에서 계획을 변경했습니다. 입력을 보존한 채 다시 확인해 주세요.",
        "REVISION_CONFLICT",
      );
      if (plan && plan.qualificationId !== value.qualificationId) {
        demand(
          value.qualificationId === row.qualificationId &&
            value.reviewedCriteriaToken === row.criteriaToken,
          409,
          "최신 기준을 확인한 후 반영해 주세요.",
          "CRITERIA_CHANGED",
        );
        run("plan.review-criteria", plan.id, {
          revision: plan.revision,
          qualificationId: value.qualificationId,
          criteriaToken: value.reviewedCriteriaToken,
        });
      }
      if (!plan) {
        demand(
          value.qualificationId === row.qualificationId,
          409,
          "자격 기준이 변경되었습니다. 다시 확인해 주세요.",
          "CRITERIA_CHANGED",
        );
        const created = run("plan.create", "", {
          requestId: id,
          requestRevision: request.revision,
          qualificationId: value.qualificationId,
        });
        plan = s.plans.find((p) => p.id === created.id)!;
      } else if (!row.selected) {
        run("plan.create", "", {
          requestId: id,
          requestRevision: request.revision,
          qualificationId: value.qualificationId,
        });
      }
      demand(
        plan.qualificationId === value.qualificationId,
        409,
        "계획의 자격 기준을 확인해 주세요.",
        "CRITERIA_CHANGED",
      );
      if (
        plan.startOn !== value.startOn ||
        plan.endOn !== value.endOn ||
        plan.goal !== value.goal
      )
        run("plan.save", plan.id, {
          revision: plan.revision,
          startOn: value.startOn,
          endOn: value.endOn,
          goal: value.goal,
        });
      saved.push({
        entityId: value.entityId,
        id: plan.id,
        revision: plan.revision,
      });
    }
    return { id, revision: request.revision, rows: saved };
  }
  const input = z
    .object({
      requestRevision: z.number().int().positive(),
      reviewToken: z.string().min(1),
      confirmNoAdditional: z.boolean().optional(),
    })
    .strict()
    .parse(body);
  demand(
    input.requestRevision === request.revision &&
      input.reviewToken === initial.reviewToken,
    409,
    "확인 후 기준·일정·소속 또는 날짜가 변경되었습니다. 입력을 유지하고 전체 계획을 다시 확인해 주세요.",
    "SCHEDULE_REVIEW_CHANGED",
  );
  if (!initial.canComplete)
    throw new DomainError(
      422,
      "전체 계획의 보완 항목을 확인해 주세요.",
      "SCHEDULE_INVALID",
      {
        rows: initial.rows.map((r) => ({
          entityId: r.entityId,
          errors: r.errors,
        })),
        errors: initial.errors,
      },
    );
  demand(
    !initial.noAdditional || input.confirmNoAdditional === true,
    422,
    "추가 계획 대상이 없음을 확인해 주세요.",
  );
  const plans = [];
  for (const row of initial.rows.filter(
    (r) => r.selected && r.plan?.status === "draft",
  )) {
    plans.push(
      run("plan.complete", row.plan!.id, {
        revision: row.plan!.revision,
        criteriaToken: row.criteriaToken,
      }),
    );
  }
  run("planning.complete", id, {
    revision: request.revision,
    confirmNoAdditional: initial.noAdditional,
  });
  return { id, revision: request.revision, plans };
}
