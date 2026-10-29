import { workDeactive } from "@eks/contracts";
import { randomUUID } from "node:crypto";
import {
  kstDate,
  latestPeriod,
  credentialCurrent,
  effectiveCredentialStatus,
  renewalOpensOn,
  renewalNoticeOn,
  type State,
  type Notification,
} from "@eks/contracts";
import { reconcileLifecycle } from "./qualification-lifecycle.ts";

export function notify(
  s: State,
  input: Omit<Notification, "id" | "createdAt">,
  at = new Date().toISOString(),
) {
  if (
    s.notifications.some(
      (n) => n.key === input.key && n.recipientId === input.recipientId,
    )
  )
    return;
  const a = s.assignments.find((a) => a.id === input.assignmentId);
  const type =
    input.qualificationType ||
    (a &&
      s.qualifications.find((q) => q.id === a.qualificationId)
        ?.qualificationType);
  s.notifications.push({
    ...input,
    ...(type
      ? {
          qualificationType: type,
          title: `[${type === "auditor" ? "Auditor" : "Auditee"}] ${a?.auditor ? (a.auditor.level === "main" ? "메인 · " : "일반 · ") : ""}${input.title}`,
        }
      : {}),
    id: randomUUID(),
    createdAt: at,
  });
}
export function periodAlreadyNotified(
  s: State,
  certificationId: string,
  periodId: string,
) {
  return s.notifications.some(
    (n) =>
      n.certificationId === certificationId &&
      (n.periodId === periodId ||
        (!n.periodId &&
          s.certifications.find((c) => c.id === certificationId)?.periods?.[0]
            ?.id === periodId)) &&
      (n.key.startsWith("renewal:notice:") ||
        n.key.startsWith("renewal:open:") ||
        n.type === "expiry"),
  );
}
// Reconcile through the shared write queue with an injectable clock.
export function reconcileNotifications(
  s: State,
  at = new Date().toISOString(),
): boolean {
  const before = s.notifications.length;
  const lifecycleChanged = reconcileLifecycle(s, at);
  for (const original of s.certifications) {
    if (
      s.qualifications.find((q) => q.id === original.qualificationId)
        ?.qualificationType === "auditor" &&
      !original.auditor
    )
      continue;
    const c = { ...original, ...credentialCurrent(original) },
      a = s.assignments.find((a) => a.id === c.assignmentId)!,
      held =
        s.users.find((u) => u.id === c.learnerId)?.certificationEligibility ===
        "hold",
      period = latestPeriod(c);
    if (
      held ||
      workDeactive(
        s.users.find((u) => u.id === c.learnerId)!,
        s.qualifications.find((q) => q.id === c.qualificationId)
          ?.qualificationType,
      ) ||
      a.excludedReason ||
      !period ||
      effectiveCredentialStatus(c, at) !== "Active"
    )
      continue;
    const opensOn = renewalOpensOn(period),
      dueOn = renewalNoticeOn(period);
    if (
      !opensOn ||
      !dueOn ||
      dueOn > kstDate(at) ||
      periodAlreadyNotified(s, c.id, period.id)
    )
      continue;
    notify(
      s,
      {
        key: `renewal:notice:${c.id}:${period.id}`,
        recipientId: c.learnerId,
        lv1OrganizationId: a.lv1OrganizationId,
        assignmentId: a.id,
        certificationId: c.id,
        periodId: period.id,
        type: "renewal",
        title:
          opensOn > kstDate(at)
            ? "자격 재인증이 곧 시작됩니다"
            : "자격 재인증이 가능합니다",
        body: `${c.snapshot?.title || "자격"} · 재인증 시작 ${opensOn} · 만료일 ${c.expiresOn} · 적용 기준과 상태를 확인해 주세요.`,
        href: `/certifications/${a.id}`,
        scheduledOn: dueOn,
      },
      at,
    );
  }
  return lifecycleChanged || before !== s.notifications.length;
}
