import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  subjectiveIssues,
  type State,
  type UserView,
  type SubjectiveResponse,
  type SubjectiveResponseView,
} from "@eks/contracts";
import { canRead } from "./domain.ts";
import { demand } from "./errors.ts";

function context(s: State, enrollmentId: string) {
  const e = s.enrollments.find((e) => e.id === enrollmentId);
  const a = s.assignments.find((a) => a.id === e?.assignmentId);
  const c = s.courses.find((c) => c.id === e?.courseId);
  demand(e && a && c, 404, "수강 기록을 찾을 수 없습니다.");
  return { e, a, c };
}
export function subjectiveOwner(s: State, u: UserView, enrollmentId: string) {
  const ctx = context(s, enrollmentId);
  demand(
    ctx.a.learnerId === u.id &&
      ctx.a.lv1OrganizationId === u.lv1OrganizationId &&
      u.roles.includes("learner"),
    403,
    "본인의 주관식 답변만 작성할 수 있습니다.",
  );
  return ctx;
}
export function subjectiveView(
  s: State,
  u: UserView,
  enrollmentId: string,
): SubjectiveResponseView | undefined {
  const { a, c } = context(s, enrollmentId);
  demand(canRead(a, u), 403, "접근 권한이 없습니다.");
  const response = s.subjectiveResponses.find(
    (r) => r.enrollmentId === enrollmentId,
  );
  if (c.qualificationType !== "auditee" || (!c.subjectiveEnabled && !response))
    return;
  const own = a.learnerId === u.id;
  if (!own && response?.status !== "submitted") return;
  const completed = s.completions.some(
    (co) => co.enrollmentId === enrollmentId,
  );
  const reason =
    response?.status === "submitted"
      ? "제출한 답변은 수정할 수 없습니다."
      : completed
        ? "인증Set 수료로 주관식 작성이 종료되었습니다."
        : !own
          ? "본인의 답변만 작성할 수 있습니다."
          : !u.roles.includes("learner") || !u.organizationActive
            ? "현재 학습 권한 또는 소속 조직을 확인해 주세요."
            : u.certificationEligibility === "hold"
              ? "취득 대상자 Hold 상태에서는 작성할 수 없습니다."
              : a.excludedReason || a.acquisitionClosedAt
                ? "제외되거나 종료된 취득 회차입니다."
                : !c.subjectiveEnabled
                  ? "주관식 평가가 설정되지 않았습니다."
                  : subjectiveIssues(c).join(" ");
  return {
    response: response ? structuredClone(response) : null,
    canWrite: !reason,
    reason,
    status:
      response?.status === "submitted"
        ? "submitted"
        : completed
          ? "closed"
          : response
            ? "draft"
            : "unstarted",
  };
}
export function readSubjective(s: State, u: UserView, id: string) {
  const r = s.subjectiveResponses.find((r) => r.id === id);
  demand(r, 404, "답변을 찾을 수 없습니다.");
  const view = subjectiveView(s, u, r.enrollmentId);
  demand(view?.response, 403, "제출된 답변만 조회할 수 있습니다.");
  return view;
}
export function authorizeSubjective(
  s: State,
  u: UserView,
  action: string,
  target: string,
) {
  const id =
    action === "subjective.start"
      ? target
      : s.subjectiveResponses.find((r) => r.id === target)?.enrollmentId;
  demand(id, 404, "답변을 찾을 수 없습니다.");
  subjectiveOwner(s, u, id);
}
export function executeSubjective(
  s: State,
  u: UserView,
  action: string,
  target: string,
  body: unknown,
  at: string,
) {
  authorizeSubjective(s, u, action, target);
  let response = s.subjectiveResponses.find((r) =>
    action === "subjective.start" ? r.enrollmentId === target : r.id === target,
  );
  const enrollmentId =
    action === "subjective.start" ? target : response!.enrollmentId;
  const { a, c } = context(s, enrollmentId);
  demand(
    c.qualificationType === "auditee",
    409,
    "주관식 평가는 Auditee에서만 사용합니다.",
  );
  const view = subjectiveView(s, u, enrollmentId);
  if (action === "subjective.start") {
    z.object({}).strict().parse(body);
    if (response) return { id: response.id, revision: response.revision };
  }
  demand(
    view?.canWrite,
    409,
    view?.reason || "주관식 평가를 시작할 수 없습니다.",
    "SUBJECTIVE_WRITE_CLOSED",
  );
  if (action === "subjective.start") {
    response = {
      id: randomUUID(),
      enrollmentId,
      courseId: c.id,
      learnerId: u.id,
      revision: 1,
      status: "draft",
      questions: structuredClone(c.subjectiveQuestions),
      answers: {},
      createdAt: at,
      updatedAt: at,
    };
    s.subjectiveResponses.push(response);
  } else {
    const input = (
      action === "subjective.save"
        ? z
            .object({
              revision: z.number().int().positive(),
              answers: z.record(
                z.string().min(1).max(160),
                z.string().max(20000),
              ),
            })
            .strict()
        : z.object({ revision: z.number().int().positive() }).strict()
    ).parse(body);
    demand(
      response!.revision === input.revision,
      409,
      "다른 창에서 답변이 변경되었습니다. 입력을 보존하고 다시 확인해 주세요.",
      "REVISION_CONFLICT",
    );
    if ("answers" in input) {
      const answers = input.answers as Record<string, string>;
      demand(
        Object.keys(answers).every((id) =>
          response!.questions.some((q) => q.id === id),
        ),
        422,
        "알 수 없는 주관식 문항입니다.",
      );
      response!.answers = answers;
    } else {
      const missing = response!.questions.filter(
        (q) => !response!.answers[q.id]?.trim(),
      );
      demand(
        !missing.length,
        422,
        "모든 문항에 답변한 뒤 제출해 주세요.",
        "SUBJECTIVE_ANSWERS_REQUIRED",
      );
      response!.status = "submitted";
      response!.submittedAt = at;
    }
    response!.revision++;
    response!.updatedAt = at;
  }
  if (action !== "subjective.save")
    s.audits.push({
      id: randomUUID(),
      actorId: u.id,
      date: at,
      action,
      targetId: response!.id,
      lv1OrganizationId: a.lv1OrganizationId,
      assignmentId: a.id,
      reason:
        action === "subjective.start"
          ? "주관식 답변 작성 시작"
          : "주관식 답변 제출·수료 판정 제외",
      details: { questionCount: response!.questions.length },
    });
  return { id: response!.id, revision: response!.revision };
}
export function validateSubjective(s: State) {
  const seen = new Set<string>();
  for (const r of s.subjectiveResponses) {
    const { a, c } = context(s, r.enrollmentId);
    demand(
      !seen.has(r.enrollmentId),
      422,
      "수강별 주관식 답변이 중복되었습니다.",
    );
    seen.add(r.enrollmentId);
    demand(
      c.id === r.courseId &&
        a.learnerId === r.learnerId &&
        c.qualificationType === "auditee",
      422,
      "주관식 답변의 참조가 맞지 않습니다.",
    );
    demand(
      new Set(r.questions.map((q) => q.id)).size === r.questions.length &&
        r.questions.every((q) => q.prompt.trim()),
      422,
      "주관식 문항 스냅샷을 확인해 주세요.",
    );
    demand(
      Object.keys(r.answers).every((id) =>
        r.questions.some((q) => q.id === id),
      ),
      422,
      "주관식 답변 문항 참조를 확인해 주세요.",
    );
    demand(
      r.status === "submitted"
        ? !!r.submittedAt && r.questions.every((q) => r.answers[q.id]?.trim())
        : !r.submittedAt,
      422,
      "주관식 제출 상태를 확인해 주세요.",
    );
  }
}
