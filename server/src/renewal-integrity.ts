import { type State, renewalQualificationErrors } from "@eks/contracts";
export function validateRenewalBatches(s: State) {
  const check = (v: unknown, m: string) => {
    if (!v) throw Error("재인증 무결성 오류: " + m);
  };
  check(
    new Set(s.renewalBatches.map((b) => b.id)).size === s.renewalBatches.length,
    "회차 ID 중복",
  );
  const open = s.renewalBatches.filter((b) => b.status === "evaluating");
  check(
    new Set(open.map((b) => `${b.learnerId}:${b.lv1OrganizationId}`)).size ===
      open.length,
    "미합격 회차 중복",
  );
  for (const b of s.renewalBatches) {
    const a = s.assignments.find((a) => a.id === b.assignmentId),
      q = s.qualifications.find((q) => q.id === b.qualificationId),
      es = s.enrollments.filter((e) => e.assignmentId === b.assignmentId),
      targets = s.renewals.filter((r) => r.batchId === b.id);
    check(
      a?.renewalBatchId === b.id &&
        a.learnerId === b.learnerId &&
        a.lv1OrganizationId === b.lv1OrganizationId &&
        a.qualificationId === b.qualificationId,
      "배정 연결",
    );
    check(
      q?.purpose === "renewal" &&
        !renewalQualificationErrors(q, s.courses).length &&
        es.length === 1 &&
        es[0]?.courseId === q.courseIds[0],
      "객관식 단독 인증Set",
    );
    check(
      targets.length &&
        targets.every(
          (r) =>
            r.learnerId === b.learnerId &&
            r.lv1OrganizationId === b.lv1OrganizationId &&
            r.method === "objective_assessment",
        ),
      "고정 대상",
    );
    check(
      !s.certifications.some((c) => c.assignmentId === b.assignmentId),
      "별도 재인증 자격 인증 금지",
    );
    if (b.passedAt) {
      const t = s.attempts.find((t) => t.id === b.attemptId),
        co = s.completions.find((co) => co.id === b.completionId);
      check(
        t?.kind === "objective" &&
          t.result === "passed" &&
          t.status === "graded" &&
          t.enrollmentId === es[0]?.id &&
          co?.enrollmentId === es[0]?.id &&
          co.evidence.some(
            (e) => e.kind === "objective" && e.attemptId === t.id,
          ),
        "합격 수료 근거",
      );
    }
    check(
      !["passed", "completed"].includes(b.status) || b.passedAt,
      "합격 시각",
    );
    check(
      b.status !== "completed" || targets.every((r) => r.status !== "draft"),
      "완료 대상",
    );
    check(
      b.status !== "closed" || targets.every((r) => r.status !== "draft"),
      "종료 대상",
    );
    check(
      b.status !== "evaluating" ||
        !targets.some((r) => r.status === "completed"),
      "합격 전 갱신",
    );
  }
  for (const a of s.assignments) {
    const q = s.qualifications.find((q) => q.id === a.qualificationId);
    check(
      q?.purpose !== "renewal" ||
        s.renewalBatches.some(
          (b) => b.id === a.renewalBatchId && b.assignmentId === a.id,
        ),
      "일반 배정으로 재인증 자격 사용 금지",
    );
  }
  for (const p of s.plans)
    check(
      !s.qualifications.some(
        (q) => q.id === p.qualificationId && q.purpose === "renewal",
      ),
      "재인증 계획 금지",
    );
  for (const r of s.renewals)
    if (r.method === "objective_assessment" || r.batchId) {
      const b = s.renewalBatches.find((b) => b.id === r.batchId);
      check(b && r.method === "objective_assessment", "재인증 회차 참조");
      check(r.status !== "completed" || b?.passedAt, "합격 없이 갱신 금지");
    }
}
