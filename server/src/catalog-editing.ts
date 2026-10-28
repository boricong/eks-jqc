import { validateRenewalActivation } from "./renewal-criteria.ts";
import {
  courseRelease,
  qualificationChange,
  releaseNumber,
  releaseInfo,
  propagateCourses,
} from "./releases.ts";
import { nextReleaseVersion, releaseVersionLabel } from "@eks/contracts";
import { auditorCriteria } from "./auditor-pool.ts";
import {
  validateCommonSelection,
  availableCommonCourses,
  validateDefaultCommonCourses,
  copyCommonCourses,
} from "./common-courses.ts";
import {
  latestQualification,
  organizationEntries,
  configureInitialQualification,
} from "@eks/contracts";
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
  validityErrors,
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
      subjectiveResponses: s.subjectiveResponses.filter(
        (r) => r.courseId === id,
      ).length,
      attempts: s.attempts.filter((a) => a.courseId === id).length,
      completions: s.completions.filter((c) => c.courseId === id).length,
      comparisons: s.comparisons.filter((c) => c.courseId === id).length,
      successors: s.courses.filter((c) => c.parentId === id).length,
    };
  return {
    requests: s.planningRequests.filter((r) =>
      (r.selections || []).some((t) => t.qualificationId === id),
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
    releaseVersion,
    releaseInfo,
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
      "학습 정보 · 자료": item.materials
        .map((m) =>
          [m.title, m.content, m.url, m.description].filter(Boolean).join("\n"),
        )
        .join("\n\n"),
      "학습 정보 · 교육": item.learningItems
        .map(
          (m) =>
            `${m.title} · ${m.required ? "필수" : "선택"} · ${m.type === "mtc" ? "MTC교육" : m.type === "team" ? "팀 특화 교육" : "현업 OJT"}`,
        )
        .join("\n"),
      "주관식 사용": item.subjectiveEnabled
        ? "사용 · 수료 영향 없음"
        : "사용 안 함",
      "주관식 문항": item.subjectiveQuestions
        .map((q, i) => `${i + 1}. ${q.prompt}`)
        .join("\n\n"),
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
    validateCommonSelection(s, q);
    demand(
      new Set(q.courseIds).size === q.courseIds.length,
      422,
      "인증Set 연결이 중복되었습니다.",
    );
    demand(
      new Set(
        q.courseIds.map(
          (id) => s.courses.find((c) => c.id === id)?.entityId || id,
        ),
      ).size === q.courseIds.length,
      422,
      "같은 인증Set의 버전은 하나만 선택해 주세요.",
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
    demand(
      c.qualificationType === "auditee" ||
        (!c.subjectiveEnabled && !c.subjectiveQuestions.length),
      422,
      "Auditor는 주관식 평가를 사용할 수 없습니다.",
    );
    for (const list of [
      c.learningItems,
      c.materials,
      [...c.questions, ...c.practicalQuestions, ...c.subjectiveQuestions],
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
  pendingCommonCopies: Course[] = [],
): CatalogItemSavePreview {
  const list = s[section];
  const source = list.find((i) => i.id === id);
  demand(source, 404, "기준을 찾을 수 없습니다.");
  demand(
    !list.some(
      (i) =>
        i.entityId === source.entityId &&
        !i.deletedAt &&
        (i.version || 0) > (source.version || 0),
    ),
    409,
    "과거 버전은 조회만 가능합니다. 최신 버전에서 편집해 주세요.",
    "RELEASE_NOT_CURRENT",
  );
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
    releaseVersion: source.releaseVersion,
    releaseInfo: source.releaseInfo,
    revision: source.revision,
    parentId: source.parentId,
    deletedAt: undefined,
    deletedBy: undefined,
    deletionReason: undefined,
  };
  for (const field of section === "courses"
    ? ["category", "commonCourseSource"]
    : ["commonCourseEntityIds", "purpose"]) {
    demand(
      body[field] === undefined ||
        isDeepStrictEqual(body[field], (source as any)[field]),
      422,
      "공통인증Set 구분과 등록 범위는 변경할 수 없습니다.",
      "COMMON_COURSE_METADATA_READ_ONLY",
    );
  }
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
          ...(auditorCriteria(s, source as Qualification)
            ? { auditorCriteria: auditorCriteria(s, source as Qualification) }
            : {}),
          templateId: (source as Qualification).templateId,
        });
  if (
    section === "qualifications" &&
    (candidate as Qualification).purpose !== "renewal"
  ) {
    const errors = validityErrors((candidate as Qualification).validity);
    demand(
      !errors.length,
      422,
      errors.join(" "),
      "QUALIFICATION_VALIDITY_REQUIRED",
    );
  }
  const additions = z
    .array(
      z
        .object({
          id: z.string().min(1),
          revision: z.number().int().positive(),
        })
        .strict(),
    )
    .max(100)
    .parse(body.commonCourseAdditions ?? []);
  if (additions.length) {
    demand(
      section === "qualifications",
      422,
      "팀 자격에서만 공통인증Set을 추가할 수 있습니다.",
    );
    const q = candidate as Qualification;
    const available = new Set(
      availableCommonCourses(s, source as Qualification).map((c) => c.id),
    );
    demand(
      additions.every((c) => available.has(c.id)),
      422,
      "이미 등록했거나 사용할 수 없는 공통인증Set입니다. 목록을 다시 확인해 주세요.",
      "COMMON_COURSE_UNAVAILABLE",
    );
    validateDefaultCommonCourses(
      s,
      q.qualificationType,
      additions.map((c) => c.id),
      Object.fromEntries(additions.map((c) => [c.id, c.revision])),
    );
    // Preview uses a private course list; only a successful save persists the copies.
    s = { ...s, courses: [...s.courses] };
    const copies = copyCommonCourses(
      s,
      additions.map((c) => c.id),
      scope,
    );
    pendingCommonCopies.push(...copies);
    q.commonCourseEntityIds = [
      ...q.commonCourseEntityIds,
      ...copies.map((c) => c.entityId),
    ];
    q.courseIds = [...q.courseIds, ...copies.map((c) => c.id)];
    QualificationSchema.parse(q);
  }
  if (section === "courses" && (source as Course).category === "common")
    demand(
      candidate.qualificationType === source.qualificationType,
      409,
      "공통인증Set의 인증 유형은 변경할 수 없습니다.",
      "COURSE_TYPE_LOCKED",
    );
  if (section === "courses")
    requireCourseTypeChange(s, source as Course, candidate.qualificationType);
  if (section === "courses")
    demand(
      !auditorAssessmentChanged(candidate as Course, source as Course),
      422,
      "Auditor 인증Set은 평가 설정을 변경할 수 없습니다. 학습항목을 작성해 주세요.",
    );
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
  let unchanged = isDeepStrictEqual(
    catalogContent(candidate),
    catalogContent(source),
  );
  const references = catalogReferences(s, section, id, org);
  const courseDecision =
    section === "courses"
      ? courseRelease(source as Course, candidate as Course)
      : undefined;
  const changeKind =
    section === "courses"
      ? courseDecision!.kind
      : qualificationChange(
          s,
          source as Qualification,
          candidate as Qualification,
        );
  if (section === "courses") unchanged = changeKind === "none";
  const requiresNewVersion = !unchanged;
  let initialConfiguration =
    section === "qualifications" &&
    configureInitialQualification(
      source as Qualification,
      candidate as Qualification,
      !unchanged,
    );
  if (
    section === "qualifications" &&
    source.version === null &&
    body.confirmInitialConfiguration === true &&
    (source as Qualification).commonCourseEntityIds.length > 0
  ) {
    initialConfiguration = true;
    (candidate as Qualification).version = 1;
    (candidate as Qualification).lifecycleStatus = "Active";
    unchanged = false;
  }
  if (
    section === "qualifications" &&
    source.version === null &&
    (candidate as Qualification).purpose === "renewal" &&
    candidate.version !== null
  )
    (candidate as Qualification).lifecycleStatus = "Hold";
  if (
    section === "qualifications" &&
    (candidate as Qualification).lifecycleStatus === "Active"
  )
    validateRenewalActivation(s, candidate as Qualification);
  const newVersion =
    !unchanged && !(section === "qualifications" && source.version === null);
  const nextVersion =
    Math.max(
      ...list
        .filter((i) => i.entityId === source.entityId)
        .map((i) => i.version ?? 0),
    ) + 1;
  if (!unchanged) {
    if (newVersion) {
      candidate.id = randomUUID();
      candidate.parentId = source.id;
      candidate.version = nextVersion;
      candidate.revision = 1;
    } else candidate.revision++;
  }
  if (!unchanged) {
    candidate.releaseVersion = courseDecision
      ? courseDecision.releaseVersion
      : candidate.version === null
        ? null
        : source.version === null
          ? { major: 1, minor: 0 }
          : nextReleaseVersion(
              releaseNumber(source),
              changeKind === "major" ? "major" : "minor",
            );
    candidate.releaseInfo = releaseInfo(
      source.version === null
        ? "initial"
        : changeKind === "major"
          ? "major"
          : "minor",
      "preview",
      "내용 변경 저장",
      newVersion ? source.id : undefined,
    );
  }
  const changes = editingChanges(source, candidate).map((change) =>
    change.label === "인증Set 연결"
      ? {
          ...change,
          before: (source as Qualification).courseIds
            .map((id) => {
              const c = s.courses.find((c) => c.id === id);
              return `${c?.title} ${c ? releaseVersionLabel(c) : ""}`;
            })
            .join("\n"),
          after: (candidate as Qualification).courseIds
            .map((id) => {
              const c = s.courses.find((c) => c.id === id);
              return `${c?.title} ${c ? releaseVersionLabel(c) : ""}`;
            })
            .join("\n"),
        }
      : change,
  );
  if (!unchanged && candidate.releaseInfo)
    candidate.releaseInfo.summary =
      changes.map((c) => c.label).join(" · ") || candidate.releaseInfo.cause;
  return {
    candidate,
    releaseChange: {
      kind: unchanged
        ? "none"
        : source.version === null
          ? "initial"
          : changeKind === "major"
            ? "major"
            : "minor",
      before: releaseVersionLabel(source),
      after: releaseVersionLabel(candidate),
      reasons: [
        ...(courseDecision?.reasons || []),
        ...changes.map((c) => c.label),
      ],
    },
    ...(section === "courses" && !unchanged
      ? {
          propagation: (() => {
            const previewState = structuredClone(s);
            previewState.courses.push(candidate as Course);
            return propagateCourses(
              previewState,
              [candidate as Course],
              "preview",
              "인증Set 자동 반영",
            );
          })(),
        }
      : {}),
    changes,
    unchanged,
    newVersion,
    initialConfiguration,
    ...(section === "qualifications"
      ? {
          versionPolicy: {
            changeKind: unchanged
              ? ("none" as const)
              : changeKind === "major"
                ? ("major" as const)
                : ("minor" as const),
            requiresNewVersion: requiresNewVersion && !initialConfiguration,
            effectiveMode: newVersion ? ("new" as const) : ("current" as const),
            nextVersion: initialConfiguration ? 1 : nextVersion,
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
            .map((q) => ({
              id: q.id,
              title: q.title,
              version: q.version,
              releaseVersion: q.releaseVersion,
            }))
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
  actorId = "system",
) {
  const pendingCommonCopies: Course[] = [];
  const result = prepareCatalogSave(
    s,
    org,
    section,
    id,
    body,
    scope,
    pendingCommonCopies,
  );
  for (const copy of pendingCommonCopies) {
    if (copy.releaseInfo) copy.releaseInfo.createdBy = actorId;
  }
  s.courses.push(...pendingCommonCopies);
  if (!result.unchanged && result.candidate.releaseInfo)
    result.candidate.releaseInfo.createdBy = actorId;
  if (!result.unchanged) {
    if (section === "qualifications") {
      const q = result.candidate as Qualification;
      const original = s.qualifications.find((item) => item.id === id)!;
      if (!result.newVersion && original.version !== null)
        freezeCompletedQualification(s, original);
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
        demand(
          source.category !== "common",
          422,
          "다른 자격의 공통인증Set을 연결할 수 없습니다.",
          "COMMON_COURSE_NOT_ALLOWED",
        );
        const copyId = randomUUID();
        s.courses.push(
          CourseSchema.parse({
            ...structuredClone(source),
            id: copyId,
            entityId: copyId,
            parentId: undefined,
            version: 1,
            releaseVersion: courseRelease(undefined, source).releaseVersion,
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
  const propagation =
    section === "courses" && !result.unchanged
      ? propagateCourses(
          s,
          [result.candidate as Course],
          actorId,
          "인증Set 버전 자동 반영",
        )
      : undefined;
  return {
    propagation,
    releaseChange: result.releaseChange,
    releaseVersion: result.candidate.releaseVersion,
    id: result.candidate.id,
    revision: result.candidate.revision,
    version: result.candidate.version,
    newVersion: result.newVersion,
    initialConfiguration: result.initialConfiguration,
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
  return {
    id,
    title: q.title,
    version: q.version,
    qualificationRevision: q.revision,
    stateRevision: s.revision,
    organizationRevision: org.revision,
    references,
    canDelete:
      !q.deletedAt &&
      !s.organizationQualificationRequirements.some(
        (r) =>
          r.entityIds.includes(q.entityId) ||
          r.exclusions.some((e) => e.entityId === q.entityId),
      ),
    blockers: [
      ...(q.deletedAt ? ["이미 삭제된 자격입니다."] : []),
      ...s.organizationQualificationRequirements
        .filter(
          (r) =>
            r.entityIds.includes(q.entityId) ||
            r.exclusions.some((e) => e.entityId === q.entityId),
        )
        .map(
          (r) =>
            `조직 필요자격 지정·예외 해제 필요: ${organizationEntries(org).find((e) => e.id === r.organizationId)?.name || r.organizationId}`,
        ),
    ],
    replacement: remaining
      ? { id: remaining.id, version: remaining.version, title: remaining.title }
      : null,
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
  return { id, mode: impact.mode, reason: body.reason, impact };
}
