import { currentQualification } from "./qualification-templates.ts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  LifecycleStatusSchema,
  ValiditySchema,
  validityErrors,
  effectiveCredentialStatus,
  credentialCurrent,
  latestPeriod,
  renewalOpensOn,
  periodExpiry,
  addCalendarDays,
  expiryEffectiveAt,
  kstDate,
  qualificationUseErrors,
  organizationEntries,
  type State,
  type UserView,
  type OrganizationDocument,
  type Certification,
  type LifecycleEvent,
  type Qualification,
  type StoredAssignment,
} from "@eks/contracts";
import { demand } from "./errors.ts";
import { managementScope } from "./management.ts";
import { fullManager, policyScope } from "./organization-administrators.ts";
import { userView } from "./organizations.ts";
import { notify } from "./notifications.ts";

const reason = z.string().trim().min(1, "변경 사유를 입력해 주세요.").max(2000);
const find = <T extends { id: string }>(xs: T[], id: string): T => {
  const item = xs.find((x) => x.id === id);
  demand(item, 404, "기록을 찾을 수 없습니다.");
  return item;
};
export function checkRevision(actual: number, requested: unknown) {
  demand(
    actual === requested,
    409,
    "다른 창에서 변경되었습니다. 입력을 보관하고 최신 내용을 다시 확인해 주세요.",
    "REVISION_CONFLICT",
  );
}
export function requireEligible(u: { certificationEligibility?: string }) {
  demand(
    u.certificationEligibility !== "hold",
    409,
    "취득 대상자 Hold 상태입니다. 입력은 보존되며 관리자 해제 후 계속할 수 있습니다.",
    "TARGET_ON_HOLD",
  );
}
export function openAssignment(s: State, a: StoredAssignment, at: string) {
  if (a.excludedReason || a.acquisitionClosedAt) return false;
  const c = s.certifications.find((c) => c.assignmentId === a.id);
  return !c || effectiveCredentialStatus(c, at) !== "Revoke";
}
export function lastRevoked(
  s: State,
  learnerId: string,
  entityId: string,
  at: string,
) {
  return s.certifications
    .filter(
      (c) =>
        c.learnerId === learnerId &&
        s.qualifications.find((q) => q.id === c.qualificationId)?.entityId ===
          entityId &&
        effectiveCredentialStatus(c, at) === "Revoke",
    )
    .at(-1);
}
export function lifecycleEvent(s: State, input: Omit<LifecycleEvent, "id">) {
  s.lifecycleEvents.push({
    id: randomUUID(),
    ...JSON.parse(JSON.stringify(input)),
  });
}
export function initializeCertification(
  s: State,
  c: Certification,
  q: Qualification,
  at: string,
  migration = false,
) {
  const a = find(s.assignments, c.assignmentId);
  const validity = structuredClone(
    c.validity || { type: "unknown" as const, months: null, reminderDays: [] },
  );
  c.revision = 1;
  c.periods = [
    {
      id: `${c.id}:period:1`,
      sequence: 1,
      kind: "initial",
      qualificationId: q.id,
      qualificationVersion: q.version,
      validity,
      renewalLeadMonths: q.renewalLeadMonths ?? 3,
      renewalNoticeDaysBefore: q.renewalNoticeDaysBefore ?? 7,
      startsOn: kstDate(c.date),
      baseOn: kstDate(c.date),
      ...(c.expiresOn ? { expiresOn: c.expiresOn } : {}),
      completedAt: c.date,
      source: migration ? "migration" : "issued",
    },
  ];
  c.lifecycleStatus = validity.type === "unknown" ? "Hold" : "Active";
  c.validityNeedsCorrection = validity.type === "unknown";
  if (a.previousCertificationId)
    c.previousCertificationId = a.previousCertificationId;
  lifecycleEvent(s, {
    subject: "certification",
    targetId: c.id,
    lv1OrganizationId: a.lv1OrganizationId,
    actorId: migration ? "system" : c.learnerId,
    action: "acquired",
    reason: migration ? "기존 취득 근거 보존 이관" : "필수 인증Set 전체 수료",
    effectiveAt: c.date,
    recordedAt: at,
    assignmentId: a.id,
    before: null,
    after: {
      status: c.lifecycleStatus,
      date: c.date,
      expiresOn: c.expiresOn || null,
      source: migration ? "migration" : "issued",
    },
  });
}
function closeRenewals(
  s: State,
  certificationId: string,
  at: string,
  why: string,
) {
  for (const r of s.renewals.filter(
    (r) => r.certificationId === certificationId && r.status === "draft",
  )) {
    r.status = "closed";
    r.closedAt = at;
    r.closeReason = why;
    r.revision++;
  }
}
function credentialNotice(
  s: State,
  c: Certification,
  at: string,
  action: string,
  body: string,
  key: string,
) {
  const a = find(s.assignments, c.assignmentId);
  notify(
    s,
    {
      key,
      recipientId: c.learnerId,
      lv1OrganizationId: a.lv1OrganizationId,
      assignmentId: a.id,
      certificationId: c.id,
      periodId: latestPeriod(c)?.id,
      type:
        action === "renewal.completed"
          ? "renewal"
          : action === "expired"
            ? "expired"
            : "lifecycle",
      title:
        action === "renewal.completed"
          ? "자격 재인증을 완료했습니다"
          : "보유 자격 상태가 변경되었습니다",
      body,
      href: `/certifications/${a.id}`,
    },
    at,
  );
}
export function reconcileLifecycle(s: State, at: string): boolean {
  let changed = false;
  for (const c of s.certifications) {
    if (
      c.lifecycleStatus === "Revoke" ||
      effectiveCredentialStatus(c, at) !== "Revoke"
    )
      continue;
    const a = find(s.assignments, c.assignmentId),
      end = credentialCurrent(c).expiresOn!;
    const before = c.lifecycleStatus || "Active";
    c.lifecycleStatus = "Revoke";
    c.revision = (c.revision || 1) + 1;
    closeRenewals(s, c.id, at, "재인증 기간 종료");
    lifecycleEvent(s, {
      subject: "certification",
      targetId: c.id,
      lv1OrganizationId: a.lv1OrganizationId,
      actorId: "system",
      action: "expired",
      reason: "만료일까지 갱신하지 않아 자동 폐기",
      effectiveAt: expiryEffectiveAt(end),
      recordedAt: at,
      assignmentId: a.id,
      before,
      after: "Revoke",
    });
    credentialNotice(
      s,
      c,
      at,
      "expired",
      `${c.snapshot?.title || "자격"} · Revoke · 만료일 ${end} · 다시 취득하려면 새 계획 요청이 필요합니다.`,
      `revoke:${c.id}:${latestPeriod(c)?.id}`,
    );
    changed = true;
  }
  return changed;
}
function manageCredential(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  id: string,
  requested?: string,
) {
  const c = find(s.certifications, id),
    a = find(s.assignments, c.assignmentId);
  const scope = managementScope(u, doc, requested);
  demand(
    scope === a.lv1OrganizationId,
    403,
    "관리 대상 Lv1의 보유 자격만 처리할 수 있습니다.",
  );
  return { c, a, scope };
}
function readCredential(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  id: string,
  requested?: string,
  ownOnly = false,
) {
  const c = find(s.certifications, id),
    a = find(s.assignments, c.assignmentId);
  if (
    u.roles.includes("learner") &&
    c.learnerId === u.id &&
    a.lv1OrganizationId === u.lv1OrganizationId
  )
    return { c, a, scope: a.lv1OrganizationId };
  demand(!ownOnly, 403, "본인의 재인증만 처리할 수 있습니다.");
  return manageCredential(s, doc, u, id, requested);
}
function eligibilityUsers(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  requested?: string,
) {
  const scope = policyScope(u, doc, requested);
  const users = s.users.filter(
    (x) =>
      x.roles.includes("learner") &&
      userView(x, doc).lv1OrganizationId === scope &&
      (fullManager(u) || x.organizationId === u.organizationId),
  );
  return { scope, users };
}
export function targetsView(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  scope?: string,
) {
  const result = eligibilityUsers(s, doc, u, scope);
  return {
    revision: s.revision,
    lv1OrganizationId: result.scope,
    users: result.users.map((x) => ({
      id: x.id,
      name: x.name,
      organizationId: x.organizationId,
      organizationPath: userView(x, doc).organizationPath,
      revision: x.revision,
      eligibility: x.certificationEligibility || "eligible",
      progressCount: s.assignments.filter(
        (a) =>
          a.learnerId === x.id &&
          !a.excludedReason &&
          !s.certifications.some((c) => c.assignmentId === a.id),
      ).length,
      renewalCount: s.renewals.filter(
        (r) => r.learnerId === x.id && r.status === "draft",
      ).length,
      lastChange: s.lifecycleEvents
        .filter((e) => e.subject === "eligibility" && e.targetId === x.id)
        .at(-1),
    })),
  };
}
export function qualificationImpact(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  id: string,
  requested?: string,
) {
  const scope = managementScope(u, doc, requested),
    q = find(s.qualifications, id);
  demand(
    q.lv1OrganizationId === scope,
    403,
    "관리 대상 Lv1의 자격만 처리할 수 있습니다.",
  );
  return {
    qualification: q,
    revision: s.revision,
    organizationRevision: doc.revision,
    counts: {
      organizations: doc.qualificationPools.some(
        (p) => p.qualificationId === id,
      )
        ? organizationEntries(doc).filter(
            (e) =>
              e.lv1OrganizationId === scope &&
              e.requiredQualifications?.includes(q.entityId),
          ).length
        : 0,
      draftPlans: s.plans.filter(
        (p) => p.qualificationId === id && p.status === "draft" && !p.deletedAt,
      ).length,
      assignments: s.assignments.filter(
        (a) => a.qualificationId === id && !a.excludedReason,
      ).length,
      certifications: s.certifications.filter((c) => c.qualificationId === id)
        .length,
      renewals: s.renewals.filter(
        (r) => r.qualificationId === id && r.status === "draft",
      ).length,
    },
    events: s.lifecycleEvents.filter(
      (e) => e.subject === "qualification" && e.targetId === id,
    ),
  };
}
export function renewalAvailability(
  s: State,
  doc: OrganizationDocument,
  c: Certification,
  at: string,
) {
  const learner = userView(find(s.users, c.learnerId), doc),
    original = find(s.qualifications, c.qualificationId);
  const pool = doc.qualificationPools.find(
    (p) =>
      p.lv1OrganizationId === learner.lv1OrganizationId &&
      p.entityId === original.entityId,
  );
  const q = s.qualifications.find((q) => q.id === pool?.qualificationId),
    p = latestPeriod(c);
  const opensOn = p && renewalOpensOn(p);
  const errors: string[] = [];
  if (!learner.roles.includes("learner") || !learner.organizationActive)
    errors.push("사용 중인 조직의 학습자 권한이 필요합니다.");
  if (learner.certificationEligibility === "hold")
    errors.push("취득 대상자 Hold 상태입니다.");
  if (effectiveCredentialStatus(c, at) !== "Active")
    errors.push("Active인 개인 보유 자격만 재인증할 수 있습니다.");
  if (find(s.assignments, c.assignmentId).excludedReason)
    errors.push("검증에서 제외된 배정입니다.");
  if (!p || p.validity.type !== "months")
    errors.push("기간제 보유 자격만 정기 재인증을 진행합니다.");
  if (opensOn && kstDate(at) < opensOn)
    errors.push(`${opensOn}부터 재인증할 수 있습니다.`);
  if (!q || q.deletedAt)
    errors.push("팀 적용 기준이 없습니다. 관리자 확인이 필요합니다.");
  else
    errors.push(
      ...qualificationUseErrors(currentQualification(s, q), s.courses),
    );
  return {
    canStart: !errors.length,
    reasons: errors,
    opensOn,
    periodId: p?.id,
    appliedQualification: q
      ? {
          id: q.id,
          title: currentQualification(s, q).title,
          version: q.version,
          revision: q.revision,
          validity: q.validity,
          renewalLeadMonths: q.renewalLeadMonths ?? 3,
          renewalNoticeDaysBefore: q.renewalNoticeDaysBefore ?? 7,
        }
      : null,
    nextExpiresOn:
      p?.expiresOn && q ? periodExpiry(p.expiresOn, q.validity) : undefined,
    renewal: s.renewals.find(
      (r) =>
        r.certificationId === c.id &&
        r.periodId === p?.id &&
        r.status === "draft",
    ),
  };
}
export function certificationHistory(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  id: string,
  requested: string | undefined,
  at: string,
) {
  const { c, a } = readCredential(s, doc, u, id, requested);
  return {
    certification: c,
    effectiveStatus: effectiveCredentialStatus(c, at),
    current: credentialCurrent(c),
    periods: c.periods || [],
    events: s.lifecycleEvents.filter(
      (e) => e.subject === "certification" && e.targetId === id,
    ),
    renewals: s.renewals.filter((r) => r.certificationId === id),
    renewal: renewalAvailability(s, doc, c, at),
    canManage:
      fullManager(u) &&
      (u.roles.includes("system_operator")
        ? requested === a.lv1OrganizationId
        : u.lv1OrganizationId === a.lv1OrganizationId),
    canRenew: u.roles.includes("learner") && u.id === c.learnerId,
  };
}
// Only access checks precede idempotency replay. All mutable-state checks run inside update.
export function authorizeLifecycle(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  action: string,
  id: string,
  body: any,
  requested?: string,
) {
  if (action === "qualification.lifecycle")
    return qualificationImpact(s, doc, u, id, requested).qualification
      .lv1OrganizationId;
  if (action === "eligibility.change") {
    const { users, scope } = eligibilityUsers(s, doc, u, requested);
    const ids = z.array(z.string()).min(1).max(10000).parse(body.userIds);
    demand(
      ids.every((id) => users.some((x) => x.id === id)),
      403,
      "관리 가능한 직접 소속 대상자만 선택해 주세요.",
    );
    return scope;
  }
  if (action === "credential.status" || action === "credential.validity")
    return manageCredential(s, doc, u, id, requested).scope;
  const certId =
    action === "renewal.complete" ? find(s.renewals, id).certificationId : id;
  return readCredential(s, doc, u, certId, requested, true).scope;
}
export function executeLifecycle(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  action: string,
  id: string,
  body: any,
  scope: string,
  at: string,
): any {
  const event = (
    subject: LifecycleEvent["subject"],
    targetId: string,
    eventAction: string,
    why: string,
    before: any,
    after: any,
    assignmentId?: string,
  ) =>
    lifecycleEvent(s, {
      subject,
      targetId,
      lv1OrganizationId: scope,
      actorId: u.id,
      organizationId:
        subject === "eligibility"
          ? find(s.users, targetId).organizationId
          : subject === "certification"
            ? find(s.users, find(s.certifications, targetId).learnerId)
                .organizationId
            : scope,
      action: eventAction,
      reason: why,
      before,
      after,
      assignmentId,
      effectiveAt: at,
      recordedAt: at,
    });
  if (action === "qualification.lifecycle") {
    const input = z
      .object({
        status: LifecycleStatusSchema,
        reason,
        revision: z.number().int(),
        stateRevision: z.number().int(),
        organizationRevision: z.number().int(),
      })
      .strict()
      .parse(body);
    const q = find(s.qualifications, id);
    demand(
      !q.deletedAt,
      409,
      "삭제된 기준은 조회만 할 수 있습니다.",
      "CATALOG_DELETED",
    );
    checkRevision(q.revision, input.revision);
    checkRevision(s.revision, input.stateRevision);
    checkRevision(doc.revision, input.organizationRevision);
    demand(
      q.lifecycleStatus !== "Revoke",
      409,
      "폐기한 기준은 새 버전을 작성하고 팀 적용 버전을 선택해 주세요.",
    );
    const before = q.lifecycleStatus || "Active";
    demand(before !== input.status, 409, "이미 같은 상태입니다.");
    q.lifecycleStatus = input.status;
    q.revision++;
    event(
      "qualification",
      id,
      "status.changed",
      input.reason,
      before,
      input.status,
    );
    return { id, revision: q.revision };
  }
  if (action === "eligibility.change") {
    const input = z
      .object({
        userIds: z.array(z.string()).min(1),
        eligibility: z.enum(["eligible", "hold"]),
        reason,
        revision: z.number().int(),
      })
      .strict()
      .parse(body);
    checkRevision(s.revision, input.revision);
    demand(
      new Set(input.userIds).size === input.userIds.length,
      422,
      "중복 대상자입니다.",
    );
    for (const id of input.userIds) {
      const x = find(s.users, id),
        before = x.certificationEligibility || "eligible";
      if (before === input.eligibility) continue;
      x.certificationEligibility = input.eligibility;
      x.revision++;
      event(
        "eligibility",
        id,
        "eligibility.changed",
        input.reason,
        before,
        input.eligibility,
      );
      notify(
        s,
        {
          key: `eligibility:${id}:${x.revision}`,
          recipientId: id,
          lv1OrganizationId: scope,
          type: "lifecycle",
          title:
            input.eligibility === "hold"
              ? "취득 대상자 Hold로 변경되었습니다"
              : "취득 대상자 Hold가 해제되었습니다",
          body: input.reason,
          href: "/qualifications",
        },
        at,
      );
    }
    return { userIds: input.userIds, revision: s.revision + 1 };
  }
  if (action === "credential.status" || action === "credential.validity") {
    const c = find(s.certifications, id),
      a = find(s.assignments, c.assignmentId);
    checkRevision(c.revision || 1, body.revision);
    demand(
      effectiveCredentialStatus(c, at) !== "Revoke",
      409,
      "폐기된 자격은 다시 취득해야 합니다.",
      "CERTIFICATION_REVOKED",
    );
    const why = reason.parse(body.reason),
      before = {
        status: c.lifecycleStatus || "Active",
        current: credentialCurrent(c),
      };
    if (action === "credential.validity") {
      const input = z
        .object({
          revision: z.number().int(),
          reason,
          evidence: reason,
          validity: ValiditySchema,
          renewalLeadMonths: z.number().int().min(1).max(1200),
          renewalNoticeDaysBefore: z.number().int().min(0).max(365).default(7),
        })
        .strict()
        .parse(body);
      demand(
        c.validityNeedsCorrection && c.periods?.length === 1,
        409,
        "이관된 기간 미정 기록만 근거를 확인하여 정정할 수 있습니다.",
      );
      demand(
        !validityErrors(input.validity).length,
        422,
        validityErrors(input.validity).join(" · "),
      );
      const p = c.periods![0]!;
      p.validity = structuredClone(input.validity);
      p.renewalLeadMonths = input.renewalLeadMonths;
      p.renewalNoticeDaysBefore = input.renewalNoticeDaysBefore;
      p.expiresOn = periodExpiry(p.baseOn, input.validity);
      c.validity = structuredClone(input.validity);
      c.expiresOn = p.expiresOn;
      c.validityNeedsCorrection = false;
      c.lifecycleStatus = "Active";
      event(
        "certification",
        id,
        "validity.corrected",
        `${why}\n근거: ${input.evidence}`,
        before,
        { status: "Active", period: p },
        a.id,
      );
      reconcileLifecycle(s, at);
    } else {
      const input = z
        .object({
          revision: z.number().int(),
          reason,
          status: LifecycleStatusSchema,
        })
        .strict()
        .parse(body);
      demand(
        !c.validityNeedsCorrection || input.status === "Revoke",
        409,
        "유효기간 근거를 먼저 확인·정정해 주세요.",
      );
      demand(input.status !== c.lifecycleStatus, 409, "이미 같은 상태입니다.");
      c.lifecycleStatus = input.status;
      if (input.status === "Revoke") closeRenewals(s, id, at, "관리자 폐기");
      event(
        "certification",
        id,
        "status.changed",
        why,
        before,
        { status: c.lifecycleStatus },
        a.id,
      );
    }
    c.revision = (c.revision || 1) + 1;
    credentialNotice(
      s,
      c,
      at,
      action,
      `${c.lifecycleStatus} · ${why}`,
      `${action}:${c.id}:${c.revision}`,
    );
    return { id, revision: c.revision };
  }
  const r = action === "renewal.complete" ? find(s.renewals, id) : undefined;
  const c = find(s.certifications, r?.certificationId || id),
    a = find(s.assignments, c.assignmentId);
  requireEligible(find(s.users, c.learnerId));
  checkRevision(c.revision || 1, body.certificationRevision);
  const available = renewalAvailability(s, doc, c, at);
  demand(
    available.canStart,
    409,
    available.reasons.join(" · "),
    "RENEWAL_UNAVAILABLE",
  );
  const q = find(s.qualifications, available.appliedQualification!.id),
    p = latestPeriod(c)!;
  if (action === "renewal.start") {
    z.object({ certificationRevision: z.number().int() }).strict().parse(body);
    const existing = available.renewal;
    if (
      existing &&
      existing.qualificationId === q.id &&
      existing.qualificationRevision === q.revision
    )
      return {
        id: existing.id,
        revision: existing.revision,
        certificationRevision: c.revision,
      };
    if (existing) {
      existing.status = "closed";
      existing.closedAt = at;
      existing.closeReason = "적용 기준 변경";
      existing.revision++;
    }
    const renewal = {
      id: randomUUID(),
      certificationId: c.id,
      periodId: p.id,
      learnerId: c.learnerId,
      lv1OrganizationId: scope,
      qualificationId: q.id,
      qualificationRevision: q.revision,
      validity: structuredClone(q.validity),
      renewalLeadMonths: q.renewalLeadMonths ?? 3,
      renewalNoticeDaysBefore: q.renewalNoticeDaysBefore ?? 7,
      revision: 1,
      status: "draft" as const,
      startedAt: at,
      method: "mvp_completion" as const,
    };
    s.renewals.push(renewal);
    c.revision = (c.revision || 1) + 1;
    event(
      "certification",
      c.id,
      "renewal.started",
      "MVP 종합평가 시작",
      null,
      renewal,
      a.id,
    );
    return {
      id: renewal.id,
      revision: renewal.revision,
      certificationRevision: c.revision,
    };
  }
  const input = z
    .object({
      certificationRevision: z.number().int(),
      revision: z.number().int(),
      confirmation: z.literal("종합평가 완료"),
    })
    .strict()
    .parse(body);
  checkRevision(r!.revision, input.revision);
  demand(
    r!.status === "draft" &&
      r!.periodId === p.id &&
      r!.qualificationId === q.id &&
      r!.qualificationRevision === q.revision,
    409,
    "재인증 기준 또는 회차가 변경되었습니다. 최신 적용 기준을 확인하고 다시 시작해 주세요.",
    "RENEWAL_CRITERIA_CHANGED",
  );
  demand(
    !s.renewals.some(
      (x) =>
        x.certificationId === c.id &&
        x.periodId === p.id &&
        x.status === "completed",
    ),
    409,
    "이미 갱신한 회차입니다.",
  );
  const next = {
    id: randomUUID(),
    sequence: p.sequence + 1,
    kind: "renewal" as const,
    qualificationId: q.id,
    qualificationVersion: q.version,
    validity: structuredClone(r!.validity),
    renewalLeadMonths: r!.renewalLeadMonths,
    renewalNoticeDaysBefore: r!.renewalNoticeDaysBefore ?? 7,
    startsOn: addCalendarDays(p.expiresOn!, 1),
    baseOn: p.expiresOn!,
    ...(periodExpiry(p.expiresOn!, r!.validity)
      ? { expiresOn: periodExpiry(p.expiresOn!, r!.validity) }
      : {}),
    completedAt: at,
    previousPeriodId: p.id,
    renewalId: r!.id,
    source: "issued" as const,
  };
  c.periods!.push(next);
  c.revision = (c.revision || 1) + 1;
  r!.status = "completed";
  r!.completedAt = at;
  r!.revision++;
  for (const n of s.notifications.filter(
    (n) => n.certificationId === c.id && ["renewal", "expiry"].includes(n.type),
  ))
    n.resolvedAt ||= at;
  event(
    "certification",
    c.id,
    "renewal.completed",
    "MVP 완료 버튼으로 처리 · 실제 종합평가 점수 없음",
    p,
    next,
    a.id,
  );
  credentialNotice(
    s,
    c,
    at,
    "renewal.completed",
    `MVP 완료 버튼으로 처리 · 새 만료일 ${next.expiresOn || "무기한"}`,
    `renewal:completed:${r!.id}`,
  );
  return {
    id: r!.id,
    certificationId: c.id,
    expiresOn: next.expiresOn,
    revision: c.revision,
  };
}
