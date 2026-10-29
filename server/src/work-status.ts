import { randomUUID } from "node:crypto";
import {
  effectiveCredentialStatus,
  kstDate,
  organizationEntries,
  workDeactive,
  workRevokesOn,
  WORK_DEACTIVE_MESSAGE,
  type State,
  type User,
  type UserView,
  type OrganizationDocument,
  type WorkStatusInfo,
} from "@eks/contracts";
import { demand } from "./errors.ts";
import { managementScope } from "./management.ts";
import { userView } from "./organizations.ts";
import { notify } from "./notifications.ts";

export function requireWorkActive(u: User, type = "auditee") {
  demand(!workDeactive(u, type), 409, WORK_DEACTIVE_MESSAGE, "WORK_DEACTIVE");
}
export function workTargets(s: State, userId: string, team: string) {
  const assignments = s.assignments.filter(
    (a) =>
      a.learnerId === userId &&
      a.lv1OrganizationId === team &&
      s.qualifications.find((q) => q.id === a.qualificationId)
        ?.qualificationType === "auditee",
  );
  const ids = new Set(assignments.map((a) => a.id));
  return {
    assignments,
    certifications: s.certifications.filter(
      (c) => c.learnerId === userId && ids.has(c.assignmentId),
    ),
    requests: s.planningRequests.filter(
      (r) =>
        r.learnerId === userId &&
        r.lv1OrganizationId === team &&
        r.qualificationType === "auditee" &&
        !r.completion &&
        !r.closed,
    ),
    renewals: s.renewals.filter(
      (r) =>
        r.learnerId === userId &&
        r.lv1OrganizationId === team &&
        r.status === "draft" &&
        s.qualifications.find((q) => q.id === r.qualificationId)
          ?.qualificationType === "auditee",
    ),
    batches: s.renewalBatches.filter(
      (b) =>
        b.learnerId === userId &&
        b.lv1OrganizationId === team &&
        (b.status === "evaluating" || b.status === "passed"),
    ),
  };
}
export function authorizeWorkStatus(
  s: State,
  doc: OrganizationDocument,
  actor: UserView,
  id: string,
  requested?: string,
) {
  const team = managementScope(actor, doc, requested);
  const target = s.users.find((u) => u.id === id);
  demand(
    target && userView(target, doc).lv1OrganizationId === team,
    403,
    "관리 대상 팀의 조직원만 변경할 수 있습니다.",
  );
  demand(
    actor.roles.includes("system_operator") ||
      !target.roles.includes("system_operator"),
    403,
    "시스템 운영자 계정은 시스템 운영자가 관리합니다.",
  );
  return { target, team };
}
export function workStatusInfo(
  s: State,
  doc: OrganizationDocument,
  actor: UserView,
  target: User,
  at: string,
): WorkStatusInfo {
  const team = userView(target, doc).lv1OrganizationId;
  const validCertifications = workTargets(
    s,
    target.id,
    team,
  ).certifications.filter(
    (c) => effectiveCredentialStatus(c, at) === "Active",
  ).length;
  const canChange =
    actor.roles.includes("system_operator") ||
    (actor.roles.includes("admin") &&
      actor.lv1OrganizationId === team &&
      !target.roles.includes("system_operator"));
  const d = target.workDeactivation;
  return {
    status: target.workStatus || "active",
    startedOn: d?.startedOn,
    revokesOn: d?.revokesOn,
    reacquisitionRequired: !!d?.processedTeams.some(
      (t) => t.lv1OrganizationId === team,
    ),
    canChange,
    canDeactivate: canChange && validCertifications > 0,
    validCertifications,
    blockedReason: !canChange
      ? "업무 상태 변경 권한이 없습니다."
      : !validCertifications
        ? "현재 팀의 유효 Auditee 인증이 1개 이상 있어야 Deactive로 변경할 수 있습니다."
        : undefined,
  };
}
export function workNotice(
  s: State,
  doc: OrganizationDocument,
  user: User,
  team: string,
  at: string,
  key: string,
  title: string,
  body: string,
) {
  const recipients = new Set([
    user.id,
    ...s.users
      .filter(
        (u) =>
          u.roles.includes("system_operator") ||
          (u.roles.includes("admin") &&
            userView(u, doc).lv1OrganizationId === team),
      )
      .map((u) => u.id),
  ]);
  for (const recipientId of recipients)
    notify(
      s,
      {
        key,
        recipientId,
        lv1OrganizationId: team,
        type: "lifecycle",
        qualificationType: "auditee",
        title,
        body,
        href: recipientId === user.id ? "/qualifications" : "/admin/users",
      },
      at,
    );
}
/** Called inside the shared store queue. Never deletes or rewrites frozen evidence. */
export function reconcileWorkStatus(
  s: State,
  doc: OrganizationDocument,
  at: string,
): boolean {
  let changed = false;
  const orgs = new Map(organizationEntries(doc).map((o) => [o.id, o]));
  for (const u of s.users) {
    const d = u.workDeactivation,
      team = orgs.get(u.organizationId)?.lv1OrganizationId;
    if (!workDeactive(u) || !d || !team || d.revokesOn > kstDate(at)) continue;
    const targets = workTargets(s, u.id, team);
    const certs = targets.certifications.filter(
      (c) => c.lifecycleStatus !== "Revoke",
    );
    const assignments = targets.assignments.filter(
      (a) => !a.acquisitionClosedAt,
    );
    if (
      d.processedTeams.some((t) => t.lv1OrganizationId === team) &&
      !certs.length &&
      !assignments.length &&
      !targets.requests.length &&
      !targets.renewals.length &&
      !targets.batches.length
    )
      continue;
    const effectiveAt = new Date(`${d.revokesOn}T00:00:00+09:00`).toISOString();
    const reason = "연속 업무 미수행 6개월 초과 · 복귀 후 새 계획과 평가 필요";
    for (const c of certs) {
      const before = c.lifecycleStatus;
      c.lifecycleStatus = "Revoke";
      c.revision = (c.revision || 1) + 1;
      s.lifecycleEvents.push({
        id: randomUUID(),
        subject: "certification",
        targetId: c.id,
        actorId: "system",
        lv1OrganizationId: team,
        organizationId: u.organizationId,
        action: "work-inactivity.revoked",
        reason,
        effectiveAt,
        recordedAt: at,
        assignmentId: c.assignmentId,
        before: before || "Active",
        after: { status: "Revoke", episodeId: d.id },
      });
    }
    for (const r of targets.requests) {
      r.closed = { date: at, actorId: "system", reason };
      r.revision++;
      for (const n of s.notifications.filter(
        (n) => n.key === `planning:${r.id}` && !n.resolvedAt,
      ))
        n.resolvedAt = at;
    }
    for (const a of assignments) {
      a.acquisitionClosedAt = at;
      a.revision++;
    }
    for (const r of targets.renewals) {
      r.status = "closed";
      r.closedAt = at;
      r.closeReason = reason;
      r.revision++;
    }
    for (const b of targets.batches) {
      b.status = "closed";
      b.closedAt = at;
      b.revision++;
    }
    if (!d.processedTeams.some((t) => t.lv1OrganizationId === team))
      d.processedTeams.push({ lv1OrganizationId: team, processedAt: at });
    u.revision++;
    s.lifecycleEvents.push({
      id: randomUUID(),
      subject: "work_status",
      targetId: u.id,
      actorId: "system",
      lv1OrganizationId: team,
      organizationId: u.organizationId,
      action: "work-inactivity.processed",
      reason,
      effectiveAt,
      recordedAt: at,
      before: "deactive",
      after: {
        episodeId: d.id,
        status: "deactive",
        certificationIds: certs.map((c) => c.id),
        assignmentIds: assignments.map((a) => a.id),
        requestIds: targets.requests.map((r) => r.id),
      },
    });
    workNotice(
      s,
      doc,
      u,
      team,
      at,
      `work-revoked:${d.id}:${team}`,
      "업무 미수행으로 Auditee 인증이 말소되었습니다",
      `${u.name} · ${reason}`,
    );
    changed = true;
  }
  return changed;
}
export function validateWorkStatus(s: State) {
  if (s.schemaVersion < 30) return;
  for (const u of s.users) {
    if (!u.workStatus)
      throw Error("사용자 업무 상태 누락 · 명시적 이관이 필요합니다.");
    const d = u.workDeactivation;
    if (
      u.workStatus === "deactive" &&
      (!d ||
        d.startedOn !== kstDate(d.startedAt) ||
        d.revokesOn !== workRevokesOn(d.startedOn))
    )
      throw Error("업무 미수행 기간 근거가 올바르지 않습니다.");
    if (u.workStatus === "active" && d)
      throw Error("Active 사용자의 미수행 구간을 확인해 주세요.");
  }
}
