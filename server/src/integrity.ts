import { validatePolicies } from "./organization-policies.ts";
import {
  StateSchema,
  assessmentQuestions,
  assessmentPassScore,
  courseErrors,
  qualificationErrors,
  requiredKinds,
  type State,
  type OrganizationDocument,
  organizationEntries,
} from "@eks/contracts";
import { validateWorkflow } from "./workflow-integrity.ts";
import { validateLifecycle } from "./lifecycle-integrity.ts";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`저장 데이터 무결성 오류: ${message}`);
}
export function validateState(
  input: unknown,
  organizations?: OrganizationDocument,
): State {
  const s = StateSchema.parse(input);
  validateLifecycle(s);
  check(
    s.users.some((u) => u.roles.includes("system_operator")),
    "시스템 운영자 누락",
  );
  for (const user of s.users) {
    check(new Set(user.roles).size === user.roles.length, "역할 중복");
    if (user.organizationAdministration) {
      check(
        user.organizationAdministration.organizationId === user.organizationId,
        "관리 지정과 실제 소속 불일치",
      );
      check(
        s.users.some(
          (u) => u.id === user.organizationAdministration!.grantedBy,
        ),
        "관리 지정자 참조",
      );
    }
  }
  const entries = organizations ? organizationEntries(organizations) : [];
  const rootOf = (id: string) =>
    entries.find(
      (e) => e.id === s.users.find((u) => u.id === id)?.organizationId,
    )?.lv1OrganizationId;
  if (organizations) {
    validatePolicies(s, organizations);
    for (const user of s.users)
      check(
        entries.some((e) => e.id === user.organizationId),
        "사용자 조직 참조",
      );
    for (const record of [
      ...s.courses,
      ...s.qualifications,
      ...s.assignments,
      ...s.notices.filter((n) => n.scope === "team"),
      ...s.plans,
      ...s.planningRequests,
      ...s.notifications,
      ...s.catalogBatches,
      ...s.renewals,
      ...s.lifecycleEvents,
    ])
      check(
        entries.some((e) => e.id === record.lv1OrganizationId && e.level === 1),
        "Lv1 조직 참조",
      );
    for (const event of [...s.audits, ...s.requests])
      if (event.lv1OrganizationId)
        check(
          entries.some(
            (e) => e.id === event.lv1OrganizationId && e.level === 1,
          ),
          "이력 Lv1 참조",
        );
    for (const record of [...s.plans, ...s.planningRequests])
      check(
        rootOf(record.learnerId) === record.lv1OrganizationId,
        "계획 사용자 Lv1 불일치",
      );
  }
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
    "plans",
    "planningRequests",
    "learningRecords",
    "notifications",
    "catalogBatches",
    "renewals",
    "lifecycleEvents",
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
              parent.lv1OrganizationId === item.lv1OrganizationId &&
              parent.version < item.version &&
              parent.status === "published",
          ),
          "기준 버전 계보",
        );
  }
  for (const c of s.courses) {
    if (c.operationalStatus === "retired")
      check(
        c.status === "published" &&
          c.retiredAt &&
          c.retirementReason &&
          s.users.some((u) => u.id === c.retiredBy),
        "인증Set 운영 종료 근거",
      );
    else
      check(
        !c.retiredAt && !c.retiredBy && !c.retirementReason,
        "운영 중 인증Set의 종료 정보",
      );
    if (c.status === "published")
      check(!courseErrors(c).length, "사용 중인 인증Set 기준 누락");
  }
  for (const q of s.qualifications) {
    check(
      q.courseIds.every((id) =>
        s.courses.some(
          (c) => c.id === id && c.lv1OrganizationId === q.lv1OrganizationId,
        ),
      ),
      "인증Set 참조 누락",
    );
    if (q.status === "published")
      check(
        !qualificationErrors(q, s.courses).length,
        "사용 중인 자격 기준 누락",
      );
  }
  for (const a of s.assignments) {
    const q = s.qualifications.find((q) => q.id === a.qualificationId);
    check(
      q?.status === "published" && q.lv1OrganizationId === a.lv1OrganizationId,
      "배정된 자격 버전·Lv1",
    );
    check(
      a.organizationPath[0]?.id === a.lv1OrganizationId,
      "배정 당시 조직 경로",
    );
    if (organizations)
      check(
        rootOf(a.learnerId) === a.lv1OrganizationId,
        "배정 사용자 Lv1 불일치",
      );
    // Identity is permanent; current roles are enforced by mutation authorization.
    // Reset must preserve assignments/roles even after a completed user's role changed.
    check(
      s.users.some((u) => u.id === a.learnerId),
      "학습자 참조",
    );
    check(
      s.users.some((u) => u.id === a.ownerAdminId),
      "담당 운영자 참조",
    );
    const es = s.enrollments.filter((e) => e.assignmentId === a.id);
    check(
      es.length === q.courseIds.length &&
        new Set(es.map((e) => e.courseId)).size === es.length &&
        es.every((e) => q.courseIds.includes(e.courseId)),
      "배정 필수 인증Set 집합",
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
    const questions = assessmentQuestions(c, t.kind);
    const key = `${e.id}:${t.kind}`,
      roundKey = `${key}:${t.round}`;
    check(!rounds.has(roundKey), "응시 회차 중복");
    rounds.add(roundKey);
    check(
      Object.entries(t.answers).every(([id, value]) =>
        questions.some((q) => q.id === id && value < q.choices.length),
      ),
      "답안 항목/선택지",
    );
    if (t.status !== "graded") {
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
      {
        const total = questions.reduce((v, q) => v + q.points, 0),
          earned = questions.reduce(
            (v, q) => v + (t.answers[q.id] === q.correct ? q.points : 0),
            0,
          );
        check(
          questions.every((q) => t.answers[q.id] !== undefined) &&
            t.total === total &&
            t.earned === earned &&
            t.result ===
              (earned * 100 >= total * assessmentPassScore(c, t.kind)!
                ? "passed"
                : "failed"),
          "객관식 채점 결과",
        );
        check(
          t.itemResults?.length === questions.length &&
            questions.every((q) =>
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
        s.users.some((u) => u.id === comp.ownerAdminId),
      "비교 기록 참조",
    );
    check(
      comp.attemptIds.every((id) =>
        s.attempts.some(
          (t) =>
            t.id === id && t.enrollmentId === e.id && t.status === "graded",
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
  validateWorkflow(s);
  return s;
}
