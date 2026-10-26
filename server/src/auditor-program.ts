import {
  auditorCriteria,
  activeAuditorQualifications,
  currentAuditorQualifications,
  prerequisiteCertification,
  auditorTemplateErrors,
} from "./auditor-pool.ts";
import { latestQualification } from "@eks/contracts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AuditorNoticeSchema,
  qualificationPolicySnapshot,
  qualificationUseErrors,
  effectiveCredentialStatus,
  credentialCurrent,
  type State,
  type Qualification,
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
  return activeAuditorQualifications(s, team).find(
    (q) => auditorCriteria(s, q)?.level === level,
  );
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
      s.qualificationTemplates.find((t) => t.id === q?.templateId) || null,
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
  const entries = new Map<string, Qualification>();
  for (const q of currentAuditorQualifications(s, u.lv1OrganizationId))
    if (auditorCriteria(s, q))
      entries.set(q.lv1OrganizationId + ":" + q.entityId, q);
  for (const a of s.assignments.filter(
    (a) => a.learnerId === u.id && a.auditor,
  )) {
    const original = s.qualifications.find((q) => q.id === a.qualificationId)!;
    const key = original.lv1OrganizationId + ":" + original.entityId;
    if (!entries.has(key))
      entries.set(
        key,
        latestQualification(s, original.lv1OrganizationId, original.entityId) ||
          original,
      );
  }
  const levels = [...entries.values()].map((q) => {
    const criteria = auditorCriteria(s, q),
      level =
        criteria?.level ||
        s.assignments.find((a) => a.qualificationId === q.id && a.auditor)
          ?.auditor?.level ||
        "general";
    const assignments = s.assignments.filter(
      (a) =>
        a.learnerId === u.id &&
        a.lv1OrganizationId === q.lv1OrganizationId &&
        a.auditor &&
        s.qualifications.find((x) => x.id === a.qualificationId)?.entityId ===
          q.entityId,
    );
    const history = s.certifications.filter((c) =>
      assignments.some((a) => a.id === c.assignmentId),
    );
    const certification = history.find(
      (c) =>
        effectiveCredentialStatus(c, at) === "Active" &&
        !assignments.find((a) => a.id === c.assignmentId)?.excludedReason,
    );
    const assignment = assignments.find(
      (a) =>
        !a.excludedReason &&
        !a.acquisitionClosedAt &&
        !history.some((c) => c.assignmentId === a.id),
    );
    const reasons: string[] = [];
    if (!u.roles.includes("evaluator"))
      reasons.push(
        "현재 Auditor 지정이 해제되어 새 학습·갱신을 시작할 수 없습니다.",
      );
    if (!u.organizationActive) reasons.push("사용 중인 조직이 필요합니다.");
    if (u.certificationEligibility === "hold")
      reasons.push("취득 대상자 Hold 상태입니다.");
    if (q.lv1OrganizationId !== u.lv1OrganizationId)
      reasons.push("이전 팀의 자격 기록입니다.");
    if (certification) reasons.push("이미 유효한 자격을 보유하고 있습니다.");
    if (history.some((c) => effectiveCredentialStatus(c, at) === "Hold"))
      reasons.push("정지된 인증의 효력을 먼저 확인해 주세요.");
    const template = s.qualificationTemplates.find(
      (t) => t.id === q.templateId,
    )!;
    reasons.push(
      ...qualificationUseErrors(q, s.courses),
      ...auditorTemplateErrors(s, template),
    );
    if (q.deletedAt) reasons.push("삭제된 자격입니다.");
    const prerequisite = criteria?.prerequisiteTemplateId
      ? s.qualificationTemplates.find(
          (t) => t.id === criteria.prerequisiteTemplateId,
        )
      : undefined;
    if (level === "main" && !history.length) {
      const satisfied = criteria?.prerequisiteTemplateId
        ? prerequisiteCertification(
            s,
            u.id,
            u.lv1OrganizationId,
            criteria.prerequisiteTemplateId,
            at,
          )
        : template.scope === "team"
          ? activeAuditorCertification(s, u.id, "general", at)
          : undefined;
      if (!satisfied)
        reasons.push(
          prerequisite
            ? `최초 메인 취득에는 현재 팀의 ${prerequisite.title} 유효 인증이 필요합니다.`
            : "최초 메인 취득에는 유효한 일반 Auditor 인증이 필요합니다.",
        );
    }
    const enrollments = s.enrollments.filter(
        (e) => e.assignmentId === assignment?.id,
      ),
      completed = enrollments.filter((e) =>
        s.completions.some((c) => c.enrollmentId === e.id),
      ).length;
    const renewal =
        certification && doc
          ? renewalAvailability(s, doc, certification, at)
          : null,
      canStart = !reasons.length && !assignment;
    return {
      level,
      qualificationId: q.id,
      qualificationRevision: q.revision,
      templateRevision: template.revision,
      title: template.title,
      prerequisiteTitle: prerequisite?.title || null,
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
    currentLevel: levels.some((l) => l.level === "main" && l.certification)
      ? "main"
      : levels.some((l) => l.level === "general" && l.certification)
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
    })
    .strict()
    .parse(body);
  checkRevision(programFor(s, team), input.revision);
  const p = ensureProgram(s, team, u, at);
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
  const input = z
    .object({
      qualificationId: z.string().min(1),
      qualificationRevision: z.number().int().positive(),
      templateRevision: z.number().int().positive(),
    })
    .strict()
    .parse(body);
  reconcileLifecycle(s, at);
  const view = auditorMe(s, u, at).levels.find(
    (l) => l.qualificationId === input.qualificationId,
  );
  demand(
    view,
    409,
    "현재 팀의 Auditor 자격을 다시 확인해 주세요.",
    "AUDITOR_START_UNAVAILABLE",
  );
  const q = currentQualification(
    s,
    s.qualifications.find((q) => q.id === input.qualificationId)!,
  );
  demand(
    q.lv1OrganizationId === u.lv1OrganizationId,
    403,
    "현재 팀의 자격만 시작할 수 있습니다.",
  );
  demand(
    q.revision === input.qualificationRevision &&
      q.templateRevision === input.templateRevision,
    409,
    "자격 기준이 변경되었습니다. 다시 확인해 주세요.",
    "REVISION_CONFLICT",
  );
  const level = view.level;
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
  const p = programFor(s, u.lv1OrganizationId),
    criteria = auditorCriteria(s, q)!,
    template = s.qualificationTemplates.find((t) => t.id === q.templateId)!;
  const manager =
    p?.updatedBy || u.auditorDesignation?.actorId || template.updatedBy;
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
      programRevision: p?.revision || 1,
      criteriaManagerId: manager,
      ...(template.scope !== "team"
        ? {
            criteriaPolicy: "pool" as const,
            ...(criteria.prerequisiteTemplateId
              ? { prerequisiteTemplateId: criteria.prerequisiteTemplateId }
              : {}),
          }
        : {}),
    },
    lv1OrganizationId: u.lv1OrganizationId,
    organizationPath: structuredClone(u.organizationPath),
    organizationSource: "assigned",
    qualificationId: q.id,
    qualificationMetadata: metadata(q),
    qualificationPolicySnapshot: qualificationPolicySnapshot(q),
    learnerId: u.id,
    ownerAdminId: manager,
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
