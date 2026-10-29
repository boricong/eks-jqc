import {
  currentTeamQualifications,
  planningDeadlineErrors,
} from "@eks/contracts";
import {
  effectiveCredentialStatus,
  qualificationUseErrors,
  type State,
  type OrganizationDocument,
  type UserView,
  type PlanningRequest,
  type PlanningCandidate,
  type PlanningRequestView,
} from "@eks/contracts";
import { currentQualification } from "./qualification-templates.ts";
import { lastRevoked, openAssignment } from "./qualification-lifecycle.ts";

export function candidate(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  entityId: string,
  at: string,
  request?: PlanningRequest,
): PlanningCandidate {
  const target = (request?.selections || []).find(
    (t) => t.entityId === entityId,
  );
  const pool = currentTeamQualifications(s).find(
    (p) =>
      p.lv1OrganizationId === u.lv1OrganizationId && p.entityId === entityId,
  );
  const original = s.qualifications.find(
    (q) => q.id === (pool?.qualificationId || target?.qualificationId),
  );
  const q = original && currentQualification(s, original);
  const previous = lastRevoked(s, u.id, entityId, at);
  const assignments = s.assignments.filter(
    (a) =>
      a.learnerId === u.id &&
      !a.excludedReason &&
      s.qualifications.find((q) => q.id === a.qualificationId)?.entityId ===
        entityId,
  );
  const open = assignments.find((a) => openAssignment(s, a, at));
  const certs = s.certifications.filter((c) =>
    assignments.some((a) => a.id === c.assignmentId),
  );
  const valid = certs.find(
    (c) => effectiveCredentialStatus(c, at) === "Active",
  );
  const held = certs.find((c) => effectiveCredentialStatus(c, at) === "Hold");
  const plan = [...s.plans]
    .reverse()
    .find(
      (p) =>
        !p.deletedAt &&
        (p.status === "completed" ||
          !s.planningRequests.find((r) => r.id === p.requestId)?.closed) &&
        p.learnerId === u.id &&
        s.qualifications.find((q) => q.id === p.qualificationId)?.entityId ===
          entityId &&
        (p.assignmentId
          ? assignments.some(
              (a) => a.id === p.assignmentId && openAssignment(s, a, at),
            )
          : p.previousCertificationId === previous?.id &&
            p.organizationId === u.organizationId),
    );
  const row: PlanningCandidate = {
    entityId,
    qualificationId: q?.id || target?.qualificationId || "",
    title: q?.title || target?.title || "",
    version: q?.version || target?.version || 1,
    selected: !!target,
    status: "available",
    reason: "계획을 작성할 수 있습니다.",
    canStart: false,
    ...(previous ? { previousCertificationId: previous.id } : {}),
    ...(plan ? { planId: plan.id } : {}),
  };
  if (q?.purpose === "renewal")
    return {
      ...row,
      status: "blocked",
      reason: "재인증용 자격은 보유 자격의 재인증에서 시작해 주세요.",
      canStart: false,
    };
  if (valid)
    Object.assign(row, {
      status: "valid",
      reason: "유효 인증 보유",
      certificationId: valid.id,
    });
  else if (held)
    Object.assign(row, {
      status: "blocked",
      reason: "개인 자격 Hold · 효력을 확인해 주세요.",
    });
  else if (plan?.status === "completed")
    Object.assign(row, {
      status: "planned",
      reason: "확정된 계획으로 진행 중",
    });
  else if (open)
    Object.assign(row, {
      status: "planned",
      reason: "기존 배정으로 진행 중",
      assignmentId: open.id,
    });
  else if (!pool || !q)
    Object.assign(row, {
      status: "blocked",
      reason: "현재 사용할 팀 자격이 없습니다.",
    });
  else if (
    [...qualificationUseErrors(q, s.courses), ...planningDeadlineErrors(q)]
      .length
  )
    Object.assign(row, {
      status: "blocked",
      reason: [
        ...qualificationUseErrors(q, s.courses),
        ...planningDeadlineErrors(q),
      ].join(" · "),
    });
  else if (target && target.previousCertificationId !== previous?.id)
    Object.assign(row, {
      status: "blocked",
      reason: "폐기 후 재취득에는 관리자의 새 계획 요청이 필요합니다.",
    });
  else if (plan)
    Object.assign(row, {
      status: "draft",
      reason:
        plan.qualificationId === q.id
          ? "작성 중인 계획을 이어 쓰세요."
          : "현재 기준 버전 변경 · 기존 초안을 보존하고 현재 버전으로 다시 작성해 주세요.",
    });
  row.canStart =
    !!request &&
    !request.completion &&
    !request.closed &&
    (row.selected || request.mode === "learner_choice") &&
    ["available", "draft"].includes(row.status) &&
    request.organizationId === u.organizationId &&
    u.organizationActive &&
    u.certificationEligibility !== "hold";
  return row;
}

export function planningView(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  request: PlanningRequest,
  at: string,
): PlanningRequestView {
  if (request.closed)
    return {
      requestId: request.id,
      revision: request.revision,
      candidates: request.selections.map((t) => ({
        ...candidate(s, doc, u, t.entityId, at, request),
        canStart: false,
      })),
      errors: ["종료된 요청입니다. 새 요청을 확인해 주세요."],
      canComplete: false,
      noAdditional: false,
      stage: "요청 종료",
    };
  if (request.completion) {
    const candidates: PlanningCandidate[] = request.completion.evidence.map(
      (e) => {
        const p = s.plans.find((p) => p.id === e.planId);
        const c = s.certifications.find((c) => c.id === e.certificationId);
        const a = s.assignments.find(
          (a) =>
            a.id === (e.assignmentId || p?.assignmentId || c?.assignmentId),
        );
        const target = request.selections.find(
          (t) => t.entityId === e.entityId,
        );
        const q = s.qualifications.find(
          (q) =>
            q.id ===
            (p?.qualificationId ||
              c?.qualificationId ||
              a?.qualificationId ||
              target?.qualificationId),
        );
        return {
          ...e,
          qualificationId: q?.id || "",
          title:
            p?.qualificationMetadata?.title ||
            c?.qualificationMetadata?.title ||
            a?.qualificationMetadata?.title ||
            target?.title ||
            q?.title ||
            "",
          version: q?.version || 1,
          selected: true,
          status: e.certificationId ? "valid" : "planned",
          reason: e.certificationId
            ? "완료 당시 유효 인증 근거"
            : "완료 당시 확정 계획·진행 근거",
          canStart: false,
        };
      },
    );
    return {
      requestId: request.id,
      revision: request.revision,
      candidates,
      errors: [],
      canComplete: false,
      noAdditional: request.completion.reason === "no_additional",
      stage:
        request.completion.reason === "no_additional"
          ? "추가 계획 대상 없음"
          : "계획 완료",
    };
  }
  const ids = new Set(request.selections.map((t) => t.entityId));
  if (request.mode === "learner_choice")
    currentTeamQualifications(s)
      .filter((p) => p.lv1OrganizationId === u.lv1OrganizationId)
      .filter(
        (p) =>
          s.qualifications.find((q) => q.id === p.qualificationId)!.version !==
          null,
      )
      .forEach((p) => ids.add(p.entityId));
  const candidates = [...ids]
    .filter((id) =>
      s.qualifications.some(
        (q) =>
          q.entityId === id &&
          q.qualificationType === request.qualificationType &&
          q.purpose !== "renewal",
      ),
    )
    .map((id) => candidate(s, doc, u, id, at, request));
  const selected = candidates.filter((c) => c.selected);
  const covered = (c: PlanningCandidate) =>
    ["valid", "planned"].includes(c.status);
  const noAdditional =
    ((request.mode === "organization_required" &&
      !s.plans.some(
        (p) =>
          p.requestId === request.id &&
          p.status === "completed" &&
          !p.deletedAt,
      )) ||
      !selected.length) &&
    candidates.length > 0 &&
    candidates.every(covered);
  const errors: string[] = [];
  if (
    request.organizationId !== u.organizationId ||
    request.lv1OrganizationId !== u.lv1OrganizationId
  )
    errors.push(
      "계획 요청 이후 소속이 달라졌습니다. 현재 소속의 새 요청을 확인해 주세요.",
    );
  if (!u.organizationActive) errors.push("사용 중지된 소속입니다.");
  if (u.certificationEligibility === "hold")
    errors.push("취득 대상자 Hold 상태입니다.");
  if (!candidates.length)
    errors.push("현재 팀 자격이 없어 자격 준비를 기다리고 있습니다.");
  if (!selected.length && !noAdditional && candidates.length)
    errors.push(
      candidates.some((c) => ["available", "draft"].includes(c.status))
        ? "최소 1개 자격을 선택해 계획을 확정해 주세요."
        : "진행할 수 없는 자격의 상태를 관리자에게 확인해 주세요.",
    );
  for (const c of selected.filter((c) => !covered(c)))
    errors.push(
      `${c.title}: ${c.status === "blocked" ? c.reason : "계획 확정이 필요합니다."}`,
    );
  const stage = !candidates.length
    ? "자격 준비 대기"
    : errors.some(
          (e) =>
            e.includes("Hold") || e.includes("소속") || e.includes("관리자"),
        ) || selected.some((c) => c.status === "blocked")
      ? "확인 필요"
      : noAdditional
        ? "추가 계획 대상 없음 · 확인 필요"
        : selected.some((c) => c.planId)
          ? "작성 중"
          : "미착수";
  return {
    requestId: request.id,
    revision: request.revision,
    candidates,
    errors,
    canComplete: !errors.length,
    noAdditional,
    stage,
  };
}

export function planRequestErrors(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  p: { qualificationId: string; requestId: string; organizationId?: string },
  at: string,
  starting = false,
) {
  const r = s.planningRequests.find((r) => r.id === p.requestId);
  const q = s.qualifications.find((q) => q.id === p.qualificationId);
  if (
    !r ||
    !q ||
    r.learnerId !== u.id ||
    r.organizationId !== u.organizationId ||
    (p.organizationId && p.organizationId !== u.organizationId)
  )
    return ["현재 소속의 본인 계획 요청을 확인해 주세요."];
  if (u.certificationEligibility === "hold" || !u.organizationActive)
    return ["취득 대상자 Hold 또는 사용 중지된 소속입니다."];
  if (r.qualificationType !== q.qualificationType)
    return ["요청과 자격의 인증 유형이 다릅니다."];
  if (r.completion || r.closed)
    return ["완료되거나 종료된 계획 요청입니다. 새 요청을 확인해 주세요."];
  const c = candidate(s, doc, u, q.entityId, at, r);
  if (!c.selected && !(starting && r.mode === "learner_choice"))
    return ["이 요청에 포함된 자격이 아닙니다. 요청 범위를 확인해 주세요."];
  if (
    !currentTeamQualifications(s).some(
      (v) =>
        v.lv1OrganizationId === u.lv1OrganizationId &&
        v.entityId === q.entityId &&
        v.qualificationId === q.id,
    )
  )
    return [
      "현재 기준 버전이 변경되었습니다. 현재 버전으로 계획을 다시 작성해 주세요.",
    ];
  if (c.status === "blocked") return [c.reason];
  return qualificationUseErrors(currentQualification(s, q), s.courses);
}
