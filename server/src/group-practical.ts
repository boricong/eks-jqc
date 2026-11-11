import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  CourseContentSchema,
  courseUseErrors,
  kstDate,
  type State,
  type UserView,
  type OrganizationDocument,
  type GroupAssessment,
  type GroupRun,
  type GroupAssessmentPreview,
  GroupAnalysisSchema,
  GroupTrialSchema,
} from "@eks/contracts";
import { demand } from "./errors.ts";
import { userView } from "./organizations.ts";
import { managementScope } from "./management.ts";
import { canonicalHash } from "./releases.ts";
import {
  groupSourceHash,
  usableCompletion,
} from "./group-practical-evidence.ts";
import { reconcile } from "./domain.ts";
import { notify } from "./notifications.ts";

const revision = z.number().int().positive();
const reason = z.string().trim().min(1).max(2000);
const basic = z.object({ revision }).strict();
export function requireGroupDataset(s: State) {
  demand(
    s.schemaVersion >= 33 && s.groupPracticalEnvironment === "trial",
    409,
    "별도 시험환경을 그룹 실기 형식으로 이관해 주세요.",
    "GROUP_TRIAL_REQUIRED",
  );
}
export function groupContext(s: State, id: string, runId?: string) {
  const group = s.groupAssessments.find((g) => g.id === id);
  demand(group, 404, "그룹을 찾을 수 없습니다.");
  const run = runId
    ? group.runs.find((r) => r.id === runId)
    : group.runs.at(-1);
  if (runId) demand(run, 404, "평가 차수를 찾을 수 없습니다.");
  return { group, run };
}
export function groupManager(
  u: UserView,
  doc: OrganizationDocument,
  group: GroupAssessment,
) {
  managementScope(u, doc, group.lv1OrganizationId);
}
export function groupReader(
  u: UserView,
  doc: OrganizationDocument,
  group: GroupAssessment,
) {
  if (
    u.roles.includes("system_operator") ||
    (u.roles.includes("admin") &&
      u.lv1OrganizationId === group.lv1OrganizationId)
  ) {
    groupManager(u, doc, group);
    return true;
  }
  demand(
    group.members.some((m) => m.learnerId === u.id),
    403,
    "본인이 참여한 그룹만 조회할 수 있습니다.",
  );
  return false;
}
export function groupEvaluator(u: UserView, group: GroupAssessment) {
  demand(
    u.id === group.evaluatorId &&
      u.roles.includes("admin") &&
      u.lv1OrganizationId === group.lv1OrganizationId &&
      u.organizationActive &&
      u.workStatus !== "deactive" &&
      !group.members.some((m) => m.learnerId === u.id),
    403,
    "그룹원이 아닌 지정 팀 관리자만 실기 기록과 판정을 처리할 수 있습니다.",
    "GROUP_EVALUATOR_REQUIRED",
  );
}
function expected(actual: number, input: number) {
  demand(
    actual === input,
    409,
    "다른 창에서 내용이 변경되었습니다. 입력을 보존하고 다시 확인해 주세요.",
    "REVISION_CONFLICT",
  );
}
export function editableRun(group: GroupAssessment, run: GroupRun | undefined) {
  demand(
    group.status === "active" &&
      run &&
      run === group.runs.at(-1) &&
      !run.decision,
    409,
    "현재 진행 중인 평가 차수만 수정할 수 있습니다.",
    "GROUP_WRITE_CLOSED",
  );
  return run;
}
export function groupBlockers(
  s: State,
  doc: OrganizationDocument,
  group: GroupAssessment,
  ignoreCompleted = false,
): string[] {
  const c = s.courses.find((c) => c.id === group.courseId);
  const errors: string[] = [];
  if (
    !c?.groupPractical ||
    c.qualificationType !== "auditee" ||
    courseUseErrors(c).length
  )
    errors.push("그룹 실기 인증Set 기준을 확인해 주세요.");
  if (
    group.courseHash &&
    c &&
    canonicalHash(CourseContentSchema.parse(c)) !== group.courseHash
  )
    errors.push("시작 당시 인증Set 기준과 일치하지 않습니다.");
  const evaluator = s.users.find((u) => u.id === group.evaluatorId);
  if (!evaluator) errors.push("평가자가 없습니다.");
  else {
    const v = userView(evaluator, doc);
    if (
      !v.roles.includes("admin") ||
      !v.organizationActive ||
      v.lv1OrganizationId !== group.lv1OrganizationId ||
      v.workStatus === "deactive" ||
      group.members.some((m) => m.learnerId === v.id)
    )
      errors.push("현재 평가자의 팀·권한·업무 상태를 확인해 주세요.");
  }
  for (const m of group.members) {
    const u = s.users.find((u) => u.id === m.learnerId);
    const e = s.enrollments.find((e) => e.id === m.enrollmentId);
    const a = s.assignments.find((a) => a.id === e?.assignmentId);
    const q = s.qualifications.find((q) => q.id === a?.qualificationId);
    if (
      !u ||
      !e ||
      !a ||
      !q ||
      e.courseId !== group.courseId ||
      a.learnerId !== m.learnerId ||
      a.lv1OrganizationId !== group.lv1OrganizationId
    ) {
      errors.push(`${m.name}: 개인 수강 연결을 확인해 주세요.`);
      continue;
    }
    const v = userView(u, doc);
    if (
      !v.roles.includes("learner") ||
      v.lv1OrganizationId !== group.lv1OrganizationId ||
      !v.organizationActive ||
      v.workStatus === "deactive"
    )
      errors.push(`${m.name}: 학습 권한·소속·업무 상태로 진행이 보류됩니다.`);
    if (
      a.excludedReason ||
      a.acquisitionClosedAt ||
      a.renewalBatchId ||
      a.auditor ||
      q.purpose === "renewal" ||
      (q.lifecycleStatus && q.lifecycleStatus !== "Active") ||
      q.deletedAt
    )
      errors.push(
        `${m.name}: 종료·제외되었거나 진행할 수 없는 취득 절차입니다.`,
      );
    if (
      !ignoreCompleted &&
      s.completions.some((co) => co.enrollmentId === e.id)
    )
      errors.push(`${m.name}: 이미 수료한 인증Set입니다.`);
    if (
      s.groupAssessments.some(
        (g) =>
          g.id !== group.id &&
          ["draft", "active"].includes(g.status) &&
          g.members.some((other) => other.enrollmentId === e.id),
      )
    )
      errors.push(`${m.name}: 다른 진행 그룹에 포함되어 있습니다.`);
  }
  return errors;
}
export function groupCandidates(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  team?: string,
) {
  const scope = managementScope(u, doc, team);
  return {
    courses: s.courses
      .filter(
        (c) =>
          c.lv1OrganizationId === scope &&
          c.groupPractical &&
          !courseUseErrors(c).length,
      )
      .map((c) => ({
        id: c.id,
        title: c.title,
        releaseVersion: c.releaseVersion,
        version: c.version,
      })),
    evaluators: s.users
      .map((user) => userView(user, doc))
      .filter(
        (v) =>
          v.lv1OrganizationId === scope &&
          v.organizationActive &&
          v.workStatus !== "deactive" &&
          v.roles.includes("admin"),
      )
      .map((v) => ({ id: v.id, name: v.name })),
    enrollments: s.enrollments.flatMap((e) => {
      const a = s.assignments.find((a) => a.id === e.assignmentId);
      const user = s.users.find((v) => v.id === a?.learnerId);
      const q = s.qualifications.find((q) => q.id === a?.qualificationId);
      const c = s.courses.find((c) => c.id === e.courseId);
      if (
        !a ||
        !user ||
        !q ||
        !c?.groupPractical ||
        a.lv1OrganizationId !== scope ||
        a.excludedReason ||
        a.acquisitionClosedAt ||
        a.auditor ||
        a.renewalBatchId ||
        (q.lifecycleStatus && q.lifecycleStatus !== "Active") ||
        q.deletedAt ||
        s.completions.some((co) => co.enrollmentId === e.id)
      )
        return [];
      const v = userView(user, doc);
      if (
        !v.roles.includes("learner") ||
        v.lv1OrganizationId !== scope ||
        !v.organizationActive ||
        v.workStatus === "deactive"
      )
        return [];
      const occupied = s.groupAssessments.some(
        (g) =>
          ["draft", "active"].includes(g.status) &&
          g.members.some((m) => m.enrollmentId === e.id),
      );
      return [
        {
          id: e.id,
          learnerId: user.id,
          name: user.name,
          courseId: c.id,
          qualificationTitle: q.title,
          occupied,
        },
      ];
    }),
  };
}
function audit(
  s: State,
  u: UserView,
  group: GroupAssessment,
  action: string,
  why: string,
  at: string,
  details: Record<string, string | number | boolean | string[]> = {},
) {
  s.audits.push({
    id: randomUUID(),
    actorId: u.id,
    date: at,
    action: `group-practical.${action}`,
    targetId: group.id,
    lv1OrganizationId: group.lv1OrganizationId,
    reason: why,
    details,
  });
}
function newRun(group: GroupAssessment, at: string): GroupRun {
  return {
    id: randomUUID(),
    number: group.runs.length + 1,
    revision: 1,
    status: "collecting",
    createdAt: at,
    previousAnalyses: [],
    trials: group.members.flatMap((m) =>
      [1, 2, 3].map((number) => ({
        learnerId: m.learnerId,
        number,
        revision: 1,
        performedOn: "",
        evidence: [],
        note: "",
        completed: false,
      })),
    ),
  };
}
export function discardAnalysis(run: GroupRun) {
  if (run.analysis) {
    run.previousAnalyses.push(run.analysis);
    delete run.analysis;
  }
  run.status = "collecting";
}
export function groupPreview(
  s: State,
  doc: OrganizationDocument,
  group: GroupAssessment,
  run: GroupRun,
): GroupAssessmentPreview {
  const blockers = groupBlockers(s, doc, group);
  if (group.status !== "active" || run !== group.runs.at(-1) || run.decision)
    blockers.push("현재 미확정 평가 차수가 아닙니다.");
  if (
    run.trials.length !== group.members.length * 3 ||
    run.trials.some((t) => !t.completed || !t.performedOn || !t.evidence.length)
  )
    blockers.push("전원의 실기 3회와 원자료 연결을 완료해 주세요.");
  const config = s.courses.find((c) => c.id === group.courseId)?.groupPractical;
  const a = run.analysis;
  if (!a) blockers.push("분석 결과를 등록해 주세요.");
  else {
    if (a.sourceHash !== groupSourceHash(s, group, run))
      blockers.push("원자료가 변경되어 재분석이 필요합니다.");
    if (!a.dataVerified || !a.reason.trim() || !a.reportFileIds.length)
      blockers.push("원자료 대조 확인·판정 사유·분석 보고서가 필요합니다.");
    if (
      config?.metrics.some((m) =>
        m.type === "number"
          ? typeof a.values[m.id] !== "number"
          : typeof a.values[m.id] !== "string" ||
            !(a.values[m.id] as string).trim(),
      ) ||
      Object.keys(a.values).some(
        (id) => !config?.metrics.some((m) => m.id === id),
      )
    )
      blockers.push("필수 결과 항목의 값과 유형을 확인해 주세요.");
    if (
      a.reportFileIds.some(
        (id) =>
          !s.groupAssessmentFiles.some(
            (f) =>
              f.id === id &&
              f.groupId === group.id &&
              f.runId === run.id &&
              f.kind === "report",
          ),
      )
    )
      blockers.push("분석 보고서 연결을 확인해 주세요.");
  }
  const outcomes = group.members.map((m) => {
    const e = s.enrollments.find((e) => e.id === m.enrollmentId)!;
    const assignment = s.assignments.find((a) => a.id === e.assignmentId)!;
    const q = s.qualifications.find(
      (q) => q.id === assignment.qualificationId,
    )!;
    return {
      learnerId: m.learnerId,
      name: m.name,
      enrollmentId: m.enrollmentId,
      qualificationTitle: q.title,
      wouldComplete: a?.result === "passed",
      wouldCertify:
        a?.result === "passed" &&
        s.enrollments
          .filter((e) => e.assignmentId === assignment.id)
          .every(
            (other) =>
              other.id === e.id ||
              usableCompletion(
                s,
                s.completions.find((co) => co.enrollmentId === other.id),
              ),
          ),
      certificationId: s.certifications.find(
        (c) => c.assignmentId === assignment.id,
      )?.id,
    };
  });
  const token = canonicalHash({
    groupRevision: group.revision,
    runRevision: run.revision,
    evaluatorId: group.evaluatorId,
    sourceHash: groupSourceHash(s, group, run),
    analysis: a,
    blockers,
    outcomes,
    organizationRevision: doc.revision,
    members: group.members.map(
      (m) => s.users.find((u) => u.id === m.learnerId)?.revision,
    ),
  });
  return { token, blockers, outcomes, result: a?.result };
}
export function invalidationPreview(
  s: State,
  group: GroupAssessment,
  run: GroupRun,
  why: string,
) {
  const completions = s.completions.filter(
    (c) => c.groupPractical?.decisionId === run.decision?.id,
  );
  const ids = new Set(completions.map((c) => c.id));
  const certifications = s.certifications.filter((c) =>
    c.evidence.some((e) => ids.has(e.completionId)),
  );
  const assignments = s.assignments.filter((a) =>
    s.enrollments.some(
      (e) =>
        e.assignmentId === a.id &&
        completions.some((c) => c.enrollmentId === e.id),
    ),
  );
  const renewals = s.renewals.filter((r) =>
    certifications.some((c) => c.id === r.certificationId),
  );
  const renewalIds = renewals
    .filter((r) => r.status === "draft")
    .map((r) => r.id);
  const batches = s.renewalBatches.filter(
    (b) =>
      ["evaluating", "passed"].includes(b.status) &&
      renewals.some((r) => r.batchId === b.id) &&
      s.renewals
        .filter((r) => r.batchId === b.id && r.status === "draft")
        .every((r) => renewalIds.includes(r.id)),
  );
  return {
    token: canonicalHash({
      group,
      run,
      why,
      completions,
      certifications,
      assignments,
      renewals,
      batches,
    }),
    completionIds: completions.map((c) => c.id),
    certificationIds: certifications.map((c) => c.id),
    assignmentIds: [
      ...assignments.map((a) => a.id),
      ...batches.map((b) => b.assignmentId),
    ],
    renewalIds,
    renewalBatchIds: batches.map((b) => b.id),
  };
}
export function executeGroup(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  action: string,
  id: string | undefined,
  runId: string | undefined,
  body: unknown,
  at: string,
) {
  requireGroupDataset(s);
  if (action === "create") {
    const input = z
      .object({
        title: z.string().trim().min(1).max(200),
        courseId: z.string(),
        evaluatorId: z.string(),
        enrollmentIds: z.array(z.string()).min(3).max(4),
        lv1OrganizationId: z.string(),
      })
      .strict()
      .parse(body);
    const scope = managementScope(u, doc, input.lv1OrganizationId);
    const members = input.enrollmentIds.map((id) => {
      const e = s.enrollments.find((e) => e.id === id),
        a = s.assignments.find((a) => a.id === e?.assignmentId),
        user = s.users.find((u) => u.id === a?.learnerId);
      demand(e && a && user, 422, "개인 수강을 확인해 주세요.");
      return { enrollmentId: e.id, learnerId: user.id, name: user.name };
    });
    demand(
      new Set(members.map((m) => m.learnerId)).size === members.length,
      422,
      "그룹 구성원이 중복되었습니다.",
    );
    const group: GroupAssessment = {
      id: randomUUID(),
      title: input.title,
      courseId: input.courseId,
      evaluatorId: input.evaluatorId,
      lv1OrganizationId: scope,
      revision: 1,
      status: "draft",
      members,
      createdBy: u.id,
      createdAt: at,
      runs: [],
      environment: "trial",
    };
    const blockers = groupBlockers(s, doc, group);
    demand(!blockers.length, 409, blockers.join(" "), "GROUP_BLOCKED");
    s.groupAssessments.push(group);
    audit(s, u, group, action, "그룹 초안 생성", at);
    return { id: group.id, revision: group.revision };
  }
  const { group, run } = groupContext(s, id!, runId);
  if (["trial", "analysis", "finalize"].includes(action))
    groupEvaluator(u, group);
  else groupManager(u, doc, group);
  if (action === "trial") {
    const current = editableRun(group, run);
    const input = GroupTrialSchema.omit({ updatedAt: true, updatedBy: true })
      .strict()
      .parse(body);
    const t = current.trials.find(
      (t) => t.learnerId === input.learnerId && t.number === input.number,
    );
    demand(t, 422, "그룹원의 실기 차수를 확인해 주세요.");
    expected(t.revision, input.revision);
    demand(
      !input.performedOn || input.performedOn <= kstDate(at),
      422,
      "미래의 수행일을 입력할 수 없습니다.",
    );
    demand(
      new Set(input.evidence.map((e) => e.fileId)).size ===
        input.evidence.length &&
        input.evidence.every(
          (e) =>
            e.locator.trim() &&
            s.groupAssessmentFiles.some(
              (f) =>
                f.id === e.fileId &&
                f.groupId === group.id &&
                f.runId === current.id &&
                f.kind === "raw",
            ),
        ),
      422,
      "현재 차수의 원자료와 해당 구간을 연결해 주세요.",
    );
    demand(
      !input.completed || (!!input.performedOn && input.evidence.length > 0),
      422,
      "수행일과 원자료를 입력해야 완료할 수 있습니다.",
    );
    discardAnalysis(current);
    Object.assign(t, input, {
      revision: t.revision + 1,
      updatedBy: u.id,
      updatedAt: at,
    });
    current.revision++;
  } else if (action === "analysis") {
    const current = editableRun(group, run);
    const input = GroupAnalysisSchema.omit({
      registeredAt: true,
      registeredBy: true,
    })
      .extend({ revision })
      .strict()
      .parse(body);
    expected(current.revision, input.revision);
    demand(
      input.sourceHash === groupSourceHash(s, group, current),
      409,
      "분석 대상 원자료가 변경되었습니다.",
      "GROUP_SOURCE_CHANGED",
    );
    demand(
      current.trials.every((t) => t.completed),
      409,
      "전원의 실기 3회를 먼저 완료해 주세요.",
    );
    demand(
      input.reportFileIds.every((id) =>
        s.groupAssessmentFiles.some(
          (f) =>
            f.id === id &&
            f.groupId === group.id &&
            f.runId === current.id &&
            f.kind === "report",
        ),
      ),
      422,
      "현재 차수의 분석 보고서를 선택해 주세요.",
    );
    const { revision: _, ...analysis } = input;
    if (current.analysis) current.previousAnalyses.push(current.analysis);
    current.analysis = { ...analysis, registeredBy: u.id, registeredAt: at };
    current.status = "reviewing";
    current.revision++;
  } else if (action === "finalize") {
    const current = editableRun(group, run);
    const input = z
      .object({ revision, reviewToken: z.string() })
      .strict()
      .parse(body);
    expected(current.revision, input.revision);
    const preview = groupPreview(s, doc, group, current);
    demand(
      !preview.blockers.length,
      409,
      preview.blockers.join(" "),
      "GROUP_BLOCKED",
    );
    demand(
      preview.token === input.reviewToken,
      409,
      "검토 후 상태가 변경되었습니다. 다시 검토해 주세요.",
      "REVISION_CONFLICT",
    );
    current.decision = {
      id: randomUUID(),
      result: current.analysis!.result,
      decidedBy: u.id,
      decidedAt: at,
      sourceHash: current.analysis!.sourceHash,
      analysisHash: canonicalHash(current.analysis),
    };
    current.status = current.decision.result;
    current.revision++;
    if (current.status === "passed") {
      group.status = "passed";
      for (const m of group.members) reconcile(s, m.enrollmentId, doc, at);
    }
    for (const m of group.members)
      notify(
        s,
        {
          key: `group:${current.decision.id}:${m.learnerId}`,
          recipientId: m.learnerId,
          lv1OrganizationId: group.lv1OrganizationId,
          type: "result",
          title: `그룹 실기 ${current.status === "passed" ? "Pass" : "Fail"} · 시험운영`,
          body: group.title,
          href: `/group-assessments/${group.id}`,
        },
        at,
      );
  } else if (action === "invalidate") {
    const input = z
      .object({ revision, reason, reviewToken: z.string() })
      .strict()
      .parse(body);
    demand(
      run?.decision && !run.invalidation,
      409,
      "무효화할 확정 판정이 없습니다.",
    );
    expected(run.revision, input.revision);
    demand(
      !group.members.some((m) => m.learnerId === u.id),
      403,
      "본인이 포함된 그룹의 판정을 무효화할 수 없습니다.",
    );
    const impact = invalidationPreview(s, group, run, input.reason);
    demand(
      input.reviewToken === impact.token,
      409,
      "영향이 변경되었습니다. 다시 검토해 주세요.",
      "REVISION_CONFLICT",
    );
    run.invalidation = { by: u.id, at, reason: input.reason };
    run.status = "invalidated";
    run.revision++;
    for (const a of s.assignments.filter((a) =>
      impact.assignmentIds.includes(a.id),
    )) {
      a.acquisitionClosedAt = at;
      a.revision++;
    }
    for (const c of s.certifications.filter((c) =>
      impact.certificationIds.includes(c.id),
    )) {
      const before = c.lifecycleStatus;
      c.lifecycleStatus = "Revoke";
      c.revision = (c.revision || 1) + 1;
      for (const r of s.renewals.filter(
        (r) => r.certificationId === c.id && r.status === "draft",
      )) {
        r.status = "closed";
        r.closedAt = at;
        r.closeReason = input.reason;
        r.revision++;
      }
      s.lifecycleEvents.push({
        id: randomUUID(),
        subject: "certification",
        targetId: c.id,
        actorId: u.id,
        lv1OrganizationId: group.lv1OrganizationId,
        action: "group-practical.invalidated",
        reason: input.reason,
        effectiveAt: at,
        recordedAt: at,
        assignmentId: c.assignmentId,
        before: before || "Active",
        after: { status: "Revoke", decisionId: run.decision.id },
      });
    }
    for (const b of s.renewalBatches.filter((b) =>
      impact.renewalBatchIds.includes(b.id),
    )) {
      b.status = "closed";
      b.closedAt = at;
      b.revision++;
    }
    if (run.decision.result === "passed") {
      group.status = "closed";
      group.closed = { by: u.id, at, reason: input.reason };
    }
    for (const m of group.members)
      notify(
        s,
        {
          key: `group-invalidated:${run.id}:${m.learnerId}`,
          recipientId: m.learnerId,
          lv1OrganizationId: group.lv1OrganizationId,
          type: "result",
          title: "그룹 실기 판정 무효화 · 시험운영",
          body: input.reason,
          href: `/group-assessments/${group.id}`,
        },
        at,
      );
    audit(s, u, group, action, input.reason, at, { ...impact, token: "" });
  } else if (action === "evaluator") {
    const input = z
      .object({ revision, evaluatorId: z.string(), reason })
      .strict()
      .parse(body);
    expected(group.revision, input.revision);
    demand(
      ["draft", "active"].includes(group.status),
      409,
      "진행 중인 그룹의 평가자만 교체할 수 있습니다.",
    );
    const evaluator = s.users.find((v) => v.id === input.evaluatorId);
    demand(evaluator, 422, "평가자를 확인해 주세요.");
    const v = userView(evaluator, doc);
    const changed = { ...group, evaluatorId: v.id };
    groupEvaluator(v, changed);
    group.evaluatorId = v.id;
    if (run && !run.decision) {
      discardAnalysis(run);
      run.revision++;
    }
    audit(s, u, group, action, input.reason, at);
  } else if (action === "close") {
    const input = z.object({ revision, reason }).strict().parse(body);
    expected(group.revision, input.revision);
    demand(
      ["draft", "active"].includes(group.status),
      409,
      "진행 중인 그룹만 종료할 수 있습니다.",
    );
    group.status = "closed";
    group.closed = { by: u.id, at, reason: input.reason };
    audit(s, u, group, action, input.reason, at);
  } else {
    const input = basic.parse(body);
    expected(group.revision, input.revision);
    demand(
      action === "start" || action === "retry",
      404,
      "지원하지 않는 그룹 작업입니다.",
    );
    demand(
      action === "start"
        ? group.status === "draft"
        : group.status === "active" &&
            !!run?.decision &&
            run.decision.result === "failed",
      409,
      "그룹 시작 또는 Fail 재평가 상태를 확인해 주세요.",
    );
    const blockers = groupBlockers(s, doc, group);
    demand(!blockers.length, 409, blockers.join(" "), "GROUP_BLOCKED");
    const course = s.courses.find((c) => c.id === group.courseId)!;
    group.courseHash ??= canonicalHash(CourseContentSchema.parse(course));
    group.startedAt ??= at;
    group.status = "active";
    group.runs.push(newRun(group, at));
  }
  group.revision++;
  if (!["invalidate", "close", "evaluator"].includes(action))
    audit(
      s,
      u,
      group,
      action,
      action === "finalize"
        ? "그룹 공동 판정 확정 · 시험 발급"
        : "그룹 실기 기록 변경",
      at,
      { runId: run?.id || group.runs.at(-1)?.id || "" },
    );
  return {
    id: group.id,
    revision: group.revision,
    runId: group.runs.at(-1)?.id,
  };
}
