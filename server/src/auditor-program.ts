import { latestQualification } from "@eks/contracts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AuditorLevelSchema,
  AuditorNoticeSchema,
  QualificationSchema,
  qualificationPolicySnapshot,
  qualificationUseErrors,
  effectiveCredentialStatus,
  credentialCurrent,
  auditorLevelLabels,
  type State,
  type OrganizationDocument,
  type UserView,
  type User,
  type AuditorLevel,
  type AuditorProgram,
} from "@eks/contracts";
import { demand } from "./errors.ts";
import { currentQualification, metadata } from "./qualification-templates.ts";
import { userView } from "./organizations.ts";
import { notify } from "./notifications.ts";
import {
  renewalAvailability,
  reconcileLifecycle,
} from "./qualification-lifecycle.ts";

export function programFor(s: State, team: string) {
  return s.auditorPrograms.find((p) => p.lv1OrganizationId === team);
}
export function appliedAuditor(s: State, team: string, level: AuditorLevel) {
  const ref = programFor(s, team)?.[level];
  return ref ? latestQualification(s, team, ref.entityId) : undefined;
}
export function auditorReadiness(s: State, team: string, level: AuditorLevel) {
  const q = appliedAuditor(s, team, level);
  const reasons = q
    ? qualificationUseErrors(currentQualification(s, q), s.courses)
    : [`팀에서 ${level === "main" ? "메인" : "일반"} 기준을 준비 중입니다.`];
  if (
    q &&
    (q.deletedAt || (q.lifecycleStatus && q.lifecycleStatus !== "Active"))
  )
    reasons.push("자격 기준이 운영 중이 아닙니다.");
  return {
    ready: !reasons.length,
    reasons,
    template:
      s.qualificationTemplates.find(
        (t) => t.id === programFor(s, team)?.[level]?.templateId,
      ) || null,
    qualification: q ? currentQualification(s, q) : null,
  };
}
export function auditorProgramView(s: State, team: string) {
  const program = programFor(s, team);
  const general = auditorReadiness(s, team, "general"),
    main = auditorReadiness(s, team, "main");
  const reasons = [...general.reasons];
  if (!program?.notice.title || !program.notice.body)
    reasons.push("지정 안내문의 제목과 본문이 필요합니다.");
  return {
    program: program || null,
    general,
    main,
    readiness: { ready: !reasons.length, reasons },
  };
}
export function activeAuditorCertification(
  s: State,
  userId: string,
  level: AuditorLevel,
  at: string,
) {
  return s.certifications.find(
    (c) =>
      c.learnerId === userId &&
      c.auditor?.level === level &&
      effectiveCredentialStatus(c, at) === "Active" &&
      !s.assignments.find((a) => a.id === c.assignmentId)?.excludedReason,
  );
}
export function auditorMe(
  s: State,
  u: UserView,
  at: string,
  doc?: OrganizationDocument,
) {
  const settings = auditorProgramView(s, u.lv1OrganizationId);
  const levels = (["general", "main"] as const).map((level) => {
    const certification = activeAuditorCertification(s, u.id, level, at);
    const history = s.certifications.filter(
      (c) => c.learnerId === u.id && c.auditor?.level === level,
    );
    const assignment = s.assignments.find(
      (a) =>
        a.learnerId === u.id &&
        a.auditor?.level === level &&
        !a.excludedReason &&
        !a.acquisitionClosedAt &&
        !s.certifications.some((c) => c.assignmentId === a.id),
    );
    const reasons: string[] = [];
    if (!u.roles.includes("evaluator"))
      reasons.push(
        "현재 Auditor 지정이 해제되어 새 학습·갱신을 시작할 수 없습니다.",
      );
    if (!u.organizationActive) reasons.push("사용 중인 조직이 필요합니다.");
    if (u.certificationEligibility === "hold")
      reasons.push("취득 대상자 Hold 상태입니다.");
    if (certification) reasons.push("이미 유효한 자격을 보유하고 있습니다.");
    if (history.some((c) => effectiveCredentialStatus(c, at) === "Hold"))
      reasons.push("정지된 인증의 효력을 먼저 확인해 주세요.");
    if (
      level === "main" &&
      !history.length &&
      !activeAuditorCertification(s, u.id, "general", at)
    )
      reasons.push("최초 메인 취득에는 유효한 일반 Auditor 인증이 필요합니다.");
    reasons.push(...settings[level].reasons);
    const enrollments = s.enrollments.filter(
      (e) => e.assignmentId === assignment?.id,
    );
    const completed = enrollments.filter((e) =>
      s.completions.some((c) => c.enrollmentId === e.id),
    ).length;
    const renewal =
      certification && doc
        ? renewalAvailability(s, doc, certification, at)
        : null;
    const canStart = !reasons.length && !assignment;
    return {
      level,
      certification: certification
        ? { ...certification, ...credentialCurrent(certification) }
        : null,
      renewal,
      nextAction: renewal?.canStart
        ? "renew"
        : assignment
          ? "continue"
          : canStart
            ? history.length
              ? "reacquire"
              : "start"
            : null,
      history,
      assignment: assignment || null,
      completed,
      total: enrollments.length,
      pendingAward:
        !!assignment && completed > 0 && completed === enrollments.length,
      canStart,
      reasons,
      kind: history.length ? "reacquisition" : "initial",
    };
  });
  return {
    designated: u.roles.includes("evaluator"),
    currentLevel: levels[1]!.certification
      ? "main"
      : levels[0]!.certification
        ? "general"
        : null,
    notice: settings.program?.notice || null,
    levels,
    legacyCertifications: s.certifications.filter(
      (c) =>
        c.learnerId === u.id &&
        !c.auditor &&
        s.qualifications.find((q) => q.id === c.qualificationId)
          ?.qualificationType === "auditor",
    ),
  };
}
function ensureProgram(s: State, team: string, actor: UserView, at: string) {
  let p = programFor(s, team);
  if (!p) {
    p = {
      lv1OrganizationId: team,
      revision: 1,
      notice: { revision: 0, title: "", body: "", links: [] },
      updatedBy: actor.id,
      updatedAt: at,
    };
    s.auditorPrograms.push(p);
  }
  return p;
}
function checkRevision(p: AuditorProgram | undefined, revision: number) {
  demand(
    (p?.revision || 0) === revision,
    409,
    "다른 창에서 운영 기준이 변경되었습니다. 입력을 보존하고 최신 기준을 확인해 주세요.",
    "REVISION_CONFLICT",
  );
}
function audit(
  s: State,
  u: UserView,
  team: string,
  action: string,
  targetId: string,
  at: string,
) {
  s.audits.push({
    id: randomUUID(),
    actorId: u.id,
    lv1OrganizationId: team,
    action,
    targetId,
    date: at,
    reason: "Auditor 운영",
    details: {},
  });
}
export function saveAuditorProgram(
  s: State,
  u: UserView,
  team: string,
  body: unknown,
  at: string,
) {
  demand(
    !body ||
      typeof body !== "object" ||
      !("generalQualificationId" in body || "mainQualificationId" in body),
    410,
    "기준 버전은 자동으로 선택됩니다. 화면을 새로고침해 주세요.",
    "TEAM_APPLICATION_REMOVED",
  );
  const input = z
    .object({
      revision: z.number().int().nonnegative(),
      notice: AuditorNoticeSchema.omit({ revision: true }),
      titles: z
        .array(
          z.object({
            level: AuditorLevelSchema,
            title: z.string().trim().min(1).max(300),
            description: z.string().max(20000).default(""),
          }),
        )
        .max(2)
        .optional(),
    })
    .strict()
    .parse(body);
  checkRevision(programFor(s, team), input.revision);
  const p = ensureProgram(s, team, u, at);
  for (const edit of input.titles || []) {
    const t = s.qualificationTemplates.find(
      (t) =>
        t.id === p[edit.level]?.templateId && t.ownerLv1OrganizationId === team,
    );
    demand(t, 422, "팀의 대표 자격을 먼저 생성해 주세요.");
    if (t.title !== edit.title || t.description !== edit.description) {
      t.title = edit.title;
      t.description = edit.description;
      t.revision++;
      t.updatedAt = at;
      t.updatedBy = u.id;
    }
  }
  if (
    JSON.stringify(input.notice) !==
    JSON.stringify({
      title: p.notice.title,
      body: p.notice.body,
      links: p.notice.links,
    })
  )
    p.notice = { ...input.notice, revision: p.notice.revision + 1 };
  p.revision++;
  p.updatedBy = u.id;
  p.updatedAt = at;
  audit(s, u, team, "auditor.program.save", team, at);
  return auditorProgramView(s, team);
}
export function createAuditorQualification(
  s: State,
  u: UserView,
  team: string,
  body: unknown,
  at: string,
) {
  const input = z
    .object({
      revision: z.number().int().nonnegative(),
      level: AuditorLevelSchema,
      title: z.string().trim().min(1).max(300),
      description: z.string().max(20000).default(""),
    })
    .strict()
    .parse(body);
  checkRevision(programFor(s, team), input.revision);
  const p = ensureProgram(s, team, u, at);
  demand(
    !appliedAuditor(s, team, input.level),
    409,
    "등급별 대표 자격은 하나만 생성할 수 있습니다. 기존 계보를 개정해 주세요.",
  );
  const previous = p[input.level];
  const templateId = previous?.templateId || randomUUID(),
    id = randomUUID();
  if (previous) {
    const template = s.qualificationTemplates.find((t) => t.id === templateId)!;
    template.title = input.title;
    template.description = input.description;
    template.revision++;
    template.updatedBy = u.id;
    template.updatedAt = at;
  }
  if (!previous)
    s.qualificationTemplates.push({
      id: templateId,
      defaultCommonCourseIds: [],
      scope: "team",
      ownerLv1OrganizationId: team,
      auditorLevel: input.level,
      qualificationType: "auditor",
      revision: 1,
      title: input.title,
      description: input.description,
      englishName: "",
      updatedBy: u.id,
      updatedAt: at,
    });
  s.qualifications.push(
    QualificationSchema.parse({
      id,
      entityId: previous?.entityId || id,
      lv1OrganizationId: team,
      version: previous
        ? Math.max(
            ...s.qualifications
              .filter(
                (q) =>
                  q.entityId === previous.entityId &&
                  q.lv1OrganizationId === team,
              )
              .map((q) => q.version ?? 0),
          ) + 1
        : 1,
      revision: 1,
      title: input.title,
      description: input.description,
      englishName: "",
      qualificationType: "auditor",
      templateId,
      templateRevision: s.qualificationTemplates.find(
        (t) => t.id === templateId,
      )!.revision,
      courseIds: [],
      validity: { type: "unknown", months: null, reminderDays: [] },
      renewalLeadMonths: 3,
      renewalNoticeDaysBefore: 7,
    }),
  );
  p[input.level] = { templateId, entityId: previous?.entityId || id };
  p.revision++;
  p.updatedBy = u.id;
  p.updatedAt = at;
  audit(s, u, team, "auditor.qualification.create", id, at);
  return { id, ...auditorProgramView(s, team) };
}
export function sendAuditorNotice(
  s: State,
  team: string,
  recipientId: string,
  key: string,
  at: string,
) {
  const p = programFor(s, team);
  demand(
    p?.notice.title && p.notice.body,
    409,
    "지정 안내문을 먼저 준비해 주세요.",
  );
  notify(
    s,
    {
      key,
      recipientId,
      lv1OrganizationId: team,
      qualificationType: "auditor",
      type: "auditor_designation",
      title: p.notice.title,
      body: p.notice.body,
      href: "/auditor",
      auditorNotice: structuredClone(p.notice),
    },
    at,
  );
}
export function designateAuditor(
  s: State,
  user: User,
  actor: User,
  team: string,
  at: string,
) {
  const readiness = auditorProgramView(s, team).readiness;
  demand(
    readiness.ready,
    409,
    readiness.reasons.join(" · "),
    "AUDITOR_NOT_READY",
  );
  user.auditorDesignation = {
    id: randomUUID(),
    actorId: actor.id,
    at,
    source: "designation",
  };
  sendAuditorNotice(
    s,
    team,
    user.id,
    `auditor:designation:${user.auditorDesignation.id}`,
    at,
  );
}
export function startAuditor(
  s: State,
  doc: OrganizationDocument,
  u: UserView,
  body: unknown,
  at: string,
) {
  const { level } = z
    .object({ level: AuditorLevelSchema })
    .strict()
    .parse(body);
  reconcileLifecycle(s, at);
  const view = auditorMe(s, u, at).levels.find((l) => l.level === level)!;
  demand(
    u.roles.includes("evaluator") &&
      u.organizationActive &&
      u.certificationEligibility !== "hold",
    403,
    "사용 중인 조직의 Auditor 지정과 취득 가능 상태가 필요합니다.",
  );
  if (view.certification)
    return {
      certificationId: view.certification.id,
      assignmentId: view.certification.assignmentId,
    };
  if (view.assignment) return { assignmentId: view.assignment.id };
  demand(
    view.canStart,
    409,
    view.reasons.join(" · "),
    "AUDITOR_START_UNAVAILABLE",
  );
  const p = programFor(s, u.lv1OrganizationId)!,
    q = currentQualification(s, appliedAuditor(s, u.lv1OrganizationId, level)!);
  const previous = view.history.at(-1);
  const id = randomUUID();
  s.assignments.push({
    id,
    acquisitionCycleId: randomUUID(),
    ...(previous ? { previousCertificationId: previous.id } : {}),
    auditor: {
      level,
      kind: previous ? "reacquisition" : "initial",
      designationId: u.auditorDesignation?.id || `legacy:${u.id}`,
      programRevision: p.revision,
      criteriaManagerId: p.updatedBy,
    },
    lv1OrganizationId: u.lv1OrganizationId,
    organizationPath: structuredClone(u.organizationPath),
    organizationSource: "assigned",
    qualificationId: q.id,
    qualificationMetadata: metadata(q),
    qualificationPolicySnapshot: qualificationPolicySnapshot(q),
    learnerId: u.id,
    ownerAdminId: p.updatedBy,
    assignedAt: at,
    createdBy: u.id,
    revision: 1,
  });
  for (const courseId of q.courseIds)
    s.enrollments.push({ id: randomUUID(), assignmentId: id, courseId });
  if (previous) {
    const old = s.assignments.find((a) => a.id === previous.assignmentId);
    if (old) old.acquisitionClosedAt = at;
  }
  audit(s, u, u.lv1OrganizationId, "auditor.learning.start", id, at);
  return { assignmentId: id };
}
export function auditorMembers(
  s: State,
  doc: OrganizationDocument,
  team: string,
  at: string,
) {
  return s.users
    .map((u) => userView(u, doc))
    .filter(
      (u) =>
        u.lv1OrganizationId === team &&
        (u.roles.includes("evaluator") ||
          s.assignments.some(
            (a) =>
              a.learnerId === u.id &&
              s.qualifications.find((q) => q.id === a.qualificationId)
                ?.qualificationType === "auditor",
          )),
    )
    .map((u) => ({ id: u.id, name: u.name, ...auditorMe(s, u, at, doc) }));
}
