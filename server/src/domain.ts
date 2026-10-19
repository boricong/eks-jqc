import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  CourseSchema,
  QualificationSchema,
  DraftSchema,
  NoticeSchema,
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
  GradeSchema,
  expirationDate,
  unknownValidity,
  kindLabels,
} from "@eks/contracts";
import { demand } from "./storage.ts";
import { userView, organization, systemOperator } from "./organizations.ts";
import { changeCourseLifecycle, courseUsage } from "./course-lifecycle.ts";
import {
  isWorkflowAction,
  authorizeWorkflow,
  executeWorkflow,
} from "./workflow.ts";
import { notify } from "./notifications.ts";

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
      a.learnerId === u.id) ||
    (a.lv1OrganizationId === u.lv1OrganizationId &&
      u.roles.includes("ft") &&
      a.ftId === u.id &&
      a.learnerId !== u.id)
  );
}
function active(a: StoredAssignment) {
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
  if (isWorkflowAction(action))
    return authorizeWorkflow(s, u, action, target, body, managementLv1);
  if (action === "progress.reset") {
    systemOperator(u);
    return;
  }
  if (
    action.startsWith("catalog.") ||
    action.startsWith("notice.") ||
    action === "assignment.create"
  ) {
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
    if (action.startsWith("notice.") && body.id) {
      const notice = s.notices.find((n) => n.id === body.id);
      if (notice)
        demand(
          notice.lv1OrganizationId === managementLv1,
          403,
          "소속 Lv1의 공지만 관리할 수 있습니다.",
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
    const kind =
      action === "attempt.start" ? body.kind : find(s.attempts, target).kind;
    if (
      action === "attempt.start" ||
      kind === "objective" ||
      (kind === "subjective" && !action.startsWith("attempt.grade"))
    )
      demand(
        u.roles.includes("learner") && a.learnerId === u.id,
        403,
        "본인의 평가만 처리할 수 있습니다.",
      );
    else
      demand(
        u.roles.includes("ft") && a.ftId === u.id && a.learnerId !== u.id,
        403,
        "지정 FT만 평가할 수 있습니다.",
      );
  }
}
function reconcile(
  s: State,
  enrollmentId: string,
  organizations: OrganizationDocument,
) {
  const { e, a, c } = context(s, enrollmentId);
  active(a);
  const at = now(),
    learner = find(s.users, a.learnerId),
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
      snapshot: snapshot(q),
      validity: structuredClone(q.validity),
      ...(q.validity.type === "months"
        ? { expiresOn: expirationDate(at, q.validity) }
        : {}),
      evidence: completed as { enrollmentId: string; completionId: string }[],
    });
    notify(
      s,
      {
        key: `certification:${id}`,
        recipientId: a.learnerId,
        lv1OrganizationId: a.lv1OrganizationId,
        assignmentId: a.id,
        certificationId: id,
        type: "certification",
        title: "필수 과정을 모두 수료하여 자격을 취득했습니다",
        body: q.title,
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
        title: "과정을 수료했습니다",
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
    !Object.keys(draft.grades || {}).length && !draft.feedback,
    422,
    "답안 저장에는 채점 결과를 넣을 수 없습니다.",
  );
  if (t.kind === "subjective") {
    demand(
      !Object.keys(draft.answers).length && !Object.keys(draft.verdicts).length,
      422,
      "주관식 답안만 입력해 주세요.",
    );
    demand(
      Object.keys(draft.subjectiveAnswers || {}).every((id) =>
        c.subjectiveQuestions.some((q) => q.id === id),
      ),
      422,
      "주관식 문항을 확인해 주세요.",
    );
    return {
      answers: {},
      verdicts: {},
      subjectiveAnswers: draft.subjectiveAnswers || {},
    };
  }
  demand(
    !Object.keys(draft.subjectiveAnswers || {}).length,
    422,
    "평가 유형을 확인해 주세요.",
  );
  if (t.kind === "objective") {
    demand(
      !Object.keys(draft.verdicts).length,
      422,
      "객관식 답안만 입력해 주세요.",
    );
    demand(
      Object.entries(draft.answers).every(([id, v]) =>
        c.questions.some((q) => q.id === id && v < q.choices.length),
      ),
      422,
      "문항과 선택지를 확인해 주세요.",
    );
  } else {
    demand(
      !Object.keys(draft.answers).length,
      422,
      "실기 판정만 입력해 주세요.",
    );
    demand(
      Object.keys(draft.verdicts).every((id) =>
        c.practicalItems.some((i) => i.id === id),
      ),
      422,
      "실기 항목을 확인해 주세요.",
    );
  }
  return { answers: draft.answers, verdicts: draft.verdicts };
}
export function execute(
  s: State,
  u: User,
  action: string,
  target: string,
  body: any,
  organizations: OrganizationDocument,
  managementLv1?: string,
): any {
  if (isWorkflowAction(action))
    return executeWorkflow(
      s,
      u,
      action,
      target,
      body,
      organizations,
      managementLv1,
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
  const participant = (id: string | null, role: "learner" | "ft") => {
    const user = s.users.find((user) => user.id === id);
    demand(
      user && user.roles.includes(role),
      422,
      "학습자·FT 역할을 확인해 주세요.",
    );
    const view = userView(user, organizations);
    demand(
      view.lv1OrganizationId === scope && view.organizationActive,
      422,
      "같은 Lv1의 사용 중인 조직에 소속된 사용자를 선택해 주세요.",
    );
    return view;
  };
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
    s.certifications = s.certifications.filter(
      (r) => !affected.has(r.assignmentId),
    );
    s.comparisons = s.comparisons.filter(
      (r) => !enrollments.has(r.enrollmentId),
    );
    s.requests = s.requests.filter(
      (r) =>
        !(
          r.lv1OrganizationId &&
          inScope(r.lv1OrganizationId, input.scope) &&
          (!r.action ||
            r.action === "legacy" ||
            r.action.startsWith("attempt.") ||
            r.action.startsWith("learning.") ||
            r.action === "notification.read" ||
            r.action.startsWith("comparison."))
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
  if (action.startsWith("catalog.")) {
    const isCourse = target === "courses",
      list = isCourse ? s.courses : s.qualifications;
    if (action === "catalog.create") {
      const id = uid(),
        base = {
          id,
          lv1OrganizationId: scope,
          entityId: id,
          version: 1,
          revision: 1,
          title: "",
          status: "draft" as const,
        };
      if (isCourse)
        s.courses.push(
          CourseSchema.parse({
            ...base,
            operationalStatus: "active",
            assessmentKinds: ["objective", "subjective"],
            passScore: null,
            material: "",
            materialUrl: "",
            instruction: "매뉴얼 참고 가능 · 타인의 도움 없이 수행",
            questions: [],
            practicalItems: [],
          }),
        );
      else
        s.qualifications.push(
          QualificationSchema.parse({ ...base, courseIds: [] }),
        );
      audit(s, u, action, id);
      return { id };
    }
    const item = find(
      list as (State["courses"][number] | State["qualifications"][number])[],
      body.id,
    );
    if (action === "catalog.clone") {
      demand(
        item.status === "published",
        409,
        "사용 등록된 기준에서 새 버전을 만드세요.",
      );
      const clone = {
        ...structuredClone(item),
        id: uid(),
        parentId: item.id,
        version:
          Math.max(
            ...list
              .filter((x) => x.entityId === item.entityId)
              .map((x) => x.version),
          ) + 1,
        revision: 1,
        status: "draft" as const,
        publishedAt: undefined,
        ...(isCourse
          ? {
              operationalStatus: "active",
              retiredAt: undefined,
              retiredBy: undefined,
              retirementReason: undefined,
            }
          : {}),
      };
      if (isCourse) s.courses.push(CourseSchema.parse(clone));
      else s.qualifications.push(QualificationSchema.parse(clone));
      audit(s, u, action, clone.id, "새 버전", undefined, {
        parentId: item.id,
      });
      return { id: clone.id };
    }
    demand(
      item.status === "draft",
      409,
      "사용 등록된 기준은 변경할 수 없습니다.",
    );
    expected(item, body.revision);
    const parsed = (isCourse ? CourseSchema : QualificationSchema).parse({
      ...body,
      id: item.id,
      lv1OrganizationId: item.lv1OrganizationId,
      entityId: item.entityId,
      version: item.version,
      parentId: item.parentId,
      status: "draft",
      publishedAt: undefined,
      revision: item.revision + 1,
      ...(isCourse
        ? {
            operationalStatus: "active",
            retiredAt: undefined,
            retiredBy: undefined,
            retirementReason: undefined,
          }
        : { templateId: (item as State["qualifications"][number]).templateId }),
    });
    if (!isCourse)
      demand(
        (parsed as State["qualifications"][number]).courseIds.every((id) =>
          s.courses.some((c) => c.id === id && c.lv1OrganizationId === scope),
        ),
        422,
        "과정을 찾을 수 없습니다.",
      );
    if (!isCourse) {
      const qualification = parsed as State["qualifications"][number];
      qualification.courseIds = qualification.courseIds.map((id) => {
        if (
          !s.qualifications.some(
            (q) => q.entityId !== item.entityId && q.courseIds.includes(id),
          )
        )
          return id;
        const source = find(s.courses, id),
          copyId = uid();
        const copy = CourseSchema.parse({
          ...structuredClone(source),
          id: copyId,
          entityId: copyId,
          parentId: undefined,
          version: 1,
          revision: 1,
          ...(source.status === "published" ? { publishedAt: now() } : {}),
        });
        s.courses.push(copy);
        audit(
          s,
          u,
          "catalog.independent-copy",
          copyId,
          "다른 자격에 연결한 과정의 독립 사본",
          undefined,
          { sourceId: id, qualificationId: item.id },
        );
        return copyId;
      });
    }
    if (action === "catalog.publish") {
      const errors = isCourse
        ? courseUseErrors(parsed as State["courses"][number])
        : qualificationUseErrors(
            parsed as State["qualifications"][number],
            s.courses,
          );
      demand(!errors.length, 422, errors.join("\n"));
      parsed.status = "published";
      parsed.publishedAt = now();
    }
    Object.assign(item, parsed);
    audit(
      s,
      u,
      action,
      item.id,
      action === "catalog.publish" ? "기준 사용 등록" : "초안 저장",
    );
    return { id: item.id, revision: item.revision };
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
    } else {
      const ftId = idSchema.parse(body.ftId);
      participant(ftId, "ft");
      demand(
        ftId !== a.learnerId &&
          s.users.some((x) => x.id === ftId && x.roles.includes("ft")),
        422,
        "FT를 확인해 주세요.",
      );
      demand(ftId !== a.ftId, 422, "다른 FT를 선택해 주세요.");
      demand(
        s.enrollments
          .filter((e) => e.assignmentId === a.id)
          .some((e) =>
            requiredKinds(find(s.courses, e.courseId)).some(
              (k) => k !== "objective",
            ),
          ),
        422,
        "FT 평가가 없는 과제입니다.",
      );
      const drafts = s.attempts.filter(
        (t) =>
          ((t.kind === "practical" && t.status !== "graded") ||
            (t.kind === "subjective" && t.status === "submitted")) &&
          s.enrollments.some(
            (e) => e.id === t.enrollmentId && e.assignmentId === a.id,
          ),
      );
      audit(
        s,
        u,
        action,
        a.id,
        reason,
        a.id,
        JSON.parse(
          JSON.stringify({
            previousFtId: a.ftId,
            nextFtId: ftId,
            archivedDrafts: drafts.map((t) => ({
              attemptId: t.id,
              revision: t.revision,
              evaluatorId: t.evaluatorId,
              verdicts: t.verdicts,
              grades: t.grades,
              feedback: t.feedback,
            })),
          }),
        ),
      );
      for (const t of drafts) {
        t.verdicts = {};
        t.grades = {};
        t.feedback = "";
        t.evaluatorId = ftId;
        t.revision++;
        notify(s, {
          key: `assessment:${t.id}:ft:${ftId}`,
          recipientId: ftId,
          lv1OrganizationId: a.lv1OrganizationId,
          assignmentId: a.id,
          type: "assessment",
          title:
            t.kind === "subjective" ? "주관식 채점 요청" : "실기 평가 요청",
          body: `${find(s.users, a.learnerId).name} · ${find(s.courses, t.courseId).title}`,
          href: `/evaluations/${a.id}/${t.courseId}${t.kind === "subjective" ? "/subjective" : ""}`,
        });
      }
      a.ftId = ftId;
    }
    a.revision++;
    return { id: a.id, revision: a.revision };
  }
  if (action === "attempt.start") {
    const { e, a, c } = context(s, target);
    active(a);
    const kind = KindSchema.parse(body.kind);
    demand(requiredKinds(c).includes(kind), 422, "필수 평가가 아닙니다.");
    demand(
      !a.planId ||
        c.learningItems
          .filter((i) => i.required)
          .every((i) =>
            s.learningRecords.some(
              (r) => r.enrollmentId === e.id && r.itemId === i.id,
            ),
          ),
      409,
      "필수 학습 항목의 완료 기록을 먼저 작성해 주세요.",
      "LEARNING_REQUIRED",
    );
    if (kind === "practical")
      demand(
        s.users.some((user) => user.id === a.ftId && user.roles.includes("ft")),
        409,
        "담당 FT의 역할이 변경되었습니다. 조직 관리자에게 FT 재배정을 요청해 주세요.",
      );
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
      verdicts: {},
      ...(kind === "subjective"
        ? { subjectiveAnswers: {}, grades: {}, feedback: "" }
        : {}),
      ...(kind === "practical" ? { evaluatorId: a.ftId! } : {}),
    };
    s.attempts.push(t);
    if (kind === "practical")
      notify(s, {
        key: `assessment:${t.id}:ft:${a.ftId}`,
        recipientId: a.ftId!,
        lv1OrganizationId: a.lv1OrganizationId,
        assignmentId: a.id,
        type: "assessment",
        title: "실기 평가 요청",
        body: `${u.name} · ${c.title}`,
        href: `/evaluations/${a.id}/${c.id}`,
      });
    audit(s, u, action, t.id, "", a.id);
    return { id: t.id, revision: t.revision };
  }
  if (action.startsWith("attempt.")) {
    const t = find(s.attempts, target),
      { a, c } = context(s, t.enrollmentId);
    active(a);
    expected(t, body.revision);
    if (action.startsWith("attempt.grade")) {
      demand(
        t.kind === "subjective" && t.status === "submitted",
        409,
        "제출된 주관식 답안만 채점할 수 있습니다.",
      );
      const fields = z
        .object({
          grades: z.record(idSchema, GradeSchema),
          feedback: z.string().max(20000),
        })
        .parse(body);
      demand(
        Object.entries(fields.grades).every(([id, grade]) =>
          c.subjectiveQuestions.some(
            (q) => q.id === id && grade.points <= q.points,
          ),
        ),
        422,
        "문항별 배점 범위를 확인해 주세요.",
      );
      Object.assign(t, fields);
      if (action === "attempt.grade.finalize") {
        demand(
          c.subjectiveQuestions.every((q) => t.grades?.[q.id]?.reason.trim()),
          422,
          "모든 문항의 점수와 채점 근거를 입력해 주세요.",
        );
        t.total = c.subjectiveQuestions.reduce((n, q) => n + q.points, 0);
        t.earned = c.subjectiveQuestions.reduce(
          (n, q) => n + t.grades![q.id]!.points,
          0,
        );
        t.result =
          t.earned * 100 >= t.total * c.subjectivePassScore!
            ? "passed"
            : "failed";
        demand(
          t.result !== "failed" || fields.feedback.trim(),
          422,
          "미통과한 학습자에게 공개할 피드백을 입력해 주세요.",
        );
        t.status = "graded";
        t.date = now();
        t.evaluatorId = u.id;
        const awarded = reconcile(s, t.enrollmentId, organizations);
        if (!awarded)
          notify(s, {
            key: `result:${t.id}`,
            recipientId: a.learnerId,
            lv1OrganizationId: a.lv1OrganizationId,
            assignmentId: a.id,
            type: "result",
            title: `주관식 평가 ${t.result === "passed" ? "통과" : "미통과"}`,
            body: c.title,
            href: `/qualifications/${a.id}/courses/${c.id}/subjective`,
          });
      }
      t.revision++;
      audit(
        s,
        u,
        action,
        t.id,
        action.endsWith("finalize") ? "주관식 채점 확정" : "채점 초안 저장",
        a.id,
      );
      return { id: t.id, revision: t.revision, result: t.result };
    }
    demand(t.status === "in_progress", 409, "이미 확정된 평가입니다.");
    if (action === "attempt.save") {
      Object.assign(t, validateDraft(t, s, body));
      t.revision++;
      return { id: t.id, revision: t.revision };
    }
    if (t.kind === "subjective") {
      demand(
        s.users.some(
          (u) =>
            u.id === a.ftId && u.roles.includes("ft") && u.id !== a.learnerId,
        ),
        409,
        "담당 FT 배정 후 주관식 답안을 제출할 수 있습니다.",
        "FT_REQUIRED",
      );
      demand(
        c.subjectiveQuestions.every((q) => t.subjectiveAnswers?.[q.id]?.trim()),
        422,
        "모든 문항에 답해 주세요.",
      );
      t.status = "submitted";
      t.submittedAt = now();
      t.evaluatorId = a.ftId!;
      t.revision++;
      notify(s, {
        key: `assessment:${t.id}:ft:${a.ftId}`,
        recipientId: a.ftId!,
        lv1OrganizationId: a.lv1OrganizationId,
        assignmentId: a.id,
        type: "assessment",
        title: "주관식 채점 요청",
        body: `${u.name} · ${c.title}`,
        href: `/evaluations/${a.id}/${c.id}/subjective`,
      });
      audit(s, u, action, t.id, "주관식 답안 제출", a.id);
      return { id: t.id, revision: t.revision, status: t.status };
    }
    if (t.kind === "objective") {
      demand(
        c.questions.every((q) => t.answers[q.id] !== undefined),
        422,
        "모든 문항에 답해 주세요.",
      );
      t.itemResults = c.questions.map((q) => ({
        itemId: q.id,
        correct: t.answers[q.id] === q.correct,
        earned: t.answers[q.id] === q.correct ? q.points : 0,
        possible: q.points,
      }));
      t.total = c.questions.reduce((v, q) => v + q.points, 0);
      t.earned = t.itemResults.reduce((v, r) => v + r.earned, 0);
      t.result = t.earned * 100 >= t.total * c.passScore! ? "passed" : "failed";
    } else {
      demand(
        c.practicalItems.every(
          (i) => t.verdicts[i.id]?.value && t.verdicts[i.id]?.evidence.trim(),
        ),
        422,
        "각 항목의 판정과 근거를 입력해 주세요.",
      );
      t.evaluatorId = u.id;
      t.result = c.practicalItems
        .filter((i) => i.mandatory)
        .every((i) => t.verdicts[i.id]?.value === "pass")
        ? "passed"
        : "failed";
    }
    t.status = "graded";
    t.date = now();
    t.submittedAt = t.date;
    t.revision++;
    const awarded = reconcile(s, t.enrollmentId, organizations);
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
  if (action === "notice.save") {
    const current = s.notices.find((n) => n.id === body.id);
    if (current) expected(current, body.revision);
    const n = NoticeSchema.parse({
      ...body,
      id: current?.id || uid(),
      lv1OrganizationId: current?.lv1OrganizationId || scope,
      date: body.date || now().slice(0, 10),
      revision: current ? current.revision + 1 : 1,
    });
    demand(
      n.title.trim() && n.body.trim(),
      422,
      "제목과 내용을 입력해 주세요.",
    );
    if (current) Object.assign(current, n);
    else s.notices.push(n);
    audit(s, u, action, n.id, "공지 저장");
    return { id: n.id, revision: n.revision };
  }
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
      "동일 과정의 확정 회차를 평가별로 선택해 주세요.",
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
      objectiveAttempts: s.attempts.filter(
        (t) => enrollments.has(t.enrollmentId) && t.kind === "objective",
      ).length,
      practicalAttempts: s.attempts.filter(
        (t) => enrollments.has(t.enrollmentId) && t.kind === "practical",
      ).length,
      subjectiveAttempts: s.attempts.filter(
        (t) => enrollments.has(t.enrollmentId) && t.kind === "subjective",
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
  const copy = structuredClone(t),
    full = owner(a, u) || u.roles.includes("system_operator"),
    practicalFT =
      u.roles.includes("ft") && a.ftId === u.id && a.learnerId !== u.id;
  if (!full) {
    delete copy.earned;
    delete copy.total;
    delete copy.itemResults;
    if (!(
      t.kind === "objective" &&
      t.status === "in_progress" &&
      a.learnerId === u.id
    ))
      copy.answers = {};
    if (!(t.kind === "practical" && practicalFT)) copy.verdicts = {};
    if (!(t.kind === "subjective" && (a.learnerId === u.id || practicalFT)))
      copy.subjectiveAnswers = {};
    if (!(t.kind === "subjective" && practicalFT)) copy.grades = {};
    if (t.status !== "graded" && !practicalFT) delete copy.feedback;
  }
  return copy;
}
export function workspace(
  s: State,
  u: User,
  organizations: OrganizationDocument,
  lv1?: string,
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
  if (u.roles.includes("learner") && u.organizationActive)
    for (const q of s.qualifications)
      if (
        q.lv1OrganizationId === u.lv1OrganizationId &&
        q.status === "published" &&
        !qualificationUseErrors(q, s.courses).length
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
    plans,
    planningRequests: s.planningRequests.filter(
      (r) =>
        visibleScope(r.lv1OrganizationId) &&
        (admin || (u.roles.includes("learner") && r.learnerId === u.id)),
    ),
    notifications: s.notifications.filter((n) => n.recipientId === u.id),
    management: {
      lv1OrganizationId: operator
        ? lv1 || null
        : u.roles.includes("admin")
          ? u.lv1OrganizationId
          : null,
      canManage: operator ? !!lv1 : u.roles.includes("admin"),
    },
    organizations: organizationEntries(organizations).filter(
      (e) => operator || e.lv1OrganizationId === u.lv1OrganizationId,
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
              [a.learnerId, a.ftId, a.ownerAdminId].includes(user.id),
            ) ||
            s.attempts.some(
              (t) =>
                t.evaluatorId === user.id &&
                assignments.some((a) =>
                  s.enrollments.some(
                    (e) => e.id === t.enrollmentId && e.assignmentId === a.id,
                  ),
                ),
            )),
      ),
    qualifications: s.qualifications.filter(
      (q) => visibleScope(q.lv1OrganizationId) && (admin || qids.has(q.id)),
    ),
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
          const assignedFT =
            u.roles.includes("ft") &&
            assignments.some(
              (a) =>
                a.ftId === u.id &&
                a.learnerId !== u.id &&
                s.enrollments.some(
                  (e) => e.assignmentId === a.id && e.courseId === c.id,
                ),
            );
          if (!assignedFT)
            copy.subjectiveQuestions = copy.subjectiveQuestions.map(
              ({ rubric, modelAnswer, ...q }) => q,
            );
          if (!cids.has(c.id)) {
            copy.questions = [];
            copy.subjectiveQuestions = [];
            copy.practicalItems = [];
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
                  ? kind === "practical" ||
                    activeAttempts[kind]?.status === "submitted"
                    ? "waiting"
                    : "draft"
                  : ts.some((t) => t.kind === kind && t.result === "failed")
                    ? "failed"
                    : "ready";
            return {
              id: e.id,
              courseId: e.courseId,
              objective: state("objective"),
              practical: state("practical"),
              subjective: state("subjective"),
              learningComplete:
                !a.planId ||
                find(s.courses, e.courseId)
                  .learningItems.filter((i) => i.required)
                  .every((i) =>
                    s.learningRecords.some(
                      (r) => r.enrollmentId === e.id && r.itemId === i.id,
                    ),
                  ),
              learningRecords: s.learningRecords.filter(
                (r) => r.enrollmentId === e.id,
              ),
              answers: activeAttempts.objective?.answers || {},
              verdicts: activeAttempts.practical?.verdicts || {},
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
                    evaluatorId: v.evaluatorId,
                    feedback: v.feedback,
                    ...(admin
                      ? {
                          answers: v.answers,
                          verdicts: v.verdicts,
                          earned: v.earned,
                          total: v.total,
                          itemResults: v.itemResults,
                          subjectiveAnswers: v.subjectiveAnswers,
                          grades: v.grades,
                        }
                      : a.ftId === u.id
                        ? {
                            verdicts: v.verdicts,
                            subjectiveAnswers: v.subjectiveAnswers,
                            grades: v.grades,
                          }
                        : {}),
                  };
                }),
            };
          }),
      };
    }),
    notices: s.notices.filter(
      (n) => visibleScope(n.lv1OrganizationId) && (admin || n.published),
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
