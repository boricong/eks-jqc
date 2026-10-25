import {
  planErrors,
  expirationDate,
  type State,
  type QualificationPolicySnapshot,
} from "@eks/contracts";
function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(`저장 데이터 무결성 오류: ${label}`);
}
export function validateWorkflow(s: State) {
  function snapshotValid(
    qualificationId: string,
    frozen?: QualificationPolicySnapshot,
  ) {
    if (!frozen) return;
    const q = s.qualifications.find((q) => q.id === qualificationId);
    check(
      q &&
        frozen.id === q.id &&
        frozen.entityId === q.entityId &&
        frozen.version === q.version &&
        frozen.revision <= q.revision &&
        new Set(frozen.courseIds).size === frozen.courseIds.length &&
        frozen.courseIds.length === q.courseIds.length &&
        frozen.courseIds.every((id) => q.courseIds.includes(id)),
      "보존된 자격 기준 참조",
    );
  }
  const user = (id: string) => s.users.some((u) => u.id === id);
  for (const r of s.planningRequests)
    check(user(r.learnerId) && user(r.requestedBy), "계획 요청 사용자");
  for (const r of s.planningRequests) {
    if (r.completion) {
      check(
        new Set(r.completion.evidence.map((e) => e.entityId)).size ===
          r.completion.evidence.length,
        "요청 완료 근거 중복",
      );
      check(r.completion.evidence.length > 0, "요청 완료 근거 누락");
      for (const e of r.completion.evidence) {
        check(
          e.planId ? !e.certificationId && !e.assignmentId : !!e.assignmentId,
          "요청 완료 근거 종류",
        );
        const p = s.plans.find((p) => p.id === e.planId);
        const c = s.certifications.find((c) => c.id === e.certificationId);
        const a = s.assignments.find((a) => a.id === e.assignmentId);
        // Progress reset removes certifications but retains assignments and the request's original proof IDs.
        if (c)
          check(
            c.assignmentId === e.assignmentId,
            "요청 인증과 배정 근거 연결",
          );
        const q = s.qualifications.find(
          (q) =>
            q.id ===
            (p?.qualificationId || c?.qualificationId || a?.qualificationId),
        );
        check(
          q?.entityId === e.entityId &&
            (p
              ? p.learnerId === r.learnerId && p.status === "completed"
              : c
                ? c.learnerId === r.learnerId
                : a?.learnerId === r.learnerId),
          "요청 완료 근거 참조",
        );
      }
      check(
        [...(r.targets || []), ...r.selections].every((t) =>
          r.completion!.evidence.some((e) => e.entityId === t.entityId),
        ),
        "필수 및 선택 완료 근거 누락",
      );
    }
  }
  for (const p of s.plans) {
    snapshotValid(p.qualificationId, p.qualificationPolicySnapshot);
    check(
      !p.qualificationPolicySnapshot || p.status === "completed",
      "초안의 기준 고정 금지",
    );
    check(Boolean(p.deletedAt) === Boolean(p.deletedBy), "계획 삭제 정보");
    if (p.deletedAt)
      check(
        p.status === "draft" &&
          p.deletedBy === p.learnerId &&
          user(p.deletedBy) &&
          !s.assignments.some((a) => a.planId === p.id),
        "삭제 계획 상태",
      );
    const r = s.planningRequests.find((r) => r.id === p.requestId),
      q = s.qualifications.find((q) => q.id === p.qualificationId);
    check(
      r &&
        q &&
        r.learnerId === p.learnerId &&
        r.lv1OrganizationId === p.lv1OrganizationId &&
        q.lv1OrganizationId === p.lv1OrganizationId &&
        !!q,
      "계획 요청·자격 연결",
    );
    check(
      p.schedules.length === q.courseIds.length &&
        new Set(p.schedules.map((x) => x.courseId)).size ===
          q.courseIds.length &&
        p.schedules.every((x) => q.courseIds.includes(x.courseId)),
      "계획 필수 인증Set",
    );
    if (p.status === "completed") {
      const a = s.assignments.find((a) => a.id === p.assignmentId);
      check(
        a &&
          a.planId === p.id &&
          a.learnerId === p.learnerId &&
          a.qualificationId === p.qualificationId &&
          a.ownerAdminId === r.requestedBy &&
          a.createdBy === p.learnerId &&
          p.completedAt &&
          p.approval === "skipped_by_policy" &&
          !planErrors(
            p,
            s.qualifications.find((q) => q.id === p.qualificationId)!
              .qualificationType,
          ).length,
        "완료 계획과 배정",
      );
    } else
      check(!p.assignmentId && !p.completedAt && !p.approval, "계획 초안 상태");
  }
  for (const a of s.assignments) {
    snapshotValid(a.qualificationId, a.qualificationPolicySnapshot);
    const completed = s.plans.find((p) => p.id === a.planId);
    if (a.qualificationPolicySnapshot && completed?.qualificationPolicySnapshot)
      check(
        JSON.stringify(a.qualificationPolicySnapshot) ===
          JSON.stringify(completed.qualificationPolicySnapshot),
        "완료 계획·배정 기준 일치",
      );
    if (a.planId)
      check(
        s.plans.some(
          (p) =>
            p.id === a.planId &&
            p.assignmentId === a.id &&
            p.status === "completed",
        ),
        "배정 계획 참조",
      );
    if (a.createdBy) check(user(a.createdBy), "배정 생성자");
  }
  check(
    new Set(s.learningRecords.map((r) => `${r.enrollmentId}:${r.itemId}`))
      .size === s.learningRecords.length,
    "학습 완료 기록 중복",
  );
  for (const r of s.learningRecords) {
    const e = s.enrollments.find((e) => e.id === r.enrollmentId),
      a = s.assignments.find((a) => a.id === e?.assignmentId),
      c = s.courses.find((c) => c.id === e?.courseId);
    check(
      e &&
        a?.planId &&
        a.learnerId === r.learnerId &&
        c?.learningItems.some((i) => i.id === r.itemId),
      "학습 완료 참조",
    );
  }
  for (const c of s.certifications) {
    if (c.validity && !c.periods?.length)
      check(
        c.expiresOn === expirationDate(c.date, c.validity),
        "인증 만료일 계산",
      );
    const a = s.assignments.find((a) => a.id === c.assignmentId)!;
    if (c.snapshot)
      check(
        c.snapshot.organizationPath[0]?.id === a.lv1OrganizationId,
        "인증 당시 조직",
      );
  }
  for (const c of s.completions)
    if (c.snapshot) {
      const e = s.enrollments.find((e) => e.id === c.enrollmentId)!;
      check(
        c.snapshot.organizationPath[0]?.id ===
          s.assignments.find((a) => a.id === e.assignmentId)!.lv1OrganizationId,
        "수료 당시 조직",
      );
    }
  check(
    new Set(s.notifications.map((n) => `${n.recipientId}:${n.key}`)).size ===
      s.notifications.length,
    "알림 중복",
  );
  for (const n of s.notifications) {
    check(user(n.recipientId), "알림 수신자");
    if (n.assignmentId)
      check(
        s.assignments.some(
          (a) =>
            a.id === n.assignmentId &&
            a.lv1OrganizationId === n.lv1OrganizationId,
        ),
        "알림 배정 참조",
      );
    if (n.certificationId)
      check(
        s.certifications.some(
          (c) =>
            c.id === n.certificationId && c.assignmentId === n.assignmentId,
        ),
        "알림 인증 참조",
      );
  }
}
