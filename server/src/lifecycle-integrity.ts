import {
  periodExpiry,
  addCalendarDays,
  kstDate,
  renewalOpensOn,
  type State,
} from "@eks/contracts";
const check = (value: unknown, label: string) => {
  if (!value) throw new Error(`저장 데이터 무결성 오류: ${label}`);
};
export function validateLifecycle(s: State) {
  for (const c of s.certifications) {
    check(
      c.periods?.length && c.revision && c.lifecycleStatus,
      "인증 상태·기간 누락",
    );
    const periods = c.periods!;
    check(
      new Set(periods.map((p) => p.id)).size === periods.length,
      "유효기간 ID 중복",
    );
    for (const [i, p] of periods.entries()) {
      const q = s.qualifications.find((q) => q.id === p.qualificationId),
        original = s.qualifications.find((q) => q.id === c.qualificationId)!;
      check(
        q &&
          q.entityId === original.entityId &&
          q.version === p.qualificationVersion &&
          q.lv1OrganizationId === original.lv1OrganizationId,
        "갱신 기준 계보",
      );
      check(
        p.sequence === i + 1 &&
          p.expiresOn === periodExpiry(p.baseOn, p.validity),
        "유효기간 순서·만료 계산",
      );
      if (i === 0) {
        check(
          (c.validity
            ? JSON.stringify(c.validity) === JSON.stringify(p.validity)
            : p.validity.type === "unknown") && c.expiresOn === p.expiresOn,
          "최초 발급 정책 보존",
        );
        check(
          p.kind === "initial" &&
            p.completedAt === c.date &&
            p.startsOn === kstDate(c.date) &&
            p.baseOn === p.startsOn &&
            p.qualificationId === c.qualificationId &&
            !p.renewalId &&
            !p.previousPeriodId,
          "최초 취득 기간",
        );
      } else {
        const previous = periods[i - 1]!,
          r = s.renewals.find((r) => r.id === p.renewalId);
        check(
          p.kind === "renewal" &&
            previous.expiresOn &&
            p.previousPeriodId === previous.id &&
            p.baseOn === previous.expiresOn &&
            p.startsOn === addCalendarDays(previous.expiresOn!, 1),
          "갱신 연속 기간",
        );
        check(
          kstDate(p.completedAt) >= renewalOpensOn(previous)! &&
            kstDate(p.completedAt) <= previous.expiresOn!,
          "갱신 완료 기간",
        );
        check(
          r?.status === "completed" &&
            r.certificationId === c.id &&
            r.periodId === previous.id &&
            r.qualificationId === p.qualificationId &&
            r.completedAt === p.completedAt &&
            JSON.stringify(r.validity) === JSON.stringify(p.validity) &&
            r.renewalLeadMonths === p.renewalLeadMonths &&
            (r.renewalNoticeDaysBefore ?? 7) ===
              (p.renewalNoticeDaysBefore ?? 7),
          "종합평가 갱신 근거",
        );
      }
    }
    if (c.previousCertificationId) {
      const previous = s.certifications.find(
        (x) => x.id === c.previousCertificationId,
      );
      check(
        previous &&
          previous.lifecycleStatus === "Revoke" &&
          previous.learnerId === c.learnerId &&
          s.qualifications.find((q) => q.id === previous.qualificationId)
            ?.entityId ===
            s.qualifications.find((q) => q.id === c.qualificationId)?.entityId,
        "재취득 이전 인증",
      );
    }
  }
  for (const r of s.renewals) {
    if (r.method === "auditor_self_confirmation" && r.status === "completed")
      check(
        r.confirmation?.confirmedBy === r.learnerId &&
          r.confirmation.confirmedAt === r.completedAt &&
          r.confirmation.qualificationId === r.qualificationId &&
          r.confirmation.qualificationRevision === r.qualificationRevision,
        "Auditor 본인 기준 확인 갱신 근거",
      );
    const c = s.certifications.find((c) => c.id === r.certificationId),
      a = s.assignments.find((a) => a.id === c?.assignmentId);
    check(
      c &&
        c.learnerId === r.learnerId &&
        a?.lv1OrganizationId === r.lv1OrganizationId &&
        c.periods?.some((p) => p.id === r.periodId),
      "재인증 참조",
    );
    check(
      s.qualifications.some(
        (q) =>
          q.id === r.qualificationId &&
          q.entityId ===
            s.qualifications.find((x) => x.id === c?.qualificationId)?.entityId,
      ),
      "재인증 기준 참조",
    );
    check(
      r.status !== "completed" || c?.periods?.some((p) => p.renewalId === r.id),
      "완료 재인증 기간",
    );
  }
  const open = s.renewals.filter((r) => r.status !== "closed");
  check(
    new Set(open.map((r) => `${r.certificationId}:${r.periodId}`)).size ===
      open.length,
    "주기별 중복 재인증",
  );
  for (const e of s.lifecycleEvents) {
    const list =
      e.subject === "qualification"
        ? s.qualifications
        : e.subject === "eligibility" || e.subject === "work_status"
          ? s.users
          : s.certifications;
    check(
      list.some((x) => x.id === e.targetId),
      "상태 이력 참조",
    );
    check(
      e.actorId === "system" || s.users.some((u) => u.id === e.actorId),
      "상태 변경 실행자",
    );
    if (e.assignmentId)
      check(
        s.assignments.some(
          (a) =>
            a.id === e.assignmentId &&
            a.lv1OrganizationId === e.lv1OrganizationId,
        ),
        "상태 이력 조직",
      );
  }
}
