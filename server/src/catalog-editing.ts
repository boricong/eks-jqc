import { latestQualification, organizationEntries } from "@eks/contracts";
import { nodeFor } from "./organizations.ts";
import {
  auditorAssessmentChanged,
  requireCourseTypeChange,
} from "./course-types.ts";
import {
  currentQualification,
  checkCommonFields,
} from "./qualification-templates.ts";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  CourseSchema,
  QualificationSchema,
  courseUseErrors,
  qualificationReadinessErrors,
  qualificationPolicySnapshot,
  QualificationVersionModeSchema,
  type CatalogItemSavePreview,
  type Course,
  type Qualification,
  type State,
  type OrganizationDocument,
} from "@eks/contracts";
import { demand } from "./errors.ts";

export type CatalogSection = "courses" | "qualifications";
export function catalogReferences(
  s: State,
  section: CatalogSection,
  id: string,
  org?: OrganizationDocument,
): Record<string, number> {
  if (section === "courses")
    return {
      qualifications: s.qualifications.filter((q) => q.courseIds.includes(id))
        .length,
      enrollments: s.enrollments.filter((e) => e.courseId === id).length,
      attempts: s.attempts.filter((a) => a.courseId === id).length,
      completions: s.completions.filter((c) => c.courseId === id).length,
      comparisons: s.comparisons.filter((c) => c.courseId === id).length,
      successors: s.courses.filter((c) => c.parentId === id).length,
    };
  return {
    requests: s.planningRequests.filter((r) =>
      [...(r.targets || []), ...(r.selections || [])].some(
        (t) => t.qualificationId === id,
      ),
    ).length,
    plans: s.plans.filter((p) => p.qualificationId === id).length,
    assignments: s.assignments.filter((a) => a.qualificationId === id).length,
    certifications: s.certifications.filter(
      (c) =>
        c.qualificationId === id ||
        c.periods?.some((p) => p.qualificationId === id),
    ).length,
    renewals: s.renewals.filter((r) => r.qualificationId === id).length,
    successors: s.qualifications.filter((q) => q.parentId === id).length,
    lifecycleEvents: s.lifecycleEvents.filter(
      (e) => e.subject === "qualification" && e.targetId === id,
    ).length,
  };
}
export const referencedCatalog = (
  s: State,
  section: CatalogSection,
  id: string,
  org?: OrganizationDocument,
) => Object.values(catalogReferences(s, section, id, org)).some((n) => n > 0);

export function catalogContent(value: Course | Qualification) {
  const {
    id,
    entityId,
    version,
    revision,
    parentId,
    deletedAt,
    deletedBy,
    deletionReason,
    ...content
  } = value;
  if ("courseIds" in content) {
    const { title, englishName, description, templateRevision, ...team } =
      content;
    return JSON.parse(JSON.stringify(team));
  }
  return JSON.parse(JSON.stringify(content));
}

function editingChanges(
  before: Course | Qualification,
  after: Course | Qualification,
) {
  const lines = (item: Course | Qualification): Record<string, string> => {
    if ("courseIds" in item)
      return {
        자격명: item.title,
        영문명: item.englishName,
        설명: item.description,
        인증기간:
          item.validity.type === "months"
            ? `${item.validity.months}개월`
            : item.validity.type === "unlimited"
              ? "무기한"
              : "미정",
        "재인증 시작": `${item.renewalLeadMonths}개월 전`,
        "재인증 알림": `${item.renewalNoticeDaysBefore}일 전`,
        "인증Set 연결": item.courseIds.join("\n"),
      };
    const questions = (kind: "objective" | "practical") =>
      (kind === "objective" ? item.questions : item.practicalQuestions)
        .map(
          (q, i) =>
            `${i + 1}. ${"scenario" in q ? q.scenario + "\n" : ""}${q.prompt}\n${q.choices.map((v, n) => `${n + 1}) ${v}`).join("\n")}\n정답: ${q.correct == null ? "미정" : q.correct + 1} · 배점: ${q.points}`,
        )
        .join("\n\n");
    return {
      인증Set명: item.title,
      "인증 유형": item.qualificationType === "auditor" ? "Auditor" : "Auditee",
      "평가 유형": item.assessmentKinds
        .map((k) => (k === "objective" ? "지식 평가" : "상황 대응 평가"))
        .join(", "),
      "지식 합격 기준": String(item.passScore ?? "미정"),
      "상황 대응 합격 기준": String(item.practicalPassScore ?? "미정"),
      학습자료: item.materials
        .map((m) =>
          [m.title, m.content, m.url, m.description].filter(Boolean).join("\n"),
        )
        .join("\n\n"),
      "학습 항목": item.learningItems
        .map(
          (m) =>
            `${m.title} · ${m.required ? "필수" : "선택"} · ${m.type === "mtc" ? "MTC교육" : m.type === "team" ? "팀 특화 교육" : "현업 OJT"}`,
        )
        .join("\n"),
      "지식 문항": questions("objective"),
      "상황 대응 문항": questions("practical"),
    };
  };
  const previous = lines(before),
    next = lines(after);
  return Object.keys(next)
    .filter((key) => previous[key] !== next[key])
    .map((label) => ({ label, before: previous[label], after: next[label] }));
}

// Structural constraints apply even to incomplete criteria. Completeness is computed separately.
export function validateCatalogStructure(
  s: State,
  section: CatalogSection,
  item: Course | Qualification,
) {
  if (section === "qualifications") {
    const q = item as Qualification;
    demand(
      new Set(q.courseIds).size === q.courseIds.length,
      422,
      "인증Set 연결이 중복되었습니다.",
    );
    demand(
      q.courseIds.every((id) =>
        s.courses.some(
          (c) =>
            c.id === id &&
            c.lv1OrganizationId === q.lv1OrganizationId &&
            !c.deletedAt,
        ),
      ),
      422,
      "같은 팀의 인증Set만 연결할 수 있습니다.",
    );
    demand(
      q.courseIds.every(
        (id) =>
          s.courses.find((c) => c.id === id)?.qualificationType ===
          q.qualificationType,
      ),
      422,
      "같은 인증 유형의 인증Set만 연결할 수 있습니다.",
      "COURSE_TYPE_MISMATCH",
    );
  } else {
    const c = item as Course;
    for (const list of [
      c.learningItems,
      c.materials,
      [...c.questions, ...c.practicalQuestions],
    ])
      demand(
        new Set(list.map((i) => i.id)).size === list.length,
        422,
        "항목 ID가 중복되었습니다.",
      );
    demand(
      new Set(c.assessmentKinds).size === c.assessmentKinds.length,
      422,
      "평가 유형이 중복되었습니다.",
    );
    for (const q of [...c.questions, ...c.practicalQuestions])
      demand(
        q.correct == null || q.correct < q.choices.length,
        422,
        "정답 번호가 선택지 범위를 벗어났습니다.",
      );
  }
}

export function prepareCatalogSave(
  s: State,
  org: OrganizationDocument,
  section: CatalogSection,
  id: string,
  body: any,
  scope: string,
): CatalogItemSavePreview {
  const list = s[section];
  const source = list.find((i) => i.id === id);
  demand(source, 404, "기준을 찾을 수 없습니다.");
  demand(
    source.lv1OrganizationId === scope,
    403,
    "선택한 팀의 기준만 수정할 수 있습니다.",
  );
  demand(
    !source.deletedAt,
    409,
    "삭제된 기준은 수정할 수 없습니다.",
    "CATALOG_DELETED",
  );
  demand(
    source.revision === body.revision,
    409,
    "기준이 변경되었습니다. 입력을 보관한 뒤 최신 내용을 확인해 주세요.",
    "REVISION_CONFLICT",
  );
  demand(
    !("status" in body) && !("publishedAt" in body),
    409,
    "기준 저장 방식이 변경되었습니다. 입력을 보관한 뒤 새로고침해 주세요.",
    "CATALOG_FORMAT_CHANGED",
  );
  if (body.stateRevision != null)
    demand(
      body.stateRevision === s.revision &&
        body.organizationRevision === org.revision,
      409,
      "검토 후 연결이나 기준이 변경되었습니다. 다시 검토해 주세요.",
      "REVISION_CONFLICT",
    );
  if (section === "qualifications")
    checkCommonFields(s, source as Qualification, body);
  const metadata = {
    id: source.id,
    entityId: source.entityId,
    lv1OrganizationId: scope,
    version: source.version,
    revision: source.revision,
    parentId: source.parentId,
    deletedAt: undefined,
    deletedBy: undefined,
    deletionReason: undefined,
  };
  const candidate =
    section === "courses"
      ? CourseSchema.parse({
          ...source,
          ...body,
          ...metadata,
          operationalStatus: (source as Course).operationalStatus,
          retiredAt: (source as Course).retiredAt,
          retiredBy: (source as Course).retiredBy,
          retirementReason: (source as Course).retirementReason,
        })
      : QualificationSchema.parse({
          ...currentQualification(s, source as Qualification),
          ...body,
          ...metadata,
          lifecycleStatus: (source as Qualification).lifecycleStatus,
          templateId: (source as Qualification).templateId,
        });
  if (section === "courses")
    requireCourseTypeChange(s, source as Course, candidate.qualificationType);
  if (section === "courses")
    demand(
      !auditorAssessmentChanged(candidate as Course, source as Course),
      422,
      "Auditor 인증Set은 평가 설정을 변경할 수 없습니다. 학습항목을 작성해 주세요.",
    );
  const versionMode =
    section === "qualifications"
      ? QualificationVersionModeSchema.optional().parse(body.versionMode)
      : undefined;
  const sameCourses =
    section === "qualifications" &&
    (source as Qualification).courseIds.length ===
      (candidate as Qualification).courseIds.length &&
    (source as Qualification).courseIds.every((id) =>
      (candidate as Qualification).courseIds.includes(id),
    );
  if (sameCourses)
    (candidate as Qualification).courseIds = [
      ...(source as Qualification).courseIds,
    ];
  validateCatalogStructure(s, section, candidate);
  const unchanged = isDeepStrictEqual(
    catalogContent(candidate),
    catalogContent(source),
  );
  const references = catalogReferences(s, section, id, org);
  const requiresNewVersion = section === "qualifications" && !sameCourses;
  const automatic = Object.values(references).some((n) => n > 0);
  const newVersion =
    !unchanged &&
    (requiresNewVersion ||
      (section === "qualifications" && versionMode
        ? versionMode === "new"
        : automatic));
  const nextVersion =
    Math.max(
      ...list
        .filter((i) => i.entityId === source.entityId)
        .map((i) => i.version),
    ) + 1;
  if (!unchanged) {
    if (newVersion) {
      candidate.id = randomUUID();
      candidate.parentId = source.id;
      candidate.version = nextVersion;
      candidate.revision = 1;
    } else candidate.revision++;
  }
  const changes = editingChanges(source, candidate).map((change) =>
    change.label === "인증Set 연결"
      ? {
          ...change,
          before: (source as Qualification).courseIds
            .map((id) => {
              const c = s.courses.find((c) => c.id === id);
              return `${c?.title} v${c?.version}`;
            })
            .join("\n"),
          after: (candidate as Qualification).courseIds
            .map((id) => {
              const c = s.courses.find((c) => c.id === id);
              return `${c?.title} v${c?.version}`;
            })
            .join("\n"),
        }
      : change,
  );
  return {
    candidate,
    changes,
    unchanged,
    newVersion,
    ...(section === "qualifications"
      ? {
          versionPolicy: {
            changeKind: unchanged
              ? ("none" as const)
              : requiresNewVersion
                ? ("major" as const)
                : ("minor" as const),
            requiresNewVersion,
            effectiveMode: newVersion ? ("new" as const) : ("current" as const),
            nextVersion,
          },
        }
      : {}),
    references,
    stateRevision: s.revision,
    organizationRevision: org.revision,
    readiness:
      section === "courses"
        ? courseUseErrors(candidate as Course)
        : qualificationReadinessErrors(candidate as Qualification, s.courses),
    linkedQualifications:
      section === "courses"
        ? s.qualifications
            .filter((q) => q.courseIds.includes(id))
            .map((q) => ({ id: q.id, title: q.title, version: q.version }))
        : [],
  };
}

export function saveCatalogItem(
  s: State,
  org: OrganizationDocument,
  section: CatalogSection,
  id: string,
  body: any,
  scope: string,
) {
  const result = prepareCatalogSave(s, org, section, id, body, scope);
  demand(
    !(
      result.versionPolicy?.requiresNewVersion && body.versionMode === "current"
    ),
    409,
    "인증Set 구성이 변경되어 새 버전 생성이 필요합니다. 다시 검토해 주세요.",
    "QUALIFICATION_NEW_VERSION_REQUIRED",
  );
  if (!result.unchanged) {
    if (section === "qualifications") {
      const q = result.candidate as Qualification;
      const original = s.qualifications.find((item) => item.id === id)!;
      if (!result.newVersion) freezeCompletedQualification(s, original);
      q.courseIds = q.courseIds.map((courseId) => {
        if (original.courseIds.includes(courseId)) return courseId;
        if (
          !s.qualifications.some(
            (other) =>
              other.entityId !== q.entityId &&
              other.courseIds.includes(courseId),
          )
        )
          return courseId;
        const source = s.courses.find((c) => c.id === courseId)!;
        const copyId = randomUUID();
        s.courses.push(
          CourseSchema.parse({
            ...structuredClone(source),
            id: copyId,
            entityId: copyId,
            parentId: undefined,
            version: 1,
            revision: 1,
          }),
        );
        return copyId;
      });
    }
    const list = s[section] as (Course | Qualification)[];
    if (result.newVersion) list.push(result.candidate);
    else list[list.findIndex((i) => i.id === id)] = result.candidate;
  }
  return {
    id: result.candidate.id,
    revision: result.candidate.revision,
    version: result.candidate.version,
    newVersion: result.newVersion,
    unchanged: result.unchanged,
    readiness: result.readiness,
    linkedQualifications: result.linkedQualifications,
    versionPolicy: result.versionPolicy,
    changes: result.changes,
  };
}

function freezeCompletedQualification(s: State, q: Qualification) {
  const original = qualificationPolicySnapshot(q);
  const records = s.assignments.filter((a) => a.qualificationId === q.id);
  const fail = () =>
    demand(
      false,
      409,
      "완료 계획의 기존 자격 기준을 안전하게 보존할 수 없습니다. 관리자 확인 후 다시 저장해 주세요.",
      "QUALIFICATION_SNAPSHOT_CONFLICT",
    );
  for (const a of records) {
    const p = a.planId
      ? s.plans.find((p) => p.id === a.planId && p.status === "completed")
      : undefined;
    const frozen =
      a.qualificationPolicySnapshot ||
      p?.qualificationPolicySnapshot ||
      original;
    if (
      frozen.id !== q.id ||
      frozen.entityId !== q.entityId ||
      (a.qualificationPolicySnapshot &&
        p?.qualificationPolicySnapshot &&
        !isDeepStrictEqual(
          a.qualificationPolicySnapshot,
          p.qualificationPolicySnapshot,
        ))
    )
      fail();
    const enrolled = s.enrollments
      .filter((e) => e.assignmentId === a.id)
      .map((e) => e.courseId);
    if (
      enrolled.length !== frozen.courseIds.length ||
      !enrolled.every((id) => frozen.courseIds.includes(id))
    )
      fail();
    a.qualificationPolicySnapshot ??= structuredClone(frozen);
    if (p) p.qualificationPolicySnapshot ??= structuredClone(frozen);
  }
  for (const p of s.plans.filter(
    (p) => p.status === "completed" && p.qualificationId === q.id,
  )) {
    if (!records.some((a) => a.id === p.assignmentId)) fail();
    p.qualificationPolicySnapshot ??= structuredClone(original);
  }
}

export function qualificationDeletionImpact(
  s: State,
  org: OrganizationDocument,
  id: string,
  scope: string,
) {
  const q = s.qualifications.find((q) => q.id === id);
  demand(q, 404, "자격을 찾을 수 없습니다.");
  demand(
    q.lv1OrganizationId === scope,
    403,
    "선택한 팀의 자격만 삭제할 수 있습니다.",
  );
  const references = catalogReferences(s, "qualifications", id, org);
  const remaining = latestQualification(
    { qualifications: s.qualifications.filter((q) => q.id !== id) },
    scope,
    q.entityId,
  );
  const affectedOrganizations = remaining
    ? []
    : organizationEntries(org)
        .filter(
          (o) =>
            o.lv1OrganizationId === scope &&
            o.requiredQualifications?.includes(q.entityId),
        )
        .map((o) => ({ id: o.id, name: o.name }));
  return {
    id,
    title: q.title,
    version: q.version,
    qualificationRevision: q.revision,
    stateRevision: s.revision,
    organizationRevision: org.revision,
    references,
    canDelete: !q.deletedAt,
    blockers: q.deletedAt ? ["이미 삭제된 자격입니다."] : [],
    replacement: remaining
      ? { id: remaining.id, version: remaining.version, title: remaining.title }
      : null,
    affectedOrganizations,
    mode:
      !!q.templateId || Object.values(references).some((n) => n > 0)
        ? ("archive" as const)
        : ("remove" as const),
  };
}

export function deleteQualification(
  s: State,
  org: OrganizationDocument,
  id: string,
  input: unknown,
  scope: string,
  actorId: string,
) {
  const body = z
    .object({
      qualificationRevision: z.number().int(),
      stateRevision: z.number().int(),
      organizationRevision: z.number().int(),
      reason: z.string().trim().min(1, "삭제 사유를 입력해 주세요.").max(2000),
    })
    .parse(input);
  const impact = qualificationDeletionImpact(s, org, id, scope);
  demand(
    impact.qualificationRevision === body.qualificationRevision &&
      impact.stateRevision === body.stateRevision &&
      impact.organizationRevision === body.organizationRevision,
    409,
    "삭제 영향이 변경되었습니다. 다시 확인해 주세요.",
    "REVISION_CONFLICT",
  );
  demand(impact.canDelete, 409, impact.blockers.join("\n"));
  const entityId = s.qualifications.find((q) => q.id === id)!.entityId;
  if (impact.mode === "remove")
    s.qualifications = s.qualifications.filter((q) => q.id !== id);
  else {
    const q = s.qualifications.find((q) => q.id === id)!;
    q.deletedAt = new Date().toISOString();
    q.deletedBy = actorId;
    q.deletionReason = body.reason;
    q.revision++;
  }
  for (const affected of impact.affectedOrganizations) {
    const node = nodeFor(org.roots, affected.id)!;
    const before = [...(node.requiredQualifications || [])];
    node.requiredQualifications = before.filter(
      (requiredEntityId) => requiredEntityId !== entityId,
    );
    org.audits.push({
      id: randomUUID(),
      actorId,
      date: new Date().toISOString(),
      targetId: node.id,
      action: "qualification.delete.required-detach",
      before,
      after: node.requiredQualifications,
    });
  }
  return { id, mode: impact.mode, reason: body.reason, impact };
}
