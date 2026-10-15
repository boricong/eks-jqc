import {
  StateSchema,
  courseErrors,
  qualificationErrors,
  requiredKinds,
  type State,
} from "@eks/contracts";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`저장 데이터 무결성 오류: ${message}`);
}
export function validateState(input: unknown): State {
  const s = StateSchema.parse(input);
  for (const key of [
    "users",
    "courses",
    "qualifications",
    "assignments",
    "enrollments",
    "attempts",
    "completions",
    "certifications",
    "notices",
    "comparisons",
    "audits",
  ] as const)
    check(
      new Set(s[key].map((x) => x.id)).size === s[key].length,
      `${key} ID 중복`,
    );
  for (const list of [s.courses, s.qualifications])
    check(
      new Set(list.map((x) => `${x.entityId}:${x.version}`)).size ===
        list.length,
      "기준 버전 중복",
    );
  for (const list of [s.courses, s.qualifications]) {
    for (const item of list)
      if (item.parentId)
        check(
          list.some(
            (parent) =>
              parent.id === item.parentId &&
              parent.entityId === item.entityId &&
              parent.version < item.version &&
              parent.status === "published",
          ),
          "기준 버전 계보",
        );
  }
  for (const c of s.courses)
    if (c.status === "published")
      check(!courseErrors(c).length, "사용 중인 과정 기준 누락");
  for (const q of s.qualifications) {
    check(
      q.courseIds.every((id) => s.courses.some((c) => c.id === id)),
      "과정 참조 누락",
    );
    if (q.status === "published")
      check(
        !qualificationErrors(q, s.courses).length,
        "사용 중인 자격 기준 누락",
      );
  }
  for (const a of s.assignments) {
    const q = s.qualifications.find((q) => q.id === a.qualificationId);
    check(q?.status === "published", "배정된 자격 버전");
    check(
      s.users.some((u) => u.id === a.learnerId && u.roles.includes("learner")),
      "학습자 참조",
    );
    check(
      s.users.some((u) => u.id === a.ownerAdminId && u.roles.includes("admin")),
      "담당 운영자 참조",
    );
    if (
      q.courseIds.some((id) =>
        requiredKinds(s.courses.find((c) => c.id === id)!).includes(
          "practical",
        ),
      )
    )
      check(
        a.ftId !== a.learnerId &&
          s.users.some((u) => u.id === a.ftId && u.roles.includes("ft")),
        "FT 배정",
      );
    const es = s.enrollments.filter((e) => e.assignmentId === a.id);
    check(
      es.length === q.courseIds.length &&
        new Set(es.map((e) => e.courseId)).size === es.length &&
        es.every((e) => q.courseIds.includes(e.courseId)),
      "배정 필수 과정 집합",
    );
  }
  const activeKeys = new Set<string>(),
    rounds = new Set<string>();
  for (const t of s.attempts) {
    const e = s.enrollments.find((e) => e.id === t.enrollmentId),
      a = s.assignments.find((a) => a.id === e?.assignmentId),
      c = s.courses.find((c) => c.id === t.courseId);
    check(
      e &&
        a &&
        c &&
        e.courseId === c.id &&
        a.learnerId === t.learnerId &&
        requiredKinds(c).includes(t.kind),
      "응시의 수강·직원·기준 연결",
    );
    const key = `${e.id}:${t.kind}`,
      roundKey = `${key}:${t.round}`;
    check(!rounds.has(roundKey), "응시 회차 중복");
    rounds.add(roundKey);
    check(
      Object.entries(t.answers).every(([id, value]) =>
        c.questions.some((q) => q.id === id && value < q.choices.length),
      ),
      "답안 항목/선택지",
    );
    check(
      Object.keys(t.verdicts).every((id) =>
        c.practicalItems.some((i) => i.id === id),
      ),
      "실기 항목",
    );
    if (t.status === "in_progress") {
      check(
        !t.result && !t.date && !activeKeys.has(key),
        "진행 중 응시 중복/결과",
      );
      activeKeys.add(key);
      check(
        !s.attempts.some(
          (other) =>
            other.enrollmentId === e.id &&
            other.kind === t.kind &&
            other.result === "passed",
        ),
        "통과 후 추가 응시",
      );
    } else {
      check(t.date && t.result, "확정 응시 결과 누락");
      if (t.kind === "objective") {
        const total = c.questions.reduce((v, q) => v + q.points, 0),
          earned = c.questions.reduce(
            (v, q) => v + (t.answers[q.id] === q.correct ? q.points : 0),
            0,
          );
        check(
          c.questions.every((q) => t.answers[q.id] !== undefined) &&
            t.total === total &&
            t.earned === earned &&
            t.result ===
              (earned * 100 >= total * c.passScore! ? "passed" : "failed"),
          "객관식 채점 결과",
        );
        check(
          t.itemResults?.length === c.questions.length &&
            c.questions.every((q) =>
              t.itemResults?.some(
                (r) =>
                  r.itemId === q.id &&
                  r.possible === q.points &&
                  r.correct === (t.answers[q.id] === q.correct) &&
                  r.earned === (t.answers[q.id] === q.correct ? q.points : 0),
              ),
            ),
          "문항별 채점 결과",
        );
      } else {
        check(
          t.evaluatorId !== a.learnerId &&
            s.users.some(
              (u) => u.id === t.evaluatorId && u.roles.includes("ft"),
            ),
          "확정 평가자",
        );
        check(
          c.practicalItems.every(
            (i) => t.verdicts[i.id]?.value && t.verdicts[i.id]?.evidence.trim(),
          ),
          "실기 근거 누락",
        );
        check(
          t.result ===
            (c.practicalItems
              .filter((i) => i.mandatory)
              .every((i) => t.verdicts[i.id]?.value === "pass")
              ? "passed"
              : "failed"),
          "실기 결과",
        );
      }
    }
  }
  for (const e of s.enrollments) {
    const a = s.assignments.find((a) => a.id === e.assignmentId),
      c = s.courses.find((c) => c.id === e.courseId);
    check(a && c, "수강 참조");
    const completions = s.completions.filter((x) => x.enrollmentId === e.id),
      kinds = requiredKinds(c);
    check(completions.length <= 1, "수료 중복");
    for (const kind of kinds)
      check(
        s.attempts.filter(
          (t) =>
            t.enrollmentId === e.id && t.kind === kind && t.result === "passed",
        ).length <= 1,
        "평가별 합격 중복",
      );
    if (
      !a.excludedReason &&
      kinds.every((kind) =>
        s.attempts.some(
          (t) =>
            t.enrollmentId === e.id && t.kind === kind && t.result === "passed",
        ),
      )
    )
      check(completions.length === 1, "수료 누락");
  }
  for (const co of s.completions) {
    const e = s.enrollments.find((e) => e.id === co.enrollmentId),
      a = s.assignments.find((a) => a.id === e?.assignmentId),
      c = s.courses.find((c) => c.id === co.courseId);
    check(
      e && a && c && co.learnerId === a.learnerId && co.courseId === e.courseId,
      "수료 참조",
    );
    const kinds = requiredKinds(c);
    check(
      co.evidence.length === kinds.length &&
        new Set(co.evidence.map((x) => x.kind)).size === kinds.length &&
        co.evidence.every(
          (ev) =>
            kinds.includes(ev.kind) &&
            s.attempts.some(
              (t) =>
                t.id === ev.attemptId &&
                t.enrollmentId === e.id &&
                t.courseId === c.id &&
                t.learnerId === a.learnerId &&
                t.kind === ev.kind &&
                t.result === "passed",
            ),
        ),
      "수료 합격 근거",
    );
  }
  for (const a of s.assignments) {
    const certs = s.certifications.filter((x) => x.assignmentId === a.id),
      es = s.enrollments.filter((e) => e.assignmentId === a.id);
    check(certs.length <= 1, "인증 중복");
    if (
      !a.excludedReason &&
      es.length &&
      es.every((e) => s.completions.some((c) => c.enrollmentId === e.id))
    )
      check(certs.length === 1, "인증 누락");
  }
  for (const cert of s.certifications) {
    const a = s.assignments.find((a) => a.id === cert.assignmentId),
      es = s.enrollments.filter((e) => e.assignmentId === a?.id);
    check(
      a &&
        cert.learnerId === a.learnerId &&
        cert.qualificationId === a.qualificationId &&
        cert.evidence.length === es.length &&
        new Set(cert.evidence.map((x) => x.enrollmentId)).size === es.length &&
        cert.evidence.every(
          (ev) =>
            es.some((e) => e.id === ev.enrollmentId) &&
            s.completions.some(
              (c) =>
                c.id === ev.completionId && c.enrollmentId === ev.enrollmentId,
            ),
        ),
      "인증 수료 근거",
    );
  }
  for (const comp of s.comparisons) {
    const e = s.enrollments.find((e) => e.id === comp.enrollmentId),
      a = s.assignments.find((a) => a.id === e?.assignmentId);
    check(
      e &&
        a &&
        comp.courseId === e.courseId &&
        comp.learnerId === a.learnerId &&
        comp.ownerAdminId === a.ownerAdminId,
      "비교 기록 참조",
    );
    check(
      comp.attemptIds.every((id) =>
        s.attempts.some(
          (t) =>
            t.id === id && t.enrollmentId === e.id && t.status === "submitted",
        ),
      ),
      "비교 응시 참조",
    );
    const selected = comp.attemptIds.map((id) =>
      s.attempts.find((t) => t.id === id)!,
    );
    check(
      new Set(selected.map((t) => t.kind)).size === selected.length,
      "비교 평가 종류 중복",
    );
    if (comp.status === "final") {
      const course = s.courses.find((c) => c.id === comp.courseId)!;
      check(
        requiredKinds(course).every((kind) =>
          selected.some((t) => t.kind === kind),
        ) &&
          comp.finalizedAt &&
          comp.observedAt &&
          comp.observer.trim() &&
          comp.task.trim() &&
          comp.criterion.trim() &&
          comp.evidence.trim(),
        "확정 비교 기록 누락",
      );
      const passed = selected.every((t) => t.result === "passed");
      const outcome =
        comp.independence !== "independent" || comp.performance === "unknown"
          ? "pending"
          : passed
            ? comp.performance === "met"
              ? "both_met"
              : "assessment_only"
            : comp.performance === "met"
              ? "performance_only"
              : "neither_met";
      check(comp.outcome === outcome, "비교 판정 불일치");
    } else check(!comp.finalizedAt && !comp.outcome, "초안 비교 판정");
    if (comp.supersedesId)
      check(
        s.comparisons.some(
          (c) =>
            c.id !== comp.id &&
            c.id === comp.supersedesId &&
            c.enrollmentId === e.id &&
            c.status === "final" &&
            c.createdAt <= comp.createdAt,
        ),
        "정정 원본 참조",
      );
  }
  check(
    s.audits.every((ev) => s.users.some((u) => u.id === ev.actorId)),
    "변경 주체 참조",
  );
  check(
    new Set(s.requests.map((r) => `${r.actorId}:${r.key}`)).size ===
      s.requests.length,
    "요청 식별자 중복",
  );
  return s;
}
