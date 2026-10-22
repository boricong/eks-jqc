import { planningView } from "./planning.ts";
import {
  currentQualification,
  checkCommonFields,
} from "./qualification-templates.ts";
import { saveCatalogItem, deleteQualification } from "./catalog-editing.ts";
import {
  requiredQualifications,
  requestProgress,
  planningReadiness,
  planPolicyErrors,
} from "./organization-policies.ts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  CourseSchema,
  QualificationSchema,
  DraftSchema,
  ComparisonSchema,
  requiredKinds,
  courseUseErrors,
  qualificationErrors,
  qualificationUseErrors,
  type State,
  type UserView as User,
  type OrganizationDocument,
  type ResetScope,
  ResetScopeSchema,
  organizationEntries,
  type AssessmentAttempt,
  type Workspace,
  type StoredAssignment,
  type Kind,
  type AuditEvent,
  type ProgressSummary,
  KindSchema,
  assessmentQuestions,
  assessmentPassScore,
  assessmentPrerequisite,
  kstDate,
  expirationDate,
  unknownValidity,
  kindLabels,
} from "@eks/contracts";
import { demand, DomainError } from "./storage.ts";
import { userView, organization, systemOperator } from "./organizations.ts";
import { changeCourseLifecycle, courseUsage } from "./course-lifecycle.ts";
import {
  isWorkflowAction,
  authorizeWorkflow,
  executeWorkflow,
} from "./workflow.ts";
import { notify } from "./notifications.ts";
import { editableOrganizations } from "./organization-administrators.ts";
import { authorizeNotice, saveNotice } from "./notices.ts";
import {
  initializeCertification,
  requireEligible,
  reconcileLifecycle,
} from "./qualification-lifecycle.ts";

const now = () => new Date().toISOString();
const uid = () => randomUUID();
const idSchema = z.string().min(1).max(160);
function find<T extends { id: string }>(list: T[], id: string): T {
  const value = list.find((x) => x.id === id);
  demand(value, 404, "기록을 찾을 수 없습니다.");
  return value;
}
function owner(a: StoredAssignment, u: User) {
  return (
    u.roles.includes("admin") && a.lv1OrganizationId === u.lv1OrganizationId
  );
}
export function canRead(a: StoredAssignment, u: User) {
  return (
    u.roles.includes("system_operator") ||
    owner(a, u) ||
    (a.lv1OrganizationId === u.lv1OrganizationId &&
      u.roles.includes("learner") &&
      a.learnerId === u.id)
  );
}
function active(a: StoredAssignment) {
  demand(
    !a.acquisitionClosedAt,
    409,
    "종료된 과거 취득 회차입니다. 최신 배정에서 진행해 주세요.",
    "ACQUISITION_CLOSED",
  );
  demand(
    !a.excludedReason,
    409,
    "검증에서 제외된 과제입니다.",
    "ASSIGNMENT_EXCLUDED",
  );
}
function expected(item: { revision: number }, value: unknown) {
  demand(
    item.revision === value,
    409,
    "다른 창에서 변경되었습니다. 다시 불러온 뒤 확인해 주세요.",
    "REVISION_CONFLICT",
  );
}
const reasonSchema = z
  .string()
  .trim()
  .min(1, "변경 사유를 입력해 주세요.")
  .max(2000);
function recordAudit(
  s: State,
  u: User,
  action: string,
  targetId: string,
  reason = "",
  assignmentId?: string,
  details: AuditEvent["details"] = {},
  scope = u.lv1OrganizationId,
) {
  s.audits.push({
    id: uid(),
    lv1OrganizationId: action === "progress.reset" ? undefined : scope,
    actorId: u.id,
    date: now(),
    action,
    targetId,
    reason,
    assignmentId,
    details,
  });
}
function context(s: State, enrollmentId: string) {
  const e = find(s.enrollments, enrollmentId),
    a = find(s.assignments, e.assignmentId),
    c = find(s.courses, e.courseId);
  return { e, a, c };
}
export function authorize(
  s: State,
  u: User,
  action: string,
  target: string,
  body: any,
  managementLv1?: string,
) {
  demand(
    !action.startsWith("attempt.grade") && action !== "assignment.ft",
    410,
    "FT·주관식 평가 기능은 종료되었습니다.",
    "FEATURE_REMOVED",
  );
  demand(
    action !== "catalog.publish",
    410,
    "사용 등록 절차는 종료되었습니다. 기준 저장을 사용해 주세요.",
    "FEATURE_REMOVED",
  );
  const deprecated = new Set([
    "ftId",
    "verdicts",
    "grades",
    "feedback",
    "subjectiveAnswers",
    "subjectiveQuestions",
    "subjectivePassScore",
    "practicalItems",
    "category",
    "material",
    "materialUrl",
    "instruction",
  ]);
  function obsolete(v: unknown): boolean {
    return (
      !!v &&
      typeof v === "object" &&
      (Array.isArray(v)
        ? v.some(obsolete)
        : Object.entries(v).some(
            ([key, value]) => deprecated.has(key) || obsolete(value),
          ))
    );
  }
  demand(
    !obsolete(body),
    422,
    "폐지된 평가/자료 필드입니다. 새 화면을 불러와 주세요.",
    "OBSOLETE_FIELDS",
  );
  if (isWorkflowAction(action))
    return authorizeWorkflow(s, u, action, target, body, managementLv1);
  if (action === "progress.reset") {
    systemOperator(u);
    return;
  }
  if (action === "notice.save") {
    authorizeNotice(s, u, body, "team", managementLv1);
    return;
  }
  if (action.startsWith("catalog.") || action === "assignment.create") {
    demand(managementLv1, 403, "관리할 Lv1 조직을 선택해 주세요.");
    if (action.startsWith("catalog.") && action !== "catalog.create") {
      const list = target === "courses" ? s.courses : s.qualifications;
      const item = find(
        list as { id: string; lv1OrganizationId: string }[],
        body.id,
      );
      demand(
        item.lv1OrganizationId === managementLv1,
        403,
        "소속 Lv1의 기준만 관리할 수 있습니다.",
      );
    }
    if (action === "assignment.create")
      demand(
        find(s.qualifications, body.qualificationId).lv1OrganizationId ===
          managementLv1,
        403,
        "소속 Lv1의 자격만 배정할 수 있습니다.",
      );
    return;
  }
  if (action === "qualification.delete") {
    demand(managementLv1, 403, "관리할 팀을 선택해 주세요.");
    demand(
      find(s.qualifications, target).lv1OrganizationId === managementLv1,
      403,
      "선택한 팀만 관리할 수 있습니다.",
    );
    return;
  }
  if (action.startsWith("course.")) {
    demand(managementLv1, 403, "관리할 Lv1 조직을 선택해 주세요.");
    courseUsage(s, target, managementLv1);
    return;
  }
  let a: StoredAssignment;
  if (action.startsWith("assignment.")) a = find(s.assignments, target);
  else if (action === "attempt.start" || action === "comparison.create")
    a = context(s, target).a;
  else if (action.startsWith("attempt."))
    a = context(s, find(s.attempts, target).enrollmentId).a;
  else if (action.startsWith("comparison."))
    a = context(s, find(s.comparisons, target).enrollmentId).a;
  else {
    demand(false, 404, "지원하지 않는 요청입니다.");
  }
  if (action.startsWith("assignment.") || action.startsWith("comparison."))
    demand(
      managementLv1 && a.lv1OrganizationId === managementLv1,
      403,
      "선택한 Lv1의 업무만 변경할 수 있습니다.",
    );
  else {
    demand(
      a.lv1OrganizationId === u.lv1OrganizationId,
      403,
      "다른 Lv1의 평가를 처리할 수 없습니다.",
    );
    demand(
      u.roles.includes("learner") && a.learnerId === u.id,
      403,
      "본인의 평가만 처리할 수 있습니다.",
    );
  }
}
function reconcile(
  s: State,
  enrollmentId: string,
  organizations: OrganizationDocument,
  at = now(),
) {
  const { e, a, c } = context(s, enrollmentId);
  active(a);
  const learner = find(s.users, a.learnerId),
    q = find(s.qualifications, a.qualificationId);
  const snapshot = (catalog: { title: string; version: number }) => ({
    learnerName: learner.name,
    organizationPath: structuredClone(
      userView(learner, organizations).organizationPath,
    ),
    title: catalog.title,
    version: catalog.version,
    source: "issued" as const,
  });
  let newCompletion: string | undefined;
  const evidence = requiredKinds(c).map((kind) => ({
    kind,
    attemptId: s.attempts.find(
      (t) =>
        t.enrollmentId === e.id && t.kind === kind && t.result === "passed",
    )?.id,
  }));
  if (
    evidence.every((ev) => ev.attemptId) &&
    !s.completions.some((co) => co.enrollmentId === e.id)
  ) {
    newCompletion = uid();
    s.completions.push({
      id: newCompletion,
      enrollmentId: e.id,
      learnerId: a.learnerId,
      courseId: c.id,
      date: at,
      snapshot: snapshot(c),
      evidence: evidence as { kind: Kind; attemptId: string }[],
    });
  }
  const all = s.enrollments.filter((en) => en.assignmentId === a.id),
    completed = all.map((en) => ({
      enrollmentId: en.id,
      completionId: s.completions.find((co) => co.enrollmentId === en.id)?.id,
    }));
  if (
    all.length &&
    completed.every((ev) => ev.completionId) &&
    !s.certifications.some((cert) => cert.assignmentId === a.id)
  ) {
    const id = uid();
    s.certifications.push({
      id,
      assignmentId: a.id,
      learnerId: a.learnerId,
      qualificationId: a.qualificationId,
      date: at,
      snapshot: snapshot({ ...q, ...a.qualificationMetadata }),
      qualificationMetadata: a.qualificationMetadata,
      validity: structuredClone(q.validity),
      ...(q.validity.type === "months"
        ? { expiresOn: expirationDate(at, q.validity) }
        : {}),
      evidence: completed as { enrollmentId: string; completionId: string }[],
    });
    initializeCertification(s, s.certifications.at(-1)!, q, at);
    notify(
      s,
      {
        key: `certification:${id}`,
        recipientId: a.learnerId,
        lv1OrganizationId: a.lv1OrganizationId,
        assignmentId: a.id,
        certificationId: id,
        type: "certification",
        title: "필수 인증Set을 모두 수료하여 자격을 취득했습니다",
        body: a.qualificationMetadata?.title || q.title,
        href: `/certifications/${a.id}`,
      },
      at,
    );
  } else if (newCompletion)
    notify(
      s,
      {
        key: `completion:${newCompletion}`,
        recipientId: a.learnerId,
        lv1OrganizationId: a.lv1OrganizationId,
        assignmentId: a.id,
        type: "completion",
        title: "인증Set을 수료했습니다",
        body: c.title,
        href: `/completions/${newCompletion}`,
      },
      at,
    );
  return !!newCompletion;
}
function validateDraft(t: AssessmentAttempt, s: State, body: unknown) {
  const draft = DraftSchema.parse(body),
    c = find(s.courses, t.courseId);
  demand(
    Object.entries(draft.answers).every(([id, v]) =>
      assessmentQuestions(c, t.kind).some(
        (q) => q.id === id && v < q.choices.length,
      ),
    ),
    422,
    "문항과 선택지를 확인해 주세요.",
  );
  return draft;
}
export function execute(
  s: State,
  u: User,
  action: string,
  target: string,
  body: any,
  organizations: OrganizationDocument,
  managementLv1?: string,
  at = now(),
): any {
  const now = () => at;
  reconcileLifecycle(s, at);
  if (action.startsWith("attempt.")) requireEligible(u);
  if (isWorkflowAction(action))
    return executeWorkflow(
      s,
      u,
      action,
      target,
      body,
      organizations,
      managementLv1,
      at,
    );
  const scope = managementLv1 || u.lv1OrganizationId;
  const audit = (
    state: State,
    actor: User,
    action: string,
    targetId: string,
    reason = "",
    assignmentId?: string,
    details: AuditEvent["details"] = {},
  ) =>
    recordAudit(
      state,
      actor,
      action,
      targetId,
      reason,
      assignmentId,
      details,
      scope,
    );
  if (action === "progress.reset") {
    const input = z
      .object({
        revision: z.number().int().nonnegative(),
        confirmation: z.literal("초기화"),
        scope: ResetScopeSchema,
      })
      .parse(body);
    expected(s, input.revision);
    if (input.scope.type === "organization")
      demand(
        organization(organizations, input.scope.lv1OrganizationId).level === 1,
        422,
        "Lv1 조직을 선택해 주세요.",
      );
    const { counts } = progressSummary(s, input.scope);
    const affected = new Set(
      s.assignments
        .filter((a) => inScope(a.lv1OrganizationId, input.scope))
        .map((a) => a.id),
    );
    const enrollments = new Set(
      s.enrollments
        .filter((e) => affected.has(e.assignmentId))
        .map((e) => e.id),
    );
    s.attempts = s.attempts.filter((r) => !enrollments.has(r.enrollmentId));
    s.learningRecords = s.learningRecords.filter(
      (r) => !enrollments.has(r.enrollmentId),
    );
    s.notifications = s.notifications.filter(
      (r) => !r.assignmentId || !affected.has(r.assignmentId),
    );
    s.completions = s.completions.filter(
      (r) => !enrollments.has(r.enrollmentId),
    );
    const removedCertIds = new Set(
      s.certifications
        .filter((c) => affected.has(c.assignmentId))
        .map((c) => c.id),
    );
    s.certifications = s.certifications.filter(
      (r) => !affected.has(r.assignmentId),
    );
    s.renewals = s.renewals.filter(
      (r) => !removedCertIds.has(r.certificationId),
    );
    s.lifecycleEvents = s.lifecycleEvents.filter(
      (e) => e.subject !== "certification" || !removedCertIds.has(e.targetId),
    );
    const groups = new Map<string, StoredAssignment[]>();
    for (const a of s.assignments.filter((a) => affected.has(a.id))) {
      const key = `${a.learnerId}:${find(s.qualifications, a.qualificationId).entityId}`;
      groups.set(key, [...(groups.get(key) || []), a]);
      if (
        a.previousCertificationId &&
        removedCertIds.has(a.previousCertificationId)
      ) {
        a.resetPreviousCertificationId = a.previousCertificationId;
        delete a.previousCertificationId;
      }
    }
    for (const group of groups.values())
      for (const a of group.slice(0, -1)) a.acquisitionClosedAt ||= at;
    for (const p of s.plans)
      if (
        p.previousCertificationId &&
        removedCertIds.has(p.previousCertificationId)
      )
        delete p.previousCertificationId;
    for (const r of s.planningRequests)
      for (const t of [...(r.targets || []), ...r.selections])
        if (
          t.previousCertificationId &&
          removedCertIds.has(t.previousCertificationId)
        )
          delete t.previousCertificationId;
    s.comparisons = s.comparisons.filter(
      (r) => !enrollments.has(r.enrollmentId),
    );
    s.requests = s.requests.filter(
      (r) =>
        !(
          (r.lv1OrganizationId &&
            inScope(r.lv1OrganizationId, input.scope) &&
            (!r.action ||
              r.action === "legacy" ||
              r.action.startsWith("attempt.") ||
              r.action.startsWith("learning.") ||
              r.action === "notification.read" ||
              r.action.startsWith("comparison."))) ||
          (r.lv1OrganizationId &&
            inScope(r.lv1OrganizationId, input.scope) &&
            (r.action?.startsWith("renewal.") ||
              r.action?.startsWith("credential.")))
        ),
    );
    s.audits = s.audits.filter(
      (ev) =>
        !(
          ev.assignmentId &&
          affected.has(ev.assignmentId) &&
          (ev.action.startsWith("attempt.") ||
            ev.action.startsWith("learning.") ||
            ev.action.startsWith("comparison."))
        ),
    );
    for (const event of s.audits)
      if (event.assignmentId && affected.has(event.assignmentId))
        delete event.details.archivedDrafts;
    const id = uid();
    audit(
      s,
      u,
      action,
      id,
      "MVP 반복 테스트를 위한 진행 내역 초기화",
      undefined,
      { counts, scope: input.scope },
    );
    return { id, revision: s.revision + 1 };
  }
  if (action.startsWith("course.")) {
    const result = changeCourseLifecycle(s, u, action, target, body, scope);
    audit(s, u, action, target, result.reason, undefined, result.details);
    return result.response;
  }
  if (action === "qualification.delete") {
    const result = deleteQualification(
      s,
      organizations,
      target,
      body,
      scope,
      u.id,
    );
    audit(s, u, action, target, result.reason, undefined, result.impact);
    return result;
  }
  if (action.startsWith("catalog.")) {
    const isCourse = target === "courses",
      list = isCourse ? s.courses : s.qualifications;
    if (action === "catalog.create") {
      demand(
        isCourse,
        403,
        "새 자격은 시스템 기본자격 관리에서 생성한 뒤 팀에 등록해 주세요.",
        "TEMPLATE_REQUIRED",
      );
      const id = uid(),
        base = {
          id,
          lv1OrganizationId: scope,
          entityId: id,
          version: 1,
          revision: 1,
          title: "",
        };
      if (isCourse)
        s.courses.push(
          CourseSchema.parse({
            ...base,
            operationalStatus: "active",
            assessmentKinds: ["objective"],
            passScore: null,
            practicalPassScore: null,
            materials: [],
            questions: [],
            practicalQuestions: [],
          }),
        );
      else
        s.qualifications.push(
          QualificationSchema.parse({
            ...base,
            courseIds: [],
            lifecycleStatus: "Active",
            renewalLeadMonths: 3,
            renewalNoticeDaysBefore: 7,
          }),
        );
      audit(s, u, action, id);
      return { id };
    }
    const item = find(
      list as (State["courses"][number] | State["qualifications"][number])[],
      body.id,
    );
    if (action === "catalog.clone") {
      if (!isCourse)
        checkCommonFields(s, item as State["qualifications"][number], body);
      demand(!item.deletedAt, 409, "삭제된 기준입니다.");
      if (body.revision != null)
        demand(
          body.revision === item.revision,
          409,
          "기준이 변경되었습니다. 최신 내용을 확인해 주세요.",
          "REVISION_CONFLICT",
        );
      const clone = {
        ...structuredClone(
          isCourse
            ? item
            : currentQualification(s, item as State["qualifications"][number]),
        ),
        id: uid(),
        parentId: item.id,
        version:
          Math.max(
            ...list
              .filter((x) => x.entityId === item.entityId)
              .map((x) => x.version),
          ) + 1,
        revision: 1,

        ...(isCourse
          ? {
              operationalStatus: "active",
              retiredAt: undefined,
              retiredBy: undefined,
              retirementReason: undefined,
            }
          : { lifecycleStatus: "Active" }),
      };
      if (isCourse) s.courses.push(CourseSchema.parse(clone));
      else s.qualifications.push(QualificationSchema.parse(clone));
      audit(s, u, action, clone.id, "새 버전", undefined, {
        parentId: item.id,
      });
      return { id: clone.id };
    }
    const result = saveCatalogItem(
      s,
      organizations,
      isCourse ? "courses" : "qualifications",
      item.id,
      body,
      scope,
    );
    if (!result.unchanged)
      audit(
        s,
        u,
        action,
        result.id,
        result.newVersion ? "기존 기준을 보존하고 새 버전 저장" : "기준 저장",
        undefined,
        { sourceId: item.id },
      );
    return result;
  }
  if (action === "assignment.create") {
    demand(
      false,
      409,
      "학습자의 개인 계획을 완료하여 배정해 주세요.",
      "PLAN_REQUIRED",
    );
  }
  if (action.startsWith("assignment.")) {
    const a = find(s.assignments, target);
    active(a);
    expected(a, body.revision);
    const reason = reasonSchema.parse(body.reason);
    if (action === "assignment.exclude") {
      a.excludedReason = reason;
      a.excludedAt = now();
      audit(s, u, action, a.id, reason, a.id);
    } else
      demand(
        false,
        410,
        "담당 FT 변경 기능은 종료되었습니다.",
        "FEATURE_REMOVED",
      );
    a.revision++;
    return { id: a.id, revision: a.revision };
  }
  if (action === "attempt.start") {
    const { e, a, c } = context(s, target);
    active(a);
    const kind = KindSchema.parse(body.kind);
    const prerequisite = assessmentPrerequisite(
      c,
      kind,
      s.attempts.some(
        (t) =>
          t.enrollmentId === e.id &&
          t.kind === "objective" &&
          t.result === "passed",
      ),
    );
    if (prerequisite)
      throw new DomainError(409, prerequisite.message, prerequisite.code, {
        href: `/qualifications/${a.id}/courses/${c.id}/objective`,
      });
    demand(requiredKinds(c).includes(kind), 422, "필수 평가가 아닙니다.");
    demand(
      !s.attempts.some(
        (t) =>
          t.enrollmentId === e.id && t.kind === kind && t.result === "passed",
      ),
      409,
      "이미 통과한 평가입니다.",
    );
    const existing = s.attempts.find(
      (t) =>
        t.enrollmentId === e.id && t.kind === kind && t.status !== "graded",
    );
    if (existing) return { id: existing.id, revision: existing.revision };
    const t: AssessmentAttempt = {
      id: uid(),
      enrollmentId: e.id,
      courseId: c.id,
      learnerId: a.learnerId,
      kind,
      round:
        s.attempts.filter((t) => t.enrollmentId === e.id && t.kind === kind)
          .length + 1,
      status: "in_progress",
      revision: 1,
      createdAt: now(),
      answers: {},
    };
    s.attempts.push(t);
    audit(s, u, action, t.id, "", a.id);
    return { id: t.id, revision: t.revision };
  }
  if (action.startsWith("attempt.")) {
    const t = find(s.attempts, target),
      { a, c } = context(s, t.enrollmentId);
    active(a);
    expected(t, body.revision);
    demand(t.status === "in_progress", 409, "이미 확정된 평가입니다.");
    const prerequisite = assessmentPrerequisite(
      c,
      t.kind,
      s.attempts.some(
        (previous) =>
          previous.enrollmentId === t.enrollmentId &&
          previous.kind === "objective" &&
          previous.result === "passed",
      ),
    );
    if (prerequisite)
      throw new DomainError(409, prerequisite.message, prerequisite.code, {
        href: `/qualifications/${a.id}/courses/${c.id}/objective`,
      });
    if (action === "attempt.save") {
      Object.assign(t, validateDraft(t, s, body));
      t.revision++;
      return { id: t.id, revision: t.revision };
    }
    const questions = assessmentQuestions(c, t.kind);
    const missingQuestionIds = questions
      .filter(
        (q) =>
          !Number.isInteger(t.answers[q.id]) ||
          t.answers[q.id]! < 0 ||
          t.answers[q.id]! >= q.choices.length,
      )
      .map((q) => q.id);
    if (missingQuestionIds.length)
      throw new DomainError(
        422,
        "모든 문항에 답해야 제출할 수 있습니다.",
        "ASSESSMENT_INCOMPLETE",
        { missingQuestionIds },
      );
    t.itemResults = questions.map((q) => ({
      itemId: q.id,
      correct: t.answers[q.id] === q.correct,
      earned: t.answers[q.id] === q.correct ? q.points : 0,
      possible: q.points,
    }));
    t.total = questions.reduce((v, q) => v + q.points, 0);
    t.earned = t.itemResults.reduce((v, r) => v + r.earned, 0);
    t.result =
      t.earned * 100 >= t.total * assessmentPassScore(c, t.kind)!
        ? "passed"
        : "failed";
    t.status = "graded";
    t.date = now();
    t.submittedAt = t.date;
    t.revision++;
    const awarded = reconcile(s, t.enrollmentId, organizations, at);
    if (!awarded)
      notify(s, {
        key: `result:${t.id}`,
        recipientId: a.learnerId,
        lv1OrganizationId: a.lv1OrganizationId,
        assignmentId: a.id,
        type: "result",
        title: `${kindLabels[t.kind]} 평가 ${t.result === "passed" ? "통과" : "미통과"}`,
        body: c.title,
        href: `/qualifications/${a.id}?course=${c.id}`,
      });
    audit(s, u, action, t.id, "평가 확정", a.id);
    return { id: t.id, result: t.result };
  }
  if (action === "notice.save") return saveNotice(s, u, body, "team", scope);
  if (action === "comparison.create") {
    const { e, a, c } = context(s, target);
    active(a);
    const record = {
      id: uid(),
      enrollmentId: e.id,
      courseId: c.id,
      learnerId: a.learnerId,
      ownerAdminId: u.id,
      revision: 1,
      status: "draft" as const,
      attemptIds: [],
      observedAt: "",
      observer: "",
      task: "",
      criterion: "",
      evidence: "",
      evidenceUrl: "",
      independence: "unknown" as const,
      performance: "unknown" as const,
      createdAt: now(),
      correctionReason: "",
    };
    s.comparisons.push(record);
    audit(s, u, action, record.id, "", a.id);
    return { id: record.id };
  }
  if (action.startsWith("comparison.")) {
    const record = find(s.comparisons, target),
      { a, c } = context(s, record.enrollmentId);
    active(a);
    if (action === "comparison.correct") {
      demand(
        record.status === "final",
        409,
        "확정된 기록만 정정할 수 있습니다.",
      );
      demand(
        !s.comparisons.some((x) => x.supersedesId === record.id),
        409,
        "이미 정정 기록이 있습니다.",
      );
      const next = {
        ...structuredClone(record),
        ownerAdminId: u.id,
        id: uid(),
        revision: 1,
        status: "draft" as const,
        createdAt: now(),
        finalizedAt: undefined,
        outcome: undefined,
        supersedesId: record.id,
        correctionReason: reasonSchema.parse(body.reason),
      };
      s.comparisons.push(next);
      audit(s, u, action, next.id, next.correctionReason, a.id, {
        supersedesId: record.id,
      });
      return { id: next.id };
    }
    demand(
      record.status === "draft",
      409,
      "확정된 기록은 정정 기록을 만들어 변경해 주세요.",
    );
    expected(record, body.revision);
    const fields = ComparisonSchema.pick({
      attemptIds: true,
      observedAt: true,
      observer: true,
      task: true,
      criterion: true,
      evidence: true,
      evidenceUrl: true,
      independence: true,
      performance: true,
    }).parse(body);
    const selected = fields.attemptIds.map((id) => find(s.attempts, id));
    demand(
      selected.every(
        (t) =>
          t.enrollmentId === record.enrollmentId &&
          t.courseId === record.courseId &&
          t.learnerId === record.learnerId &&
          t.status === "graded",
      ) && new Set(selected.map((t) => t.kind)).size === selected.length,
      422,
      "동일 인증Set의 확정 회차를 평가별로 선택해 주세요.",
    );
    Object.assign(record, fields);
    record.revision++;
    if (action === "comparison.finalize") {
      demand(
        requiredKinds(c).every((kind) => selected.some((t) => t.kind === kind)),
        422,
        "필수 평가의 비교 회차를 모두 선택해 주세요.",
      );
      demand(
        record.observedAt &&
          record.observer.trim() &&
          record.task.trim() &&
          record.criterion.trim() &&
          record.evidence.trim(),
        422,
        "관찰일·관찰자·작업·판정 기준·근거를 입력해 주세요.",
      );
      const passed = selected.every((t) => t.result === "passed");
      record.outcome =
        record.independence !== "independent" ||
        record.performance === "unknown"
          ? "pending"
          : passed
            ? record.performance === "met"
              ? "both_met"
              : "assessment_only"
            : record.performance === "met"
              ? "performance_only"
              : "neither_met";
      record.status = "final";
      record.finalizedAt = now();
    }
    audit(s, u, action, record.id, record.correctionReason, a.id);
    return { id: record.id, revision: record.revision };
  }
  demand(false, 404, "지원하지 않는 요청입니다.");
}

export const inScope = (lv1: string, scope: ResetScope) =>
  scope.type === "all" || scope.lv1OrganizationId === lv1;
export function progressSummary(s: State, scope: ResetScope): ProgressSummary {
  const assignments = new Set(
    s.assignments
      .filter((a) => inScope(a.lv1OrganizationId, scope))
      .map((a) => a.id),
  );
  const enrollments = new Set(
    s.enrollments
      .filter((e) => assignments.has(e.assignmentId))
      .map((e) => e.id),
  );
  return {
    revision: s.revision,
    scope,
    counts: {
      renewals: s.renewals.filter((r) =>
        s.certifications.some(
          (c) => c.id === r.certificationId && assignments.has(c.assignmentId),
        ),
      ).length,
      certificationPeriods: s.certifications
        .filter((c) => assignments.has(c.assignmentId))
        .reduce((n, c) => n + (c.periods?.length || 0), 0),
      credentialEvents: s.lifecycleEvents.filter(
        (e) =>
          e.subject === "certification" &&
          !!e.assignmentId &&
          assignments.has(e.assignmentId),
      ).length,
      objectiveAttempts: s.attempts.filter(
        (t) => enrollments.has(t.enrollmentId) && t.kind === "objective",
      ).length,
      practicalAttempts: s.attempts.filter(
        (t) => enrollments.has(t.enrollmentId) && t.kind === "practical",
      ).length,
      learningRecords: s.learningRecords.filter((r) =>
        enrollments.has(r.enrollmentId),
      ).length,
      notifications: s.notifications.filter(
        (n) => n.assignmentId && assignments.has(n.assignmentId),
      ).length,
      completions: s.completions.filter((r) => enrollments.has(r.enrollmentId))
        .length,
      certifications: s.certifications.filter((r) =>
        assignments.has(r.assignmentId),
      ).length,
      comparisons: s.comparisons.filter((r) => enrollments.has(r.enrollmentId))
        .length,
    },
  };
}

export function attemptView(
  s: State,
  u: User,
  t: AssessmentAttempt,
): AssessmentAttempt {
  const { a } = context(s, t.enrollmentId);
  demand(canRead(a, u), 403, "접근 권한이 없습니다.");
  const copy = structuredClone(t);
  if (!(owner(a, u) || u.roles.includes("system_operator"))) {
    delete copy.itemResults;
    if (t.status !== "in_progress" || a.learnerId !== u.id) copy.answers = {};
  }
  return copy;
}
export function workspace(
  s: State,
  u: User,
  organizations: OrganizationDocument,
  lv1?: string,
  at = now(),
): Workspace {
  const operator = u.roles.includes("system_operator");
  if (lv1) {
    demand(
      organization(organizations, lv1).level === 1,
      422,
      "Lv1 조직을 선택해 주세요.",
    );
    demand(
      operator || lv1 === u.lv1OrganizationId,
      403,
      "다른 Lv1을 조회할 수 없습니다.",
    );
  }
  const visibleScope = (id: string) =>
    operator ? !lv1 || id === lv1 : id === u.lv1OrganizationId;
  const assignments = s.assignments.filter(
    (a) => visibleScope(a.lv1OrganizationId) && canRead(a, u),
  );
  const admin = u.roles.includes("admin") || operator;
  const plans = s.plans.filter(
    (p) =>
      !p.deletedAt &&
      visibleScope(p.lv1OrganizationId) &&
      (admin ||
        (u.roles.includes("learner") && p.learnerId === u.id) ||
        assignments.some((a) => a.planId === p.id)),
  );
  const qids = new Set(assignments.map((a) => a.qualificationId)),
    cids = new Set(
      s.enrollments
        .filter((e) => assignments.some((a) => a.id === e.assignmentId))
        .map((e) => e.courseId),
    );
  for (const p of plans) qids.add(p.qualificationId);
  const requiredView = u.roles.includes("learner")
    ? requiredQualifications(s, organizations, u, at)
    : null;
  if (u.roles.includes("learner") && u.organizationActive)
    for (const q of s.qualifications)
      if (
        requiredView?.items.some((i) => i.qualificationId === q.id) ||
        organizations.qualificationPools.some(
          (p) =>
            p.lv1OrganizationId === u.lv1OrganizationId &&
            p.qualificationId === q.id,
        )
      )
        qids.add(q.id);
  const visibleCourseIds = new Set([
    ...cids,
    ...s.qualifications
      .filter((q) => qids.has(q.id))
      .flatMap((q) => q.courseIds),
  ]);
  return {
    actor: u,
    eligibilitySummary: {
      eligible: s.users.filter(
        (x) =>
          x.roles.includes("learner") &&
          x.certificationEligibility !== "hold" &&
          visibleScope(userView(x, organizations).lv1OrganizationId) &&
          (admin || x.id === u.id),
      ).length,
      held: s.users.filter(
        (x) =>
          x.roles.includes("learner") &&
          x.certificationEligibility === "hold" &&
          visibleScope(userView(x, organizations).lv1OrganizationId) &&
          (admin || x.id === u.id),
      ).length,
    },
    qualificationPool: organizations.qualificationPools.filter(
      (p) => p.lv1OrganizationId === lv1,
    ),
    requiredQualifications: requiredView,
    requestProgress: s.planningRequests
      .filter(
        (r) =>
          visibleScope(r.lv1OrganizationId) && (admin || r.learnerId === u.id),
      )
      .map((r) => requestProgress(s, organizations, r.id, at)),
    planningOptions: u.roles.includes("learner")
      ? s.planningRequests
          .filter(
            (r) =>
              r.learnerId === u.id &&
              r.lv1OrganizationId === u.lv1OrganizationId,
          )
          .map((r) => planningView(s, organizations, u, r, at))
      : [],
    planningReadiness: admin
      ? s.users
          .map((user) => userView(user, organizations))
          .filter(
            (user) =>
              visibleScope(user.lv1OrganizationId) &&
              user.roles.includes("learner"),
          )
          .map((user) => planningReadiness(s, organizations, user, at))
      : [],
    planEligibility: plans
      .filter((p) => p.status === "draft")
      .map((p) => ({
        planId: p.id,
        reasons: planPolicyErrors(
          s,
          organizations,
          userView(find(s.users, p.learnerId), organizations),
          p,
          at,
        ),
      })),
    serverDate: kstDate(at),
    plans,
    planningRequests: s.planningRequests.filter(
      (r) =>
        visibleScope(r.lv1OrganizationId) &&
        (admin || (u.roles.includes("learner") && r.learnerId === u.id)),
    ),
    notifications: s.notifications.filter(
      (n) =>
        n.recipientId === u.id &&
        !n.resolvedAt &&
        !(
          u.certificationEligibility === "hold" &&
          ["planning", "renewal", "expiry"].includes(n.type)
        ),
    ),
    management: {
      lv1OrganizationId: operator
        ? lv1 || null
        : u.roles.includes("admin") || u.roles.includes("organization_admin")
          ? u.lv1OrganizationId
          : null,
      canManage: operator ? !!lv1 : u.roles.includes("admin"),
      canManageEligibility: operator
        ? !!lv1
        : u.roles.includes("admin") || u.roles.includes("organization_admin"),
      canManagePolicies: operator
        ? !!lv1
        : u.roles.includes("admin") || u.roles.includes("organization_admin"),
      editableOrganizationIds: editableOrganizations(
        u,
        organizations,
        operator ? lv1 : u.lv1OrganizationId,
      ),
    },
    organizations: organizationEntries(organizations)
      .filter(
        (e) =>
          operator ||
          (admin
            ? e.lv1OrganizationId === u.lv1OrganizationId
            : u.organizationPath.some((p) => p.id === e.id)),
      )
      .map((e) =>
        !admin && e.id !== u.organizationId
          ? { ...e, description: "", duties: "", requiredQualifications: null }
          : e,
      ),
    users: s.users
      .map((user) => userView(user, organizations))
      .filter(
        (user) =>
          visibleScope(user.lv1OrganizationId) &&
          (admin ||
            user.id === u.id ||
            plans.some((p) =>
              s.planningRequests.some(
                (r) => r.id === p.requestId && r.requestedBy === user.id,
              ),
            ) ||
            assignments.some((a) =>
              [a.learnerId, a.ownerAdminId].includes(user.id),
            )),
      ),
    qualifications: s.qualifications
      .filter(
        (q) => visibleScope(q.lv1OrganizationId) && (admin || qids.has(q.id)),
      )
      .map((q) => currentQualification(s, q)),
    courses: s.courses
      .filter(
        (c) =>
          visibleScope(c.lv1OrganizationId) &&
          (admin || visibleCourseIds.has(c.id)),
      )
      .map((c) => {
        const copy = structuredClone(c);
        if (!admin) {
          copy.questions = copy.questions.map((q) => {
            const { correct, ...safe } = q;
            return safe;
          });
          copy.practicalQuestions = copy.practicalQuestions.map(
            ({ correct, ...q }) => q,
          );
          if (!cids.has(c.id)) {
            copy.questions = [];
            copy.practicalQuestions = [];
          }
        }
        return copy;
      }),
    assignments: assignments.map((a) => {
      const cert = s.certifications.find((c) => c.assignmentId === a.id);
      return {
        ...a,
        certifiedAt: cert?.date,
        certification: cert,
        enrollments: s.enrollments
          .filter((e) => e.assignmentId === a.id)
          .map((e) => {
            const ts = s.attempts.filter((t) => t.enrollmentId === e.id),
              activeAttempts = Object.fromEntries(
                ts
                  .filter((t) => t.status !== "graded")
                  .map((t) => [t.kind, attemptView(s, u, t)]),
              );
            const state = (kind: Kind) =>
              ts.some((t) => t.kind === kind && t.result === "passed")
                ? "passed"
                : activeAttempts[kind]
                  ? "draft"
                  : ts.some((t) => t.kind === kind && t.result === "failed")
                    ? "failed"
                    : "ready";
            return {
              id: e.id,
              courseId: e.courseId,
              objective: state("objective"),
              practical: state("practical"),
              answers: activeAttempts.objective?.answers || {},
              activeAttempts,
              completion: s.completions.find((c) => c.enrollmentId === e.id),
              history: ts
                .filter((t) => t.status === "graded")
                .map((t) => {
                  const v = attemptView(s, u, t);
                  return {
                    id: v.id,
                    kind: v.kind,
                    round: v.round,
                    result: v.result!,
                    date: v.date!,
                    earned: v.earned,
                    total: v.total,
                    ...(admin
                      ? { answers: v.answers, itemResults: v.itemResults }
                      : {}),
                  };
                }),
            };
          }),
      };
    }),
    notices: s.notices.filter(
      (n) =>
        n.scope === "team" &&
        visibleScope(n.lv1OrganizationId) &&
        (admin || n.published),
    ),
    homeNotices: s.notices.filter(
      (n) =>
        n.published &&
        (n.scope === "system" || n.lv1OrganizationId === u.lv1OrganizationId),
    ),
    comparisons: s.comparisons.filter(
      (c) =>
        admin &&
        s.enrollments.some(
          (e) =>
            e.id === c.enrollmentId &&
            assignments.some((a) => a.id === e.assignmentId),
        ),
    ),
    audits: s.audits.filter(
      (ev) =>
        admin &&
        (ev.assignmentId
          ? assignments.some((a) => a.id === ev.assignmentId)
          : ev.lv1OrganizationId
            ? visibleScope(ev.lv1OrganizationId)
            : operator),
    ),
  };
}
