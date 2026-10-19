import { randomUUID } from "node:crypto";
import {
  daysUntil,
  kstDate,
  type State,
  type Notification,
} from "@eks/contracts";

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
  s.notifications.push({ ...input, id: randomUUID(), createdAt: at });
}
// Pure, clock-injected reconciliation. The store commits this through the common queue.
export function reconcileNotifications(
  s: State,
  at = new Date().toISOString(),
): boolean {
  const before = s.notifications.length;
  for (const c of s.certifications) {
    const a = s.assignments.find((a) => a.id === c.assignmentId)!;
    if (a.excludedReason || !c.expiresOn || c.validity?.type !== "months")
      continue;
    const remaining = daysUntil(c.expiresOn, at);
    const threshold = [...c.validity.reminderDays]
      .sort((a, b) => a - b)
      .find((d) => remaining <= d);
    if (remaining >= 0 && threshold === undefined) continue;
    const milestone = remaining < 0 ? "expired" : String(threshold);
    const due =
      remaining < 0
        ? new Date(Date.parse(c.expiresOn) + 86400000)
            .toISOString()
            .slice(0, 10)
        : new Date(Date.parse(c.expiresOn) - threshold! * 86400000)
            .toISOString()
            .slice(0, 10);
    notify(
      s,
      {
        key: `expiry:${c.id}:${milestone}`,
        recipientId: c.learnerId,
        lv1OrganizationId: a.lv1OrganizationId,
        assignmentId: a.id,
        certificationId: c.id,
        type: remaining < 0 ? "expired" : "expiry",
        title:
          remaining < 0
            ? "자격 유효기간이 만료되었습니다"
            : "자격 만료가 예정되어 있습니다",
        body: `${c.snapshot?.title || s.qualifications.find((q) => q.id === c.qualificationId)!.title} · 만료일 ${c.expiresOn}`,
        href: `/certifications/${a.id}`,
        scheduledOn: due < kstDate(c.date) ? kstDate(c.date) : due,
      },
      at,
    );
  }
  return before !== s.notifications.length;
}
