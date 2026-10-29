import {
  guardRenewalAttempt,
  reconcileRenewalBatch,
} from "./renewal-batches.ts";
import {
  releaseInfo,
  releaseNumber,
  freezeCriteria,
  courseRelease,
} from "./releases.ts";
import { assignmentPrerequisite } from "./auditor-pool.ts";
import {
  authorizeSubjective,
  executeSubjective,
  subjectiveView,
} from "./subjective.ts";
import { teamCourseModified } from "./common-courses.ts";
import { numberedQualificationVersion } from "./qualification-templates.ts";
import { currentTeamQualifications } from "@eks/contracts";
import { canContinueType, canReadPersonal } from "./personal-access.ts";
import { courseTypeEditing } from "./course-types.ts";
import { planningView } from "./planning.ts";
import {
  requireQualificationProcess,
  currentQualification,
  metadata,
  checkCommonFields,
} from "./qualification-templates.ts";
import {
  saveCatalogItem,
  deleteQualification,
  validateCatalogStructure,
} from "./catalog-editing.ts";
import {
  requestProgress,
  planningReadiness,
  planPolicyErrors,
} from "./organization-settings.ts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  CourseSchema,
  CourseContentSchema,
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
  organizationEntries,
  type AssessmentAttempt,
  type Workspace,
  type StoredAssignment,
  type Kind,
  type AuditEvent,
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
import { userView, organization } from "./organizations.ts";
import { changeCourseLifecycle, courseUsage } from "./course-lifecycle.ts";
import {
  isWorkflowAction,
  authorizeWorkflow,
  executeWorkflow,
} from "./workflow.ts";
import { notify } from "./notifications.ts";
import { workDeactive, WORK_DEACTIVE_MESSAGE } from "@eks/contracts";
import { requireWorkActive } from "./work-status.ts";
import {
  editableOrganizations,
  administersSubtree,
} from "./organization-administrators.ts";
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
    lv1OrganizationId: scope,
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
    "FT·주관식 채점 기능은 종료되었습니다.",
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
            ([key, value]) =>
              (deprecated.has(key) &&
                !(
                  (key === "subjectiveQuestions" &&
                    (v === body ||
                      (action === "catalog.create" && v === body.content)) &&
                    action.startsWith("catalog.") &&
                    target === "courses") ||
                  (key === "category" &&
                    v === body &&
                    ["common", "specialized"].includes(String(value)))
                )) ||
              obsolete(value),
          ))
    );
  }
  demand(
    !obsolete(body),
    422,
    "폐지된 평가/자료 필드입니다. 새 화면을 불러와 주세요.",
    "OBSOLETE_FIELDS",
  );
  if (action.startsWith("subjective."))
    return authorizeSubjective(s, u, action, target);
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
  requireWorkActive(learner, c.qualificationType);
  const snapshot = (catalog: {
    title: string;
    version: number;
    releaseVersion?: { major: number; minor: number } | null;
  }) => ({
    learnerName: learner.name,
    organizationPath: structuredClone(
      userView(learner, organizations).organizationPath,
    ),
    title: catalog.title,
    version: catalog.version,
    releaseVersion: releaseNumber(catalog),
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
  if (a.renewalBatchId)
    return reconcileRenewalBatch(s, organizations, a.renewalBatchId, at);
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
          !!assignmentPrerequisite(s, a, at)))) &&
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
                    prerequisiteCertificationId: assignmentPrerequisite(
                      s,
                      a,
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
      frozenCriteria: a.frozenCriteria,
      date: at,
      snapshot: snapshot({
        ...q,
        ...a.qualificationMetadata,
        version: numberedQualificationVersion(q),
      }),
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
  if (action.startsWith("subjective."))
    return executeSubjective(s, u, action, target, body, at);
  reconcileLifecycle(s, at);
  if (action.startsWith("attempt.")) {
    requireEligible(u);
    const enrollmentId =
      action === "attempt.start"
        ? target
        : find(s.attempts, target).enrollmentId;
    const ctx = context(s, enrollmentId);
    requireWorkActive(find(s.users, ctx.a.learnerId), ctx.c.qualificationType);
  }
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
      demand(
        body.category === undefined || body.category === "specialized",
        422,
        "공통인증Set은 기본자격 등록을 통해 생성해 주세요.",
      );
      demand(
        body.commonCourseSource === undefined,
        422,
        "공통 출처는 지정할 수 없습니다.",
      );
      const content =
        body.content === undefined
          ? undefined
          : CourseContentSchema.strict().parse(body.content);
      if (content) {
        demand(
          !body.qualificationType ||
            body.qualificationType === content.qualificationType,
          422,
          "인증 유형이 일치하지 않습니다.",
          "COURSE_TYPE_MISMATCH",
        );
        demand(!!content.title.trim(), 422, "인증Set명을 입력해 주세요.");
        demand(
          content.qualificationType !== "auditor" ||
            (!content.assessmentKinds.length &&
              !content.questions.length &&
              !content.practicalQuestions.length &&
              content.passScore === null &&
              content.practicalPassScore === null &&
              !content.subjectiveEnabled &&
              !content.subjectiveQuestions.length),
          422,
          "Auditor 인증Set은 학습항목과 자료로 구성해 주세요.",
        );
      }
      const id = uid(),
        base = {
          id,
          lv1OrganizationId: scope,
          entityId: id,
          version: 1,
          releaseVersion: { major: 1, minor: 0 },
          releaseInfo: releaseInfo("initial", u.id, "인증Set 생성"),
          revision: 1,
          title: "",
        };
      if (isCourse) {
        const course = CourseSchema.parse({
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
          ...content,
          category: "specialized",
        });
        validateCatalogStructure(s, "courses", course);
        course.releaseVersion = courseRelease(undefined, course).releaseVersion;
        s.courses.push(course);
      } else
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
    if (action === "catalog.clone")
      demand(
        false,
        410,
        "내용을 변경해 저장하면 새 버전이 자동 생성됩니다.",
        "RELEASE_CONTRACT_CHANGED",
      );
    const result = saveCatalogItem(
      s,
      organizations,
      isCourse ? "courses" : "qualifications",
      item.id,
      body,
      scope,
      u.id,
    );
    if (!result.unchanged)
      audit(
        s,
        u,
        action,
        result.id,
        result.initialConfiguration
          ? "Ready 최초 설정 v1 저장"
          : result.newVersion
            ? "기존 기준을 보존하고 새 버전 저장"
            : "기준 저장",
        undefined,
        {
          sourceId: item.id,
          sourceVersion: item.version,
          resultVersion: result.version,
          initialConfiguration: result.initialConfiguration ?? false,
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
    if (a.renewalBatchId)
      guardRenewalAttempt(s, organizations, a.renewalBatchId, at);
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
    if (a.renewalBatchId)
      guardRenewalAttempt(s, organizations, a.renewalBatchId, at);
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
  if (canReadPersonal(s, u) && u.organizationActive)
    for (const q of s.qualifications)
      if (
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
          !workDeactive(x) &&
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
      canManageOrganizationSettings: operator
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
            : u.organizationPath.some((p) => p.id === e.id) ||
              administersSubtree(u, e)),
      )
      .map((e) =>
        !admin && e.id !== u.organizationId && !administersSubtree(u, e)
          ? { ...e, description: "", duties: "" }
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
        return admin
          ? {
              ...copy,
              teamModified: teamCourseModified(c),
              typeEditing: courseTypeEditing(s, c),
            }
          : { ...copy, teamModified: teamCourseModified(c) };
      }),
    assignments: assignments.map((a) => {
      const cert = s.certifications.find((c) => c.assignmentId === a.id);
      return {
        ...a,
        ...(a.renewalBatchId
          ? {
              renewalBatch: s.renewalBatches.find(
                (b) => b.id === a.renewalBatchId,
              ),
            }
          : {}),
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
              subjective: (() => {
                const v = subjectiveView(s, u, e.id);
                return v?.response?.status === "draft"
                  ? { ...v, response: null }
                  : v;
              })(),
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
