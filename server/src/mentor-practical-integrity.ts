import {
  CourseContentSchema,
  mentorPracticalErrors,
  type State,
} from "@eks/contracts";
import { canonicalHash } from "./releases.ts";
import { mentorEvidence } from "./mentor-practical-evidence.ts";

export function validateMentorPracticals(s: State) {
  function check(value: unknown, message: string): asserts value {
    if (!value) throw Error(`멘토 실기 무결성 오류: ${message}`);
  }
  const configured = [
    ...s.courses,
    ...s.commonCourses,
    ...s.commonCourseReleases,
  ].filter((c) => c.mentorPractical);
  check(
    s.schemaVersion >= 34 ||
      (!configured.length &&
        !s.mentorAssignments.length &&
        !s.mentorAttempts.length &&
        !s.users.some((u) => u.roles.includes("ft"))),
    "명시적 업무34 이관 필요",
  );
  for (const c of configured)
    check(
      c.qualificationType === "auditee" && !c.groupPractical,
      "인증Set 평가 구성",
    );
  check(
    new Set(s.mentorAssignments.map((a) => a.enrollmentId)).size ===
      s.mentorAssignments.length,
    "수강별 멘토 중복",
  );
  check(
    new Set(s.mentorAttempts.map((t) => t.id)).size === s.mentorAttempts.length,
    "평가 ID 중복",
  );
  const users = new Set(s.users.map((u) => u.id));
  for (const m of s.mentorAssignments) {
    const e = s.enrollments.find((e) => e.id === m.enrollmentId),
      a = s.assignments.find((a) => a.id === e?.assignmentId),
      c = s.courses.find((c) => c.id === e?.courseId);
    check(
      e &&
        a &&
        c?.mentorPractical &&
        users.has(m.mentorId) &&
        users.has(m.assignedBy) &&
        a.learnerId !== m.mentorId &&
        !a.auditor &&
        !a.renewalBatchId,
      "담당 멘토 참조",
    );
    check(
      m.revision === m.history.length + 1 &&
        m.history.every(
          (h) =>
            users.has(h.mentorId) &&
            users.has(h.changedBy) &&
            h.mentorId !== a.learnerId &&
            h.reason.trim(),
        ),
      "담당 변경 근거",
    );
  }
  for (const t of s.mentorAttempts) {
    const e = s.enrollments.find((e) => e.id === t.enrollmentId),
      a = s.assignments.find((a) => a.id === e?.assignmentId),
      c = s.courses.find((c) => c.id === e?.courseId);
    const m = s.mentorAssignments.find(
      (m) => m.enrollmentId === t.enrollmentId,
    );
    check(
      e &&
        a &&
        c?.mentorPractical &&
        m &&
        t.courseId === c.id &&
        t.learnerId === a.learnerId,
      "평가 수강 참조",
    );
    check(
      !mentorPracticalErrors(c.mentorPractical).length &&
        t.courseHash === canonicalHash(CourseContentSchema.parse(c)) &&
        canonicalHash(t.questions) ===
          canonicalHash(c.mentorPractical.questions) &&
        t.passScore === c.mentorPractical.passScore,
      "문항·배점·기준 잠금",
    );
    check(
      Object.keys(t.answers).every((id) =>
        t.questions.some((q) => q.id === id),
      ),
      "답변 문항 참조",
    );
    const rounds = s.mentorAttempts.filter(
      (v) => v.enrollmentId === t.enrollmentId,
    );
    check(
      rounds.indexOf(t) + 1 === t.round &&
        rounds
          .slice(0, t.round - 1)
          .every((v) => v.status === "graded" && v.result === "failed"),
      "재응시 차수·선행 결과",
    );
    for (const g of [
      ...t.previousGradings,
      ...(t.grading ? [t.grading] : []),
    ]) {
      check(
        users.has(g.savedBy) &&
          g.savedBy !== t.learnerId &&
          (g.savedBy === m.mentorId ||
            m.history.some((h) => h.mentorId === g.savedBy)) &&
          Object.entries(g.scores).every(([id, score]) =>
            t.questions.some((q) => q.id === id && score <= q.points),
          ) &&
          Object.keys(g.feedback).every((id) =>
            t.questions.some((q) => q.id === id),
          ),
        "문항별 채점 범위·채점자",
      );
    }
    if (t.status === "draft")
      check(
        !t.submittedAt && !t.grading && !t.previousGradings.length,
        "미제출 답변 채점 금지",
      );
    else
      check(
        t.submittedAt && t.questions.every((q) => t.answers[q.id]?.trim()),
        "제출 답변 완결성",
      );
    if (t.status !== "graded") {
      check(
        !t.gradedBy &&
          !t.gradedAt &&
          t.earned === undefined &&
          t.total === undefined &&
          !t.result,
        "미확정 결과",
      );
      if (t.grading)
        check(t.grading.savedBy === m.mentorId, "현재 담당자의 채점");
    } else {
      check(
        t.grading &&
          t.gradedBy === t.grading.savedBy &&
          t.gradedAt &&
          t.questions.every((q) => t.grading!.scores[q.id] !== undefined),
        "확정 채점 완결성",
      );
      const total = t.questions.reduce((v, q) => v + q.points, 0),
        earned =
          Math.round(
            t.questions.reduce((v, q) => v + t.grading!.scores[q.id]!, 0) * 100,
          ) / 100;
      check(
        t.total === total &&
          t.earned === earned &&
          t.result ===
            (earned * 100 >= total * t.passScore ? "passed" : "failed"),
        "확정 총점·합격 판정",
      );
    }
  }
  for (const co of s.completions) {
    const c = s.courses.find((c) => c.id === co.courseId);
    if (c?.mentorPractical)
      check(
        co.method === "assessment" &&
          co.mentorPractical &&
          canonicalHash(co.mentorPractical) ===
            canonicalHash(mentorEvidence(s, co.enrollmentId)),
        "필수 실기 합격 근거",
      );
    else check(!co.mentorPractical, "실기 없는 수료 근거");
  }
}
