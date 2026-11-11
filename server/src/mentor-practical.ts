import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  CourseContentSchema,
  mentorPracticalErrors,
  MentorGradingSchema,
  requiredKinds,
  type State,
  type UserView,
  type OrganizationDocument,
  type MentorAttempt,
  type MentorPreview,
} from "@eks/contracts";
import { demand } from "./errors.ts";
import { userView } from "./organizations.ts";
import { managementScope } from "./management.ts";
import { canonicalHash } from "./releases.ts";
import { reconcile } from "./domain.ts";
import { notify } from "./notifications.ts";
import { usableCompletion } from "./group-practical-evidence.ts";
const revision = z.number().int().nonnegative();
const attemptId = z.string().min(1).max(160);
export function mentorDataset(s: State) {
  demand(
    s.schemaVersion >= 34,
    409,
    "FT 멘토 실기 기능을 사용하려면 업무34로 이관해 주세요.",
    "MENTOR_MIGRATION_REQUIRED",
  );
}
export function mentorContext(s: State, id: string) {
  const e = s.enrollments.find((e) => e.id === id),
    a = s.assignments.find((a) => a.id === e?.assignmentId),
    c = s.courses.find((c) => c.id === e?.courseId);
  demand(
    e && a && c?.mentorPractical,
    404,
    "실기(주관식) 수강을 찾을 수 없습니다.",
  );
  const assignment = s.mentorAssignments.find((v) => v.enrollmentId === id),
    attempts = s.mentorAttempts.filter((t) => t.enrollmentId === id);
  return { e, a, c, assignment, attempts, current: attempts.at(-1) };
}
export function mentorAccess(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  id: string,
) {
  const ctx = mentorContext(s, id),
    owner = ctx.a.learnerId === u.id;
  const manager =
    u.roles.includes("system_operator") ||
    (u.roles.includes("admin") &&
      u.lv1OrganizationId === ctx.a.lv1OrganizationId);
  const mentor =
    ctx.assignment?.mentorId === u.id &&
    u.roles.includes("ft") &&
    u.lv1OrganizationId === ctx.a.lv1OrganizationId &&
    !owner;
  demand(
    owner || manager || mentor,
    403,
    "본인의 수강 또는 지정된 실기 평가만 조회할 수 있습니다.",
  );
  if (manager) managementScope(u, doc, ctx.a.lv1OrganizationId);
  return { ...ctx, owner, manager, mentor };
}
export function mentorBlockers(
  s: State,
  doc: OrganizationDocument,
  id: string,
) {
  const { a, c, assignment } = mentorContext(s, id),
    q = s.qualifications.find((q) => q.id === a.qualificationId)!,
    learner = s.users.find((u) => u.id === a.learnerId)!,
    mentor = s.users.find((u) => u.id === assignment?.mentorId);
  const v = userView(learner, doc),
    errors = mentorPracticalErrors(c.mentorPractical!);
  if (
    a.excludedReason ||
    a.acquisitionClosedAt ||
    a.auditor ||
    a.renewalBatchId ||
    q.purpose === "renewal" ||
    q.deletedAt ||
    (q.lifecycleStatus && q.lifecycleStatus !== "Active")
  )
    errors.push("현재 취득 절차를 진행할 수 없습니다.");
  if (
    !v.organizationActive ||
    v.lv1OrganizationId !== a.lv1OrganizationId ||
    !v.roles.includes("learner") ||
    v.workStatus === "deactive"
  )
    errors.push("학습자의 소속·역할·업무 상태를 확인해 주세요.");
  if (!mentor) errors.push("담당 FT 멘토를 지정해 주세요.");
  else {
    const m = userView(mentor, doc);
    if (
      m.id === v.id ||
      !m.roles.includes("ft") ||
      m.lv1OrganizationId !== a.lv1OrganizationId ||
      !m.organizationActive ||
      m.workStatus === "deactive"
    )
      errors.push("담당 멘토의 소속·FT 역할·업무 상태를 확인해 주세요.");
  }
  return errors;
}
export function mentorView(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  id: string,
) {
  const ctx = mentorAccess(s, doc, u, id),
    blockers = mentorBlockers(s, doc, id);
  const attempts = structuredClone(ctx.attempts).map((t) => {
    if (!ctx.owner && t.status === "draft") t.answers = {};
    if (!ctx.mentor) {
      t.previousGradings = [];
      if (t.status !== "graded") delete t.grading;
    }
    return t;
  });
  return {
    enrollmentId: id,
    assignmentId: ctx.a.id,
    course: {
      id: ctx.c.id,
      title: ctx.c.title,
      releaseVersion: ctx.c.releaseVersion,
      version: ctx.c.version,
      mentorPractical: ctx.c.mentorPractical,
    },
    learnerName: s.users.find((v) => v.id === ctx.a.learnerId)!.name,
    mentorName: s.users.find((v) => v.id === ctx.assignment?.mentorId)?.name,
    assignment: ctx.assignment,
    attempts,
    owner: ctx.owner,
    manager: ctx.manager,
    mentor: ctx.mentor,
    blockers,
    canWrite:
      ctx.owner &&
      !blockers.length &&
      !s.completions.some((c) => c.enrollmentId === id),
    canGrade: ctx.mentor && !blockers.length,
    completed: s.completions.some((c) => c.enrollmentId === id),
  };
}
function totals(t: MentorAttempt) {
  const total = t.questions.reduce((n, q) => n + q.points, 0),
    earned =
      Math.round(
        t.questions.reduce((n, q) => n + (t.grading?.scores[q.id] || 0), 0) *
          100,
      ) / 100;
  return {
    earned,
    total,
    passScore: t.passScore,
    result:
      earned * 100 >= total * t.passScore
        ? ("passed" as const)
        : ("failed" as const),
  };
}
export function mentorPreview(
  s: State,
  doc: OrganizationDocument,
  id: string,
): MentorPreview {
  const { a, c, current: t, assignment } = mentorContext(s, id);
  demand(t, 409, "제출된 실기 답변이 없습니다.");
  const blockers = mentorBlockers(s, doc, id);
  if (t.status !== "submitted")
    blockers.push("제출된 미확정 답변만 평가할 수 있습니다.");
  if (
    !t.grading ||
    t.grading.savedBy !== assignment?.mentorId ||
    t.questions.some(
      (q) =>
        t.grading!.scores[q.id] === undefined ||
        t.grading!.scores[q.id]! > q.points,
    )
  )
    blockers.push("모든 문항을 배점 범위 안에서 채점해 주세요.");
  const score = totals(t),
    wouldComplete =
      !blockers.length &&
      score.result === "passed" &&
      requiredKinds(c).every((kind) =>
        s.attempts.some(
          (v) =>
            v.enrollmentId === id && v.kind === kind && v.result === "passed",
        ),
      );
  const wouldCertify =
    wouldComplete &&
    s.enrollments
      .filter((e) => e.assignmentId === a.id)
      .every(
        (e) =>
          e.id === id ||
          usableCompletion(
            s,
            s.completions.find((co) => co.enrollmentId === e.id),
          ),
      );
  return {
    token: canonicalHash({
      t,
      assignment,
      a,
      blockers,
      wouldComplete,
      wouldCertify,
      organizationRevision: doc.revision,
      learner: s.users.find((v) => v.id === a.learnerId)?.revision,
      mentor: s.users.find((v) => v.id === assignment?.mentorId)?.revision,
    }),
    blockers,
    ...score,
    wouldComplete,
    wouldCertify,
  };
}
function expected(actual: number, value: number) {
  demand(
    actual === value,
    409,
    "다른 창에서 내용이 변경되었습니다. 입력을 보존하고 다시 확인해 주세요.",
    "REVISION_CONFLICT",
  );
}
export function authorizeMentorAction(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  id: string,
  action: string,
) {
  mentorDataset(s);
  const ctx = mentorAccess(s, doc, u, id);
  demand(
    u.organizationActive && u.workStatus !== "deactive",
    403,
    "활성 소속·업무 상태에서만 실기 작업을 진행할 수 있습니다.",
  );
  if (action === "assign")
    demand(ctx.manager, 403, "관리자만 담당 멘토를 지정할 수 있습니다.");
  else if (["start", "save", "submit"].includes(action))
    demand(
      ctx.owner && u.roles.includes("learner"),
      403,
      "학습자 본인의 수행 답변만 작성할 수 있습니다.",
    );
  else demand(ctx.mentor, 403, "본인이 담당하는 실기만 채점할 수 있습니다.");
}
export function executeMentor(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  id: string,
  action: string,
  body: unknown,
  at: string,
) {
  authorizeMentorAction(s, doc, u, id, action);
  const ctx = mentorContext(s, id);
  let t = ctx.current;
  if (action === "assign") {
    const input = z
      .object({
        mentorId: z.string().min(1),
        revision,
        reason: z.string().trim().max(2000),
      })
      .strict()
      .parse(body);
    expected(ctx.assignment?.revision || 0, input.revision);
    demand(
      !ctx.attempts.some((t) => t.result === "passed"),
      409,
      "이미 실기를 통과한 수강의 멘토는 변경할 수 없습니다.",
    );
    const mentor = s.users.find((v) => v.id === input.mentorId);
    demand(mentor, 422, "멘토를 확인해 주세요.");
    const v = userView(mentor, doc);
    demand(
      v.id !== ctx.a.learnerId &&
        v.roles.includes("ft") &&
        v.lv1OrganizationId === ctx.a.lv1OrganizationId &&
        v.organizationActive &&
        v.workStatus !== "deactive",
      422,
      "같은 팀의 활성 FT 멘토를 선택해 주세요. 본인 채점은 불가합니다.",
    );
    demand(
      !ctx.assignment || input.reason,
      422,
      "멘토 변경 사유를 입력해 주세요.",
    );
    if (ctx.assignment) {
      ctx.assignment.history.push({
        mentorId: ctx.assignment.mentorId,
        changedBy: u.id,
        changedAt: at,
        reason: input.reason,
      });
      ctx.assignment.mentorId = v.id;
      ctx.assignment.revision++;
      ctx.assignment.assignedBy = u.id;
      ctx.assignment.assignedAt = at;
    } else
      s.mentorAssignments.push({
        enrollmentId: id,
        mentorId: v.id,
        revision: 1,
        assignedBy: u.id,
        assignedAt: at,
        history: [],
      });
    if (t && t.status !== "graded" && t.grading) {
      t.previousGradings.push(t.grading);
      delete t.grading;
      t.revision++;
    }
    notify(
      s,
      {
        key: `mentor-assigned:${id}:${input.revision + 1}`,
        recipientId: v.id,
        lv1OrganizationId: ctx.a.lv1OrganizationId,
        type: "result",
        title: "실기(주관식) 담당 지정",
        body: `${ctx.c.title} · ${s.users.find((v) => v.id === ctx.a.learnerId)!.name}`,
        href: `/mentoring/${id}`,
      },
      at,
    );
  } else {
    const blockers = mentorBlockers(s, doc, id);
    demand(!blockers.length, 409, blockers.join(" "), "MENTOR_BLOCKED");
    demand(
      !s.completions.some((c) => c.enrollmentId === id) &&
        !ctx.attempts.some((t) => t.result === "passed"),
      409,
      "이미 통과하거나 수료한 실기는 변경할 수 없습니다.",
    );
    if (action === "start") {
      z.object({}).strict().parse(body);
      if (t && t.status !== "graded") return { id: t.id, revision: t.revision };
      t = {
        id: randomUUID(),
        enrollmentId: id,
        courseId: ctx.c.id,
        learnerId: ctx.a.learnerId,
        revision: 1,
        round: ctx.attempts.length + 1,
        status: "draft",
        createdAt: at,
        courseHash: canonicalHash(CourseContentSchema.parse(ctx.c)),
        questions: structuredClone(ctx.c.mentorPractical!.questions),
        passScore: ctx.c.mentorPractical!.passScore!,
        answers: {},
        previousGradings: [],
      };
      s.mentorAttempts.push(t);
    } else {
      demand(t, 409, "실기 수행 답변을 먼저 시작해 주세요.");
      if (action === "save") {
        const input = z
          .object({
            revision,
            attemptId,
            answers: z.record(z.string(), z.string().max(20000)),
          })
          .strict()
          .parse(body);
        demand(
          t.id === input.attemptId,
          409,
          "응시 차수가 변경되었습니다. 최신 내용을 다시 확인해 주세요.",
          "REVISION_CONFLICT",
        );
        expected(t.revision, input.revision);
        demand(t.status === "draft", 409, "제출한 답변은 수정할 수 없습니다.");
        demand(
          Object.keys(input.answers).every((id) =>
            t!.questions.some((q) => q.id === id),
          ),
          422,
          "알 수 없는 문항입니다.",
        );
        t.answers = input.answers;
      } else if (action === "submit") {
        const input = z.object({ revision, attemptId }).strict().parse(body);
        demand(
          t.id === input.attemptId,
          409,
          "응시 차수가 변경되었습니다. 최신 내용을 다시 확인해 주세요.",
          "REVISION_CONFLICT",
        );
        expected(t.revision, input.revision);
        demand(t.status === "draft", 409, "이미 제출한 답변입니다.");
        demand(
          t.questions.every((q) => t!.answers[q.id]?.trim()),
          422,
          "모든 실기 문항의 수행 내용·답변을 작성해 주세요.",
        );
        t.status = "submitted";
        t.submittedAt = at;
        notify(
          s,
          {
            key: `mentor-submit:${t.id}`,
            recipientId: ctx.assignment!.mentorId,
            lv1OrganizationId: ctx.a.lv1OrganizationId,
            type: "result",
            title: "실기(주관식) 채점 요청",
            body: ctx.c.title,
            href: `/mentoring/${id}`,
          },
          at,
        );
      } else if (action === "grade") {
        const input = MentorGradingSchema.omit({ savedBy: true, savedAt: true })
          .extend({ revision, attemptId })
          .strict()
          .parse(body);
        demand(
          t.id === input.attemptId,
          409,
          "응시 차수가 변경되었습니다. 최신 내용을 다시 확인해 주세요.",
          "REVISION_CONFLICT",
        );
        expected(t.revision, input.revision);
        demand(
          t.status === "submitted",
          409,
          "제출된 미확정 답변만 채점할 수 있습니다.",
        );
        demand(
          Object.entries(input.scores).every(([id, score]) =>
            t!.questions.some((q) => q.id === id && score <= q.points),
          ) &&
            Object.keys(input.feedback).every((id) =>
              t!.questions.some((q) => q.id === id),
            ),
          422,
          "문항별 점수는 0점부터 해당 배점까지 입력해 주세요.",
        );
        t.grading = {
          scores: input.scores,
          feedback: input.feedback,
          comment: input.comment,
          savedBy: u.id,
          savedAt: at,
        };
      } else {
        demand(action === "finalize", 404, "지원하지 않는 실기 작업입니다.");
        const input = z
          .object({ revision, attemptId, reviewToken: z.string() })
          .strict()
          .parse(body);
        demand(
          t.id === input.attemptId,
          409,
          "응시 차수가 변경되었습니다. 최신 내용을 다시 확인해 주세요.",
          "REVISION_CONFLICT",
        );
        expected(t.revision, input.revision);
        const review = mentorPreview(s, doc, id);
        demand(
          !review.blockers.length,
          409,
          review.blockers.join(" "),
          "MENTOR_BLOCKED",
        );
        demand(
          review.token === input.reviewToken,
          409,
          "검토 후 상태가 변경되었습니다. 다시 검토해 주세요.",
          "REVISION_CONFLICT",
        );
        Object.assign(t, {
          status: "graded",
          gradedBy: u.id,
          gradedAt: at,
          ...totals(t),
        });
        reconcile(s, id, doc, at);
        notify(
          s,
          {
            key: `mentor-result:${t.id}`,
            recipientId: ctx.a.learnerId,
            lv1OrganizationId: ctx.a.lv1OrganizationId,
            type: "result",
            title: `실기(주관식) ${t.result === "passed" ? "합격" : "불합격"}`,
            body: `${ctx.c.title} · ${t.earned}/${t.total}점`,
            href: `/mentor-practicals/${id}`,
          },
          at,
        );
      }
      t.revision++;
    }
  }
  s.audits.push({
    id: randomUUID(),
    actorId: u.id,
    date: at,
    action: `mentor-practical.${action}`,
    targetId: t?.id || id,
    assignmentId: ctx.a.id,
    lv1OrganizationId: ctx.a.lv1OrganizationId,
    reason:
      action === "assign"
        ? (body as { reason: string }).reason || "실기 담당 FT 멘토 지정"
        : `실기(주관식) ${action}`,
    details: {
      enrollmentId: id,
      mentorId: s.mentorAssignments.find((v) => v.enrollmentId === id)!
        .mentorId,
      ...(action === "finalize"
        ? { earned: t!.earned!, total: t!.total!, result: t!.result! }
        : {}),
    },
  });
  return action === "assign"
    ? {
        id,
        revision: s.mentorAssignments.find((v) => v.enrollmentId === id)!
          .revision,
      }
    : { id: t!.id, revision: t!.revision };
}
