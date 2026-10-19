import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  CourseSchema,
  QualificationSchema,
  DraftSchema,
  NoticeSchema,
  ComparisonSchema,
  requiredKinds,
  courseErrors,
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
} from "@eks/contracts";
import { demand } from "./storage.ts";
import { userView, organization, systemOperator } from "./organizations.ts";
import { changeCourseLifecycle, courseUsage } from "./course-lifecycle.ts";

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
    if (action === "attempt.start" || kind === "objective")
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
function reconcile(s: State, enrollmentId: string) {
  const { e, a, c } = context(s, enrollmentId);
  active(a);
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
  )
    s.completions.push({
      id: uid(),
      enrollmentId: e.id,
      learnerId: a.learnerId,
      courseId: c.id,
      date: now(),
      evidence: evidence as { kind: Kind; attemptId: string }[],
    });
  const all = s.enrollments.filter((en) => en.assignmentId === a.id),
    completed = all.map((en) => ({
      enrollmentId: en.id,
      completionId: s.completions.find((co) => co.enrollmentId === en.id)?.id,
    }));
  if (
    all.length &&
    completed.every((ev) => ev.completionId) &&
    !s.certifications.some((cert) => cert.assignmentId === a.id)
  )
    s.certifications.push({
      id: uid(),
      assignmentId: a.id,
      learnerId: a.learnerId,
      qualificationId: a.qualificationId,
      date: now(),
      evidence: completed as { enrollmentId: string; completionId: string }[],
    });
}
function validateDraft(t: AssessmentAttempt, s: State, body: unknown) {
  const draft = DraftSchema.parse(body),
    c = find(s.courses, t.courseId);
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
): any {
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
            r.action.startsWith("comparison."))
        ),
    );
    s.audits = s.audits.filter(
      (ev) =>
        !(
          ev.assignmentId &&
          affected.has(ev.assignmentId) &&
          (ev.action.startsWith("attempt.") ||
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
        s.courses.push({
          ...base,
          operationalStatus: "active",
          mode: "both",
          passScore: null,
          material: "",
          materialUrl: "",
          instruction: "매뉴얼 참고 가능 · 타인의 도움 없이 수행",
          questions: [],
          practicalItems: [],
        });
      else s.qualifications.push({ ...base, courseIds: [] });
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
        : {}),
    });
    if (!isCourse)
      demand(
        (parsed as State["qualifications"][number]).courseIds.every((id) =>
          s.courses.some((c) => c.id === id && c.lv1OrganizationId === scope),
        ),
        422,
        "과정을 찾을 수 없습니다.",
      );
    if (action === "catalog.publish") {
      const errors = isCourse
        ? courseErrors(parsed as State["courses"][number])
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
    const input = z
        .object({
          qualificationId: idSchema,
          learnerId: idSchema,
          ftId: idSchema.nullable(),
        })
        .parse(body),
      q = find(s.qualifications, input.qualificationId);
    const learner = participant(input.learnerId, "learner");
    if (input.ftId) participant(input.ftId, "ft");
    demand(
      q.status === "published" && !qualificationErrors(q, s.courses).length,
      422,
      "사용 중인 자격을 선택해 주세요.",
    );
    const availabilityErrors = qualificationUseErrors(q, s.courses);
    demand(!availabilityErrors.length, 422, availabilityErrors.join("\n"));
    demand(
      s.users.some(
        (x) => x.id === input.learnerId && x.roles.includes("learner"),
      ),
      422,
      "학습자를 확인해 주세요.",
    );
    const needsFT = q.courseIds.some((id) =>
      requiredKinds(find(s.courses, id)).includes("practical"),
    );
    if (needsFT)
      demand(
        input.ftId !== input.learnerId &&
          s.users.some((x) => x.id === input.ftId && x.roles.includes("ft")),
        422,
        "대상자와 FT를 확인해 주세요.",
      );
    demand(
      !s.assignments.some(
        (a) =>
          a.qualificationId === q.id &&
          a.learnerId === input.learnerId &&
          !a.excludedReason,
      ),
      409,
      "이미 배정된 자격입니다.",
    );
    const id = uid();
    s.assignments.push({
      ...input,
      id,
      ftId: needsFT ? input.ftId : null,
      ownerAdminId: u.id,
      lv1OrganizationId: scope,
      organizationPath: learner.organizationPath,
      organizationSource: "assigned",
      revision: 1,
      assignedAt: now(),
    });
    q.courseIds.forEach((courseId) =>
      s.enrollments.push({ id: uid(), assignmentId: id, courseId }),
    );
    audit(s, u, action, id, "자격 배정", id);
    return { id };
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
            requiredKinds(find(s.courses, e.courseId)).includes("practical"),
          ),
        422,
        "실기 평가가 없는 과제입니다.",
      );
      const drafts = s.attempts.filter(
        (t) =>
          t.kind === "practical" &&
          t.status === "in_progress" &&
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
            })),
          }),
        ),
      );
      for (const t of drafts) {
        t.verdicts = {};
        t.evaluatorId = ftId;
        t.revision++;
      }
      a.ftId = ftId;
    }
    a.revision++;
    return { id: a.id, revision: a.revision };
  }
  if (action === "attempt.start") {
    const { e, a, c } = context(s, target);
    active(a);
    const kind = z.enum(["objective", "practical"]).parse(body.kind);
    demand(requiredKinds(c).includes(kind), 422, "필수 평가가 아닙니다.");
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
        t.enrollmentId === e.id &&
        t.kind === kind &&
        t.status === "in_progress",
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
      ...(kind === "practical" ? { evaluatorId: a.ftId! } : {}),
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
    if (action === "attempt.save") {
      Object.assign(t, validateDraft(t, s, body));
      t.revision++;
      return { id: t.id, revision: t.revision };
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
    t.status = "submitted";
    t.date = now();
    t.revision++;
    reconcile(s, t.enrollmentId);
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
          t.status === "submitted",
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
  const qids = new Set(assignments.map((a) => a.qualificationId)),
    cids = new Set(
      s.enrollments
        .filter((e) => assignments.some((a) => a.id === e.assignmentId))
        .map((e) => e.courseId),
    );
  const admin = u.roles.includes("admin") || operator;
  return {
    actor: u,
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
        (c) => visibleScope(c.lv1OrganizationId) && (admin || cids.has(c.id)),
      )
      .map((c) => {
        const copy = structuredClone(c);
        if (!admin)
          copy.questions = copy.questions.map((q) => {
            const { correct, ...safe } = q;
            return safe;
          });
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
                  .filter((t) => t.status === "in_progress")
                  .map((t) => [t.kind, attemptView(s, u, t)]),
              );
            const state = (kind: Kind) =>
              ts.some((t) => t.kind === kind && t.result === "passed")
                ? "passed"
                : activeAttempts[kind]
                  ? kind === "objective"
                    ? "draft"
                    : "waiting"
                  : ts.some((t) => t.kind === kind && t.result === "failed")
                    ? "failed"
                    : "ready";
            return {
              id: e.id,
              courseId: e.courseId,
              objective: state("objective"),
              practical: state("practical"),
              answers: activeAttempts.objective?.answers || {},
              verdicts: activeAttempts.practical?.verdicts || {},
              activeAttempts,
              completion: s.completions.find((c) => c.enrollmentId === e.id),
              history: ts
                .filter((t) => t.status === "submitted")
                .map((t) => {
                  const v = attemptView(s, u, t);
                  return {
                    id: v.id,
                    kind: v.kind,
                    round: v.round,
                    result: v.result!,
                    date: v.date!,
                    evaluatorId: v.evaluatorId,
                    ...(admin
                      ? {
                          answers: v.answers,
                          verdicts: v.verdicts,
                          earned: v.earned,
                          total: v.total,
                          itemResults: v.itemResults,
                        }
                      : v.kind === "practical" && a.ftId === u.id
                        ? { verdicts: v.verdicts }
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
