import { currentTeamQualifications } from "@eks/contracts";
import { canContinueType, canReadPersonal } from "./personal-access.ts";
import { activeAuditorCertification } from "./auditor-program.ts";
import { courseTypeEditing } from "./course-types.ts";
import { planningView } from "./planning.ts";
import {
  requireQualificationProcess,
  currentQualification,
  metadata,
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
  QualificationTypeSchema,
  QualificationSchema,
  DraftSchema,
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
  qualificationForRecord,
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
      (u.roles.includes("learner") ||
        u.roles.includes("evaluator") ||
        a.qualificationMetadata?.qualificationType === "auditor") &&
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
  if (action === "checklist.update") {
    const { a, c } = context(s, target);
    const p = s.plans.find(
      (p) => p.id === a.planId && p.status === "completed",
    );
    const r = s.planningRequests.find((r) => r.id === p?.requestId);
    demand(
      a.learnerId === u.id &&
        a.lv1OrganizationId === u.lv1OrganizationId &&
        c.qualificationType === "auditor" &&
        (!!a.auditor ||
          (r?.qualificationType === "auditor" && r.learnerId === u.id)),
      403,
      "본인에게 배정된 Auditor 학습항목만 확인할 수 있습니다.",
    );
    return;
  }
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
  else if (action === "attempt.start") a = context(s, target).a;
  else if (action.startsWith("attempt."))
    a = context(s, find(s.attempts, target).enrollmentId).a;
  else {
    demand(false, 404, "지원하지 않는 요청입니다.");
  }
  if (action.startsWith("assignment."))
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
export function reconcilePendingAuditor(
  s: State,
  organizations: OrganizationDocument,
  at: string,
) {
  const before = s.certifications.length;
  for (const a of s.assignments.filter(
    (a) =>
      a.auditor &&
      !a.excludedReason &&
      !a.acquisitionClosedAt &&
      !s.certifications.some((c) => c.assignmentId === a.id),
  )) {
    const u = s.users.find((u) => u.id === a.learnerId);
    if (
      !u ||
      u.certificationEligibility === "hold" ||
      !userView(u, organizations).organizationActive
    )
      continue;
    const es = s.enrollments.filter((e) => e.assignmentId === a.id);
    if (
      es.length &&
      es.every((e) => s.completions.some((c) => c.enrollmentId === e.id))
    )
      reconcile(s, es[0]!.id, organizations, at);
  }
  return before !== s.certifications.length;
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
    q = qualificationForRecord(find(s.qualifications, a.qualificationId), a);
  const snapshot = (catalog: { title: string; version: number }) => ({
    learnerName: learner.name,
    organizationPath: structuredClone(
      userView(learner, organizations).organizationPath,
    ),
    title: catalog.title,
    version: catalog.version,
    source: "issued" as const,
  });
  requireQualificationProcess(q);
  let newCompletion: string | undefined;
  const evidence = requiredKinds(c).map((kind) => ({
    kind,
    attemptId: s.attempts.find(
      (t) =>
        t.enrollmentId === e.id && t.kind === kind && t.result === "passed",
    )?.id,
  }));
  const checklist = s.learningChecklists.find((v) => v.enrollmentId === e.id);
  const requiredItems = c.learningItems.filter((i) => i.required);
  const complete =
    c.qualificationType === "auditor"
      ? requiredItems.length > 0 &&
        requiredItems.every((i) =>
          checklist?.items.some((v) => v.itemId === i.id),
        )
      : evidence.length > 0 && evidence.every((ev) => ev.attemptId);
  if (complete && !s.completions.some((co) => co.enrollmentId === e.id)) {
    newCompletion = uid();
    s.completions.push({
      method:
        c.qualificationType === "auditor" ? "self_confirmation" : "assessment",
      learningEvidence:
        c.qualificationType === "auditor"
          ? structuredClone(checklist!.items)
          : [],
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
    (!a.auditor ||
      (learner.certificationEligibility !== "hold" &&
        (a.auditor.level !== "main" ||
          a.auditor.kind === "reacquisition" ||
          !!activeAuditorCertification(s, a.learnerId, "general", at)))) &&
    completed.every((ev) => ev.completionId) &&
    !s.certifications.some((cert) => cert.assignmentId === a.id)
  ) {
    const id = uid();
    if (a.auditor) delete a.auditor.pendingGeneralCertification;
    s.certifications.push({
      ...(a.auditor
        ? {
            auditor: {
              level: a.auditor.level,
              kind: a.auditor.kind,
              ...(a.auditor.level === "main" && a.auditor.kind === "initial"
                ? {
                    prerequisiteCertificationId: activeAuditorCertification(
                      s,
                      a.learnerId,
                      "general",
                      at,
                    )!.id,
                  }
                : {}),
            },
          }
        : {}),
      id,
      assignmentId: a.id,
      learnerId: a.learnerId,
      qualificationId: a.qualificationId,
      date: at,
      snapshot: snapshot({ ...q, ...a.qualificationMetadata }),
      qualificationMetadata: a.qualificationMetadata || metadata(q),
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
  } else if (newCompletion) {
    if (
      a.auditor?.level === "main" &&
      a.auditor.kind === "initial" &&
      completed.every((ev) => ev.completionId)
    )
      a.auditor.pendingGeneralCertification = true;
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
  }
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
  if (action === "checklist.update") {
    const { e, a, c } = context(s, target);
    requireEligible(u);
    active(a);
    demand(
      u.organizationActive,
      409,
      "사용 중인 소속에서 학습을 확인해 주세요.",
    );
    demand(
      c.qualificationType === "auditor",
      409,
      "Auditor 학습 확인만 지원합니다.",
    );
    const input = z
      .object({
        revision: z.number().int().nonnegative(),
        itemId: z.string(),
        checked: z.boolean(),
      })
      .strict()
      .parse(body);
    demand(
      !s.completions.some((v) => v.enrollmentId === e.id),
      409,
      "수료한 인증Set의 학습 확인 기록은 변경할 수 없습니다.",
      "CHECKLIST_COMPLETED",
    );
    const item = c.learningItems.find((v) => v.id === input.itemId);
    demand(item, 422, "배정된 인증Set의 학습항목을 확인해 주세요.");
    let checklist = s.learningChecklists.find((v) => v.enrollmentId === e.id);
    expected(checklist || { revision: 0 }, input.revision);
    if (!checklist) {
      checklist = { enrollmentId: e.id, revision: 0, items: [] };
      s.learningChecklists.push(checklist);
    }
    const before = structuredClone(checklist);
    checklist.items = checklist.items.filter((v) => v.itemId !== item.id);
    if (input.checked)
      checklist.items.push({
        itemId: item.id,
        title: item.title,
        type: item.type,
        required: item.required,
        confirmedBy: u.id,
        confirmedAt: at,
      });
    checklist.revision++;
    reconcile(s, e.id, organizations, at);
    reconcilePendingAuditor(s, organizations, at);
    audit(s, u, action, e.id, "본인 학습 완료 확인", a.id, {
      before,
      after: checklist,
    });
    return {
      enrollmentId: e.id,
      revision: checklist.revision,
      completionId: s.completions.find((v) => v.enrollmentId === e.id)?.id,
      certificationId: s.certifications.find((v) => v.assignmentId === a.id)
        ?.id,
    };
  }
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
    s.learningChecklists = s.learningChecklists.filter(
      (r) => !enrollments.has(r.enrollmentId),
    );
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
            qualificationType: QualificationTypeSchema.parse(
              body.qualificationType ?? "auditee",
            ),
            title:
              body.title === undefined
                ? ""
                : z.string().trim().min(1).max(300).parse(body.title),
            operationalStatus: "active",
            assessmentKinds:
              body.qualificationType === "auditor" ? [] : ["objective"],
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
        {
          sourceId: item.id,
          sourceVersion: item.version,
          resultVersion: result.version,
          versionMode: body.versionMode ?? null,
          versionPolicy: result.versionPolicy ?? null,
          changes: result.changes,
        },
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
    demand(
      c.qualificationType === "auditee",
      409,
      "Auditor는 평가 없이 학습항목 완료 확인으로 수료합니다.",
      "ASSESSMENT_NOT_APPLICABLE",
    );
    requireQualificationProcess(find(s.qualifications, a.qualificationId));
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
    demand(
      c.qualificationType === "auditee",
      409,
      "Auditor는 평가 없이 학습항목 완료 확인으로 수료합니다.",
      "ASSESSMENT_NOT_APPLICABLE",
    );
    requireQualificationProcess(find(s.qualifications, a.qualificationId));
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
      learningChecklists: s.learningChecklists.filter((r) =>
        enrollments.has(r.enrollmentId),
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
        (canReadPersonal(s, u) && p.learnerId === u.id) ||
        assignments.some((a) => a.planId === p.id)),
  );
  const qids = new Set(assignments.map((a) => a.qualificationId)),
    cids = new Set(
      s.enrollments
        .filter((e) => assignments.some((a) => a.id === e.assignmentId))
        .map((e) => e.courseId),
    );
  for (const p of plans) qids.add(p.qualificationId);
  const requiredView = canReadPersonal(s, u)
    ? requiredQualifications(s, organizations, u, at)
    : null;
  if (canReadPersonal(s, u) && u.organizationActive)
    for (const q of s.qualifications)
      if (
        requiredView?.items.some((i) => i.qualificationId === q.id) ||
        currentTeamQualifications(s).some(
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
    currentQualifications: currentTeamQualifications(s).filter(
      (p) => p.lv1OrganizationId === lv1,
    ),
    requiredQualifications: requiredView,
    requestProgress: s.planningRequests
      .filter(
        (r) =>
          visibleScope(r.lv1OrganizationId) && (admin || r.learnerId === u.id),
      )
      .map((r) => requestProgress(s, organizations, r.id, at)),
    planningOptions: canReadPersonal(s, u)
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
              (user.roles.includes("learner") ||
                user.roles.includes("evaluator")),
          )
          .flatMap((user) =>
            (["auditee", "auditor"] as const).map((type) =>
              planningReadiness(s, organizations, user, at, type),
            ),
          )
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
        (admin || (canReadPersonal(s, u) && r.learnerId === u.id)),
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
        return admin ? { ...copy, typeEditing: courseTypeEditing(s, c) } : copy;
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
              checklist: s.learningChecklists.find(
                (v) => v.enrollmentId === e.id,
              ),
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
