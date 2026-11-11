import { CourseContentSchema, type State } from "@eks/contracts";
import { canonicalHash } from "./releases.ts";
import { groupSourceHash } from "./group-practical-evidence.ts";

export function validateGroups(s: State) {
  const check = (v: unknown, message: string) => {
    if (!v) throw Error(`그룹 실기 무결성 오류: ${message}`);
  };
  const configured = [
    ...s.courses,
    ...s.commonCourses,
    ...s.commonCourseReleases,
  ].filter((c) => c.groupPractical);
  check(
    s.schemaVersion >= 33 ||
      (!configured.length &&
        !s.groupAssessments.length &&
        !s.groupAssessmentFiles.length),
    "명시적 업무33 이관 필요",
  );
  check(
    !s.groupAssessments.length || s.groupPracticalEnvironment === "trial",
    "시험환경 표시",
  );
  for (const c of configured)
    check(
      c.qualificationType === "auditee" &&
        c.assessmentKinds.length === 0 &&
        !c.subjectiveEnabled,
      "전용 인증Set 평가 구성",
    );
  const groups = new Map(s.groupAssessments.map((g) => [g.id, g]));
  const files = new Map(s.groupAssessmentFiles.map((f) => [f.id, f]));
  check(
    groups.size === s.groupAssessments.length &&
      files.size === s.groupAssessmentFiles.length,
    "그룹/파일 ID 중복",
  );
  const users = new Set(s.users.map((u) => u.id));
  const courses = new Map(s.courses.map((c) => [c.id, c]));
  const enrollments = new Map(s.enrollments.map((e) => [e.id, e]));
  const assignments = new Map(s.assignments.map((a) => [a.id, a]));
  const occupied = new Set<string>();
  const runIds = new Set<string>(),
    decisions = new Set<string>();
  for (const group of groups.values()) {
    const c = courses.get(group.courseId);
    check(
      c?.groupPractical &&
        c.lv1OrganizationId === group.lv1OrganizationId &&
        users.has(group.createdBy) &&
        users.has(group.evaluatorId),
      "그룹 기준/운영자 연결",
    );
    check(
      !group.members.some((m) => m.learnerId === group.evaluatorId) &&
        new Set(group.members.map((m) => m.learnerId)).size ===
          group.members.length,
      "구성원/평가자 구분",
    );
    for (const m of group.members) {
      const e = enrollments.get(m.enrollmentId),
        a = assignments.get(e?.assignmentId || "");
      check(
        users.has(m.learnerId) &&
          e?.courseId === c?.id &&
          a?.learnerId === m.learnerId &&
          a?.lv1OrganizationId === group.lv1OrganizationId &&
          !a?.auditor &&
          !a?.renewalBatchId,
        "개인 수강 연결",
      );
      if (["draft", "active"].includes(group.status)) {
        check(!occupied.has(m.enrollmentId), "진행 그룹 중복");
        occupied.add(m.enrollmentId);
      }
    }
    if (group.runs.length)
      check(
        group.startedAt &&
          group.courseHash === canonicalHash(CourseContentSchema.parse(c)),
        "시작 당시 기준 해시",
      );
    if (group.status === "draft")
      check(!group.runs.length && !group.startedAt, "초안 상태");
    if (group.status === "closed")
      check(group.closed && users.has(group.closed.by), "종료 근거");
    if (group.status === "passed")
      check(group.runs.at(-1)?.status === "passed", "그룹 합격 근거");
    for (const [i, run] of group.runs.entries()) {
      check(!runIds.has(run.id) && run.number === i + 1, "평가 차수 중복/순서");
      runIds.add(run.id);
      if (i)
        check(
          group.runs[i - 1]?.decision?.result === "failed",
          "Fail 이후 재평가",
        );
      check(
        run.trials.length === group.members.length * 3 &&
          new Set(run.trials.map((t) => `${t.learnerId}:${t.number}`)).size ===
            run.trials.length,
        "개인별 3회 수행 구조",
      );
      for (const t of run.trials) {
        check(
          group.members.some((m) => m.learnerId === t.learnerId),
          "수행 구성원",
        );
        check(
          !t.completed || (t.performedOn && t.evidence.length),
          "완료 수행 근거",
        );
        for (const e of t.evidence) {
          const f = files.get(e.fileId);
          check(
            f?.groupId === group.id &&
              f?.runId === run.id &&
              f.kind === "raw" &&
              e.locator.trim(),
            "수행 원자료 연결",
          );
        }
      }
      if (run.analysis) {
        check(
          users.has(run.analysis.registeredBy) &&
            run.analysis.sourceHash === groupSourceHash(s, group, run, files),
          "분석 원자료/등록자",
        );
        check(
          run.analysis.reportFileIds.every((id) => {
            const f = files.get(id);
            return (
              f?.groupId === group.id &&
              f.runId === run.id &&
              f.kind === "report"
            );
          }),
          "분석 보고서 연결",
        );
      }
      for (const old of run.previousAnalyses)
        check(users.has(old.registeredBy), "과거 분석 등록자");
      if (run.decision) {
        const d = run.decision;
        check(!decisions.has(d.id), "판정 ID 중복");
        decisions.add(d.id);
        check(
          run.analysis &&
            run.trials.every((t) => t.completed) &&
            run.analysis.dataVerified &&
            run.analysis.reason.trim() &&
            run.analysis.reportFileIds.length &&
            d.result === run.analysis.result &&
            d.sourceHash === groupSourceHash(s, group, run, files) &&
            d.analysisHash === canonicalHash(run.analysis) &&
            users.has(d.decidedBy) &&
            !group.members.some((m) => m.learnerId === d.decidedBy),
          "확정 분석/판정 근거",
        );
        check(
          c!.groupPractical!.metrics.every((m) =>
            m.type === "number"
              ? typeof run.analysis!.values[m.id] === "number"
              : typeof run.analysis!.values[m.id] === "string" &&
                (run.analysis!.values[m.id] as string).trim(),
          ),
          "확정 필수 결과값",
        );
        check(
          run.status === (run.invalidation ? "invalidated" : d.result),
          "판정 상태",
        );
        if (run.invalidation)
          check(users.has(run.invalidation.by), "무효화 실행자");
        if (d.result === "passed")
          for (const m of group.members)
            check(
              s.completions.some(
                (co) =>
                  co.enrollmentId === m.enrollmentId &&
                  co.groupPractical?.decisionId === d.id,
              ),
              "전원 수료 반영 누락",
            );
      } else
        check(
          !["passed", "failed", "invalidated"].includes(run.status) &&
            !run.invalidation,
          "미확정 상태",
        );
    }
  }
  for (const f of files.values()) {
    const group = groups.get(f.groupId);
    check(
      group?.runs.some((r) => r.id === f.runId) && users.has(f.uploadedBy),
      "파일 그룹/차수/등록자",
    );
  }
  for (const co of s.completions) {
    if (co.method !== "group_practical") {
      check(!co.groupPractical, "기존 수료 방식 근거 혼합");
      continue;
    }
    const ev = co.groupPractical,
      group = groups.get(ev?.groupId || ""),
      run = group?.runs.find((r) => r.id === ev?.runId);
    check(
      ev &&
        group?.courseId === co.courseId &&
        group.members.some(
          (m) =>
            m.enrollmentId === co.enrollmentId && m.learnerId === co.learnerId,
        ) &&
        run?.decision?.id === ev.decisionId &&
        run?.decision?.result === "passed" &&
        ev.sourceHash === run.decision.sourceHash &&
        ev.evaluatorId === run.decision.decidedBy &&
        co.date === run.decision.decidedAt &&
        !co.evidence.length &&
        !co.learningEvidence.length,
      "개인 수료 판정 연결",
    );
    if (run?.invalidation) {
      const a = assignments.get(
        enrollments.get(co.enrollmentId)?.assignmentId || "",
      );
      check(a?.acquisitionClosedAt, "무효화 취득 절차 종료");
      check(
        s.certifications
          .filter((cert) => cert.evidence.some((e) => e.completionId === co.id))
          .every((cert) => cert.lifecycleStatus === "Revoke"),
        "무효화 인증 효력 정리",
      );
    }
  }
  const trialCompletions = new Set(
    s.completions.filter((co) => co.groupPractical).map((co) => co.id),
  );
  for (const cert of s.certifications)
    check(
      !cert.evidence.some((e) => trialCompletions.has(e.completionId)) ||
        cert.trial === true,
      "시험 발급 표시",
    );
}
