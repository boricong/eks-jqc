import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  currentTeamQualifications,
  qualificationUseErrors,
  latestPeriod,
  periodExpiry,
  kstDate,
  type State,
  type UserView,
  type OrganizationDocument,
  type RenewalBatch,
  type RenewalBatchView,
  type RenewalCandidates,
} from "@eks/contracts";
import { demand } from "./errors.ts";
import { userView } from "./organizations.ts";
import {
  renewalAvailability,
  executeLifecycle,
  checkRevision,
  lifecycleEvent,
} from "./qualification-lifecycle.ts";
import { freezeCriteria } from "./releases.ts";
import { metadata, currentQualification } from "./qualification-templates.ts";
import type { JsonStore } from "./storage.ts";

function learner(u: UserView) {
  demand(
    u.roles.includes("learner"),
    403,
    "학습자만 재인증을 진행할 수 있습니다.",
  );
}
export function renewalOwner(s: State, u: UserView, id: string) {
  learner(u);
  const b = s.renewalBatches.find((b) => b.id === id);
  demand(b, 404, "재인증 회차를 찾을 수 없습니다.");
  demand(b.learnerId === u.id, 403, "본인의 재인증만 확인할 수 있습니다.");
  return b;
}
function audit(
  s: State,
  u: UserView,
  b: RenewalBatch,
  action: string,
  at: string,
) {
  s.audits.push({
    id: randomUUID(),
    actorId: u.id,
    date: at,
    action: `renewal-batch.${action}`,
    targetId: b.id,
    assignmentId: b.assignmentId,
    lv1OrganizationId: b.lv1OrganizationId,
    reason: "객관식 재인증",
    details: {
      targetIds: s.renewals
        .filter((r) => r.batchId === b.id)
        .map((r) => r.certificationId),
    },
  });
}
export function batchBlockers(
  s: State,
  doc: OrganizationDocument,
  b: RenewalBatch,
  at: string,
) {
  const u = userView(
      s.users.find((u) => u.id === b.learnerId)!,
      doc,
    ),
    q = s.qualifications.find((q) => q.id === b.qualificationId),
    a = s.assignments.find((a) => a.id === b.assignmentId);
  const reasons: string[] = [];
  if (workDeactive(u)) reasons.push(WORK_DEACTIVE_MESSAGE);
  if (
    !u.roles.includes("learner") ||
    !u.organizationActive ||
    u.lv1OrganizationId !== b.lv1OrganizationId
  )
    reasons.push("시작 당시 팀의 활성 학습자 권한이 필요합니다.");
  if (u.certificationEligibility === "hold")
    reasons.push("취득 대상자 Hold 상태입니다.");
  if (a?.excludedReason) reasons.push("검증에서 제외된 배정입니다.");
  if (!q || q.deletedAt) reasons.push("재인증 자격을 사용할 수 없습니다.");
  else
    reasons.push(
      ...qualificationUseErrors(currentQualification(s, q), s.courses),
    );
  return reasons;
}
function targetReasons(
  s: State,
  doc: OrganizationDocument,
  r: State["renewals"][number],
  at: string,
) {
  if (r.status !== "draft")
    return r.status === "closed" ? [r.closeReason || "종료된 대상입니다."] : [];
  const c = s.certifications.find((c) => c.id === r.certificationId)!;
  const av = renewalAvailability(s, doc, c, at),
    errors = [...av.reasons];
  if (
    s.assignments.find((a) => a.id === c.assignmentId)?.lv1OrganizationId !==
    r.lv1OrganizationId
  )
    errors.push("현재 팀에서 취득한 인증이 아닙니다.");
  if (latestPeriod(c)?.id !== r.periodId)
    errors.push("인증 회차가 변경되었습니다.");
  if (
    av.appliedQualification?.id !== r.qualificationId ||
    av.appliedQualification?.revision !== r.qualificationRevision
  )
    errors.push("시작 당시 갱신 기준이 변경되었습니다.");
  return errors;
}
export function renewalCandidates(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  at: string,
): RenewalCandidates {
  learner(u);
  const qs = currentTeamQualifications(s)
      .filter((p) => p.lv1OrganizationId === u.lv1OrganizationId)
      .map((p) => s.qualifications.find((q) => q.id === p.qualificationId)!)
      .filter(
        (q) =>
          q.purpose === "renewal" &&
          q.lifecycleStatus === "Active" &&
          !q.deletedAt,
      ),
    q = qs.length === 1 ? qs[0] : undefined;
  const reasons = q
    ? qualificationUseErrors(q, s.courses)
    : ["팀의 운영 가능한 재인증 자격이 준비되지 않았습니다."];
  if (!u.organizationActive) reasons.push("사용 중인 조직이 필요합니다.");
  if (workDeactive(u)) reasons.push(WORK_DEACTIVE_MESSAGE);
  if (u.certificationEligibility === "hold")
    reasons.push("취득 대상자 Hold 상태입니다.");
  if (
    s.renewalBatches.some(
      (b) =>
        b.learnerId === u.id &&
        b.lv1OrganizationId === u.lv1OrganizationId &&
        b.status === "evaluating",
    )
  )
    reasons.push("진행 중인 재인증 평가를 먼저 완료하거나 종료해 주세요.");
  const candidates = s.certifications
    .filter(
      (c) =>
        c.learnerId === u.id &&
        !c.auditor &&
        s.qualifications.find((q) => q.id === c.qualificationId)
          ?.qualificationType === "auditee" &&
        s.assignments.find((a) => a.id === c.assignmentId)
          ?.lv1OrganizationId === u.lv1OrganizationId,
    )
    .map((c) => {
      const v = renewalAvailability(s, doc, c, at),
        r = [...v.reasons];
      if (v.renewal) r.push("진행 중인 재인증 회차에 포함되어 있습니다.");
      return {
        certificationId: c.id,
        periodId: v.periodId,
        revision: c.revision || 1,
        title:
          c.qualificationMetadata?.title ||
          c.snapshot?.title ||
          s.qualifications.find((q) => q.id === c.qualificationId)!.title,
        expiresOn: latestPeriod(c)?.expiresOn,
        nextExpiresOn: v.nextExpiresOn,
        opensOn: v.opensOn,
        reasons: r,
      };
    });
  return {
    stateRevision: s.revision,
    organizationRevision: doc.revision,
    qualification: q
      ? {
          id: q.id,
          title: currentQualification(s, q).title,
          revision: q.revision,
        }
      : null,
    reasons,
    candidates,
    batches: s.renewalBatches
      .filter(
        (b) =>
          b.learnerId === u.id && b.lv1OrganizationId === u.lv1OrganizationId,
      )
      .slice()
      .reverse(),
  };
}
const selection = z
  .object({
    stateRevision: z.number().int(),
    organizationRevision: z.number().int(),
    qualificationId: z.string(),
    qualificationRevision: z.number().int(),
    certificationIds: z.array(z.string()).min(1).max(500),
  })
  .strict();
export function previewRenewalBatch(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  body: unknown,
  at: string,
) {
  const input = selection.parse(body),
    v = renewalCandidates(s, doc, u, at);
  checkRevision(s.revision, input.stateRevision);
  checkRevision(doc.revision, input.organizationRevision);
  demand(!v.reasons.length, 409, v.reasons.join(" · "));
  demand(
    v.qualification?.id === input.qualificationId &&
      v.qualification.revision === input.qualificationRevision,
    409,
    "재인증 기준을 다시 확인해 주세요.",
  );
  demand(
    new Set(input.certificationIds).size === input.certificationIds.length,
    422,
    "중복 대상을 선택할 수 없습니다.",
  );
  const targets = input.certificationIds.map((id) => {
    const c = v.candidates.find((c) => c.certificationId === id);
    demand(c, 403, "본인의 현재 팀 인증만 선택할 수 있습니다.");
    demand(!c.reasons.length, 409, `${c.title}: ${c.reasons.join(" · ")}`);
    return c;
  });
  return { qualification: v.qualification!, targets };
}
export function startRenewalBatch(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  body: unknown,
  at: string,
) {
  const preview = previewRenewalBatch(s, doc, u, body, at),
    q = s.qualifications.find((q) => q.id === preview.qualification.id)!;
  const b: RenewalBatch = {
    id: randomUUID(),
    learnerId: u.id,
    lv1OrganizationId: u.lv1OrganizationId,
    qualificationId: q.id,
    assignmentId: randomUUID(),
    revision: 1,
    status: "evaluating",
    startedAt: at,
  };
  s.renewalBatches.push(b);
  s.assignments.push({
    id: b.assignmentId,
    renewalBatchId: b.id,
    qualificationId: q.id,
    learnerId: u.id,
    ownerAdminId: u.id,
    createdBy: u.id,
    lv1OrganizationId: u.lv1OrganizationId,
    organizationPath: structuredClone(u.organizationPath),
    organizationSource: "assigned",
    assignedAt: at,
    revision: 1,
    frozenCriteria: freezeCriteria(s, q, u.id, "renewal", at),
    qualificationMetadata: metadata(currentQualification(s, q)),
  });
  s.enrollments.push({
    id: randomUUID(),
    assignmentId: b.assignmentId,
    courseId: q.courseIds[0]!,
  });
  for (const target of preview.targets) {
    const c = s.certifications.find((c) => c.id === target.certificationId)!,
      av = renewalAvailability(s, doc, c, at),
      original = s.qualifications.find(
        (q) => q.id === av.appliedQualification!.id,
      )!;
    s.renewals.push({
      id: randomUUID(),
      batchId: b.id,
      certificationId: c.id,
      periodId: target.periodId!,
      learnerId: u.id,
      lv1OrganizationId: u.lv1OrganizationId,
      qualificationId: original.id,
      qualificationRevision: original.revision,
      frozenCriteria: freezeCriteria(s, original, u.id, "renewal", at),
      validity: structuredClone(original.validity),
      renewalLeadMonths: original.renewalLeadMonths ?? 3,
      renewalNoticeDaysBefore: original.renewalNoticeDaysBefore ?? 7,
      revision: 1,
      status: "draft",
      startedAt: at,
      method: "objective_assessment",
    });
    c.revision = (c.revision || 1) + 1;
    lifecycleEvent(s, {
      subject: "certification",
      targetId: c.id,
      lv1OrganizationId: b.lv1OrganizationId,
      organizationId: u.organizationId,
      actorId: u.id,
      action: "renewal.started",
      reason: "객관식 재인증 시작",
      before: null,
      after: JSON.parse(JSON.stringify(s.renewals.at(-1))),
      assignmentId: c.assignmentId,
      effectiveAt: at,
      recordedAt: at,
    });
  }
  audit(s, u, b, "started", at);
  return { id: b.id, revision: b.revision };
}
export function applyRenewalBatch(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  b: RenewalBatch,
  at: string,
) {
  demand(b.status === "passed", 409, "합격한 진행 회차만 적용할 수 있습니다.");
  const common = batchBlockers(s, doc, b, at);
  demand(!common.length, 409, common.join(" · "));
  for (const r of s.renewals.filter(
    (r) => r.batchId === b.id && r.status === "draft",
  )) {
    if (common.length || targetReasons(s, doc, r, at).length) continue;
    const c = s.certifications.find((c) => c.id === r.certificationId)!;
    executeLifecycle(
      s,
      doc,
      u,
      "renewal.complete",
      r.id,
      {
        certificationRevision: c.revision || 1,
        revision: r.revision,
        confirmation: "종합평가 완료",
      },
      b.lv1OrganizationId,
      at,
      b.id,
    );
  }
  if (
    s.renewals
      .filter((r) => r.batchId === b.id)
      .every((r) => r.status !== "draft")
  ) {
    b.status = "completed";
    b.completedAt = at;
  }
  b.revision++;
  audit(s, u, b, "applied", at);
  return { id: b.id, revision: b.revision };
}
export function reconcileRenewalBatch(
  s: State,
  doc: OrganizationDocument,
  id: string,
  at: string,
) {
  const b = s.renewalBatches.find((b) => b.id === id)!;
  const e = s.enrollments.find((e) => e.assignmentId === b.assignmentId)!,
    co = s.completions.find((c) => c.enrollmentId === e.id),
    t = s.attempts.find(
      (t) =>
        t.enrollmentId === e.id &&
        t.kind === "objective" &&
        t.result === "passed",
    );
  if (b.status !== "evaluating" || !co || !t) return false;
  b.status = "passed";
  b.passedAt = at;
  b.attemptId = t.id;
  b.completionId = co.id;
  b.revision++;
  const u = userView(
    s.users.find((u) => u.id === b.learnerId)!,
    doc,
  );
  audit(s, u, b, "passed", at);
  applyRenewalBatch(s, doc, u, b, at);
  return true;
}
export function guardRenewalAttempt(
  s: State,
  doc: OrganizationDocument,
  id: string,
  at: string,
) {
  const b = s.renewalBatches.find((b) => b.id === id)!;
  demand(
    b?.status === "evaluating",
    409,
    "종료되었거나 합격한 재인증 회차입니다.",
  );
  const reasons = batchBlockers(s, doc, b, at);
  demand(!reasons.length, 409, reasons.join(" · "));
  demand(
    s.renewals.some((r) => {
      const p = s.certifications
        .find((c) => c.id === r.certificationId)
        ?.periods?.find((p) => p.id === r.periodId);
      return (
        r.batchId === b.id &&
        r.status === "draft" &&
        p?.expiresOn &&
        kstDate(at) <= p.expiresOn
      );
    }),
    409,
    "현재 갱신 가능한 대상이 없습니다. 회차를 종료하고 대상 상태를 확인해 주세요.",
  );
}
export function closeRenewalBatch(
  s: State,
  u: UserView,
  b: RenewalBatch,
  at: string,
) {
  demand(
    u.lv1OrganizationId === b.lv1OrganizationId && u.organizationActive,
    409,
    "시작 당시 팀의 활성 학습자 권한이 필요합니다.",
  );
  demand(
    ["evaluating", "passed"].includes(b.status),
    409,
    "이미 종료된 회차입니다.",
  );
  for (const r of s.renewals.filter(
    (r) => r.batchId === b.id && r.status === "draft",
  )) {
    r.status = "closed";
    r.closedAt = at;
    r.closeReason = "학습자 회차 종료";
    r.revision++;
    const c = s.certifications.find((c) => c.id === r.certificationId)!;
    c.revision = (c.revision || 1) + 1;
  }
  b.status = "closed";
  b.closedAt = at;
  b.revision++;
  const a = s.assignments.find((a) => a.id === b.assignmentId)!;
  a.acquisitionClosedAt = at;
  a.revision++;
  audit(s, u, b, "closed", at);
  return { id: b.id, revision: b.revision };
}
export function renewalBatchView(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  id: string,
  at: string,
): RenewalBatchView {
  const b = renewalOwner(s, u, id),
    q = s.qualifications.find((q) => q.id === b.qualificationId)!,
    e = s.enrollments.find((e) => e.assignmentId === b.assignmentId)!,
    t = s.attempts.find((t) => t.id === b.attemptId),
    reasons = batchBlockers(s, doc, b, at);
  const targets = s.renewals
    .filter((r) => r.batchId === id)
    .map((r) => {
      const c = s.certifications.find((c) => c.id === r.certificationId)!,
        p = c.periods?.find((p) => p.id === r.periodId);
      return {
        renewalId: r.id,
        certificationId: c.id,
        title:
          c.qualificationMetadata?.title ||
          c.snapshot?.title ||
          s.qualifications.find((q) => q.id === c.qualificationId)!.title,
        status: r.status === "draft" ? ("pending" as const) : r.status,
        reasons:
          r.status === "draft"
            ? [...reasons, ...targetReasons(s, doc, r, at)]
            : targetReasons(s, doc, r, at),
        expiresOn: p?.expiresOn,
        nextExpiresOn: p?.expiresOn
          ? periodExpiry(p.expiresOn, r.validity)
          : undefined,
        certificateHref: `/qualifications/${c.assignmentId}`,
      };
    });
  return {
    batch: b,
    qualificationTitle: q.title,
    courseId: e.courseId,
    assessmentHref: `/qualifications/${b.assignmentId}/courses/${e.courseId}/objective`,
    canEvaluate:
      b.status === "evaluating" &&
      !reasons.length &&
      targets.some(
        (t) =>
          t.status === "pending" && t.expiresOn && kstDate(at) <= t.expiresOn,
      ),
    reasons,
    targets,
    ...(t
      ? { score: { earned: t.earned!, total: t.total!, result: t.result! } }
      : {}),
  };
}
export function registerRenewalBatchRoutes(
  app: FastifyInstance,
  store: JsonStore,
  actor: (r: FastifyRequest, s?: State) => UserView,
  clock: () => string,
) {
  app.get("/api/me/renewal-candidates", async (r) =>
    renewalCandidates(
      store.snapshot(),
      store.organizations.snapshot(),
      actor(r),
      clock(),
    ),
  );
  app.post("/api/renewal-batches/preview", async (r) =>
    previewRenewalBatch(
      store.snapshot(),
      store.organizations.snapshot(),
      actor(r),
      r.body,
      clock(),
    ),
  );
  app.get("/api/renewal-batches/:id", async (r) =>
    renewalBatchView(
      store.snapshot(),
      store.organizations.snapshot(),
      actor(r),
      (r.params as any).id,
      clock(),
    ),
  );
  for (const action of ["start", "apply", "close"] as const)
    app.post(
      action === "start"
        ? "/api/renewal-batches"
        : `/api/renewal-batches/:id/${action}`,
      async (r) => {
        const id = (r.params as any).id,
          u = actor(r);
        learner(u);
        if (action !== "start") renewalOwner(store.snapshot(), u, id);
        const input =
          action === "start"
            ? selection.parse(r.body)
            : z.object({ revision: z.number().int() }).strict().parse(r.body);
        const key = z
            .string()
            .min(1)
            .max(160)
            .parse(r.headers["idempotency-key"]),
          hash = createHash("sha256")
            .update(JSON.stringify({ action, id, input }))
            .digest("hex");
        return store.transact(
          u.id,
          key,
          hash,
          (s) => {
            const fresh = actor(r, s);
            learner(fresh);
            if (action !== "start") renewalOwner(s, fresh, id);
          },
          (s) => {
            const fresh = actor(r, s),
              doc = store.organizations.snapshot(),
              at = clock();
            if (action === "start")
              return startRenewalBatch(s, doc, fresh, input, at);
            const b = renewalOwner(s, fresh, id);
            checkRevision(b.revision, (input as any).revision);
            return action === "apply"
              ? applyRenewalBatch(s, doc, fresh, b, at)
              : closeRenewalBatch(s, fresh, b, at);
          },
          {
            action: `renewal-batch.${action}`,
            lv1OrganizationId: u.lv1OrganizationId,
          },
        );
      },
    );
}
import { workDeactive, WORK_DEACTIVE_MESSAGE } from "@eks/contracts";
