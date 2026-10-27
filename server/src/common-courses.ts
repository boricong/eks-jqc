import {
  courseChange,
  releaseNumber,
  releaseInfo,
  propagateCommon,
  latestCompleteCommon,
} from "./releases.ts";
import { nextReleaseVersion, releaseVersionLabel } from "@eks/contracts";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  CommonCourseSchema,
  CourseContentSchema,
  CourseSchema,
  comparableCourseContent,
  courseUseErrors,
  type CommonCourse,
  type Course,
  type CourseContent,
  type State,
  type Qualification,
} from "@eks/contracts";
import { demand } from "./errors.ts";

export function courseContentHash(c: CourseContent) {
  return createHash("sha256")
    .update(JSON.stringify(comparableCourseContent(c)))
    .digest("hex");
}
export function teamCourseModified(c: Course) {
  return (
    c.category === "common" &&
    !!c.commonCourseSource &&
    courseContentHash(c) !== c.commonCourseSource.baselineHash
  );
}
export function commonCourseUsage(s: State, id: string) {
  const course = s.commonCourses.find((c) => c.id === id);
  demand(course, 404, "공통인증Set을 찾을 수 없습니다.");
  const templates = s.qualificationTemplates.filter((t) =>
    t.defaultCommonCourseIds.includes(id),
  );
  const copies = s.courses.filter((c) => c.commonCourseSource?.id === id);
  const canChangeType = !templates.length && !copies.length;
  return {
    id,
    revision: course.revision,
    templates: templates.map((t) => ({ id: t.id, title: t.title })),
    copies: copies.map((c) => ({
      id: c.id,
      lv1OrganizationId: c.lv1OrganizationId,
      title: c.title,
      version: c.version,
    })),
    canChangeType,
    typeChangeReason: canChangeType
      ? "사용 전까지 유형을 변경할 수 있습니다."
      : "기본자격 연결 또는 팀 등록 이력이 있어 유형을 변경할 수 없습니다.",
  };
}
export function commonCourseView(s: State, c: CommonCourse) {
  const usage = commonCourseUsage(s, c.id);
  return {
    ...c,
    readiness: courseUseErrors(c),
    templateCount: usage.templates.length,
    copyCount: usage.copies.length,
    canChangeType: usage.canChangeType,
    typeChangeReason: usage.typeChangeReason,
  };
}
export function validateDefaultCommonCourses(
  s: State,
  type: string,
  ids: string[],
  revisions?: Record<string, number>,
) {
  demand(
    new Set(ids).size === ids.length,
    422,
    "공통인증Set이 중복되었습니다.",
  );
  for (const id of ids) {
    const c = s.commonCourses.find((c) => c.id === id);
    demand(
      c && c.operationalStatus === "active",
      422,
      "운영 중인 공통인증Set만 기본 목록에 지정할 수 있습니다.",
      "COMMON_COURSE_UNAVAILABLE",
    );
    demand(
      c.qualificationType === type,
      422,
      "같은 인증 유형의 공통인증Set만 지정할 수 있습니다.",
      "COURSE_TYPE_MISMATCH",
    );
    demand(
      revisions?.[id] === c.revision,
      409,
      "공통인증Set이 변경되었습니다. 목록을 다시 확인해 주세요.",
      "COMMON_COURSE_CHANGED",
    );
  }
}
export function saveCommonCourse(
  s: State,
  actorId: string,
  id: string | undefined,
  body: unknown,
) {
  const input = CourseContentSchema.extend({
    revision: z.number().int().positive().optional(),
  })
    .strict()
    .parse(body);
  const old = id ? s.commonCourses.find((c) => c.id === id) : undefined;
  demand(!id || old, 404, "공통인증Set을 찾을 수 없습니다.");
  demand(
    !old || input.revision === old.revision,
    409,
    "다른 창에서 변경되었습니다. 입력을 보관한 뒤 다시 확인해 주세요.",
    "REVISION_CONFLICT",
  );
  demand(
    !old || old.operationalStatus === "active",
    409,
    "운영 종료된 공통인증Set은 운영 재개 후 수정해 주세요.",
  );
  demand(
    !old ||
      old.qualificationType === input.qualificationType ||
      commonCourseUsage(s, old.id).canChangeType,
    409,
    "사용 이력이 있는 공통인증Set은 유형을 변경할 수 없습니다.",
    "COURSE_TYPE_LOCKED",
  );
  for (const list of [
    input.learningItems,
    input.materials,
    [
      ...input.questions,
      ...input.practicalQuestions,
      ...input.subjectiveQuestions,
    ],
  ])
    demand(
      new Set(list.map((x) => x.id)).size === list.length,
      422,
      "항목 ID가 중복되었습니다.",
    );
  demand(
    new Set(input.assessmentKinds).size === input.assessmentKinds.length,
    422,
    "평가 유형이 중복되었습니다.",
  );
  for (const q of [...input.questions, ...input.practicalQuestions])
    demand(
      q.correct == null || q.correct < q.choices.length,
      422,
      "정답 번호가 선택지 범위를 벗어났습니다.",
    );
  if (input.qualificationType === "auditor")
    demand(
      input.assessmentKinds.length === 0 &&
        input.passScore === null &&
        input.practicalPassScore === null &&
        input.questions.length === 0 &&
        input.practicalQuestions.length === 0 &&
        !input.subjectiveEnabled &&
        input.subjectiveQuestions.length === 0,
      422,
      "Auditor 공통인증Set은 학습항목과 자료로 구성해 주세요.",
    );
  const at = new Date().toISOString();
  const next = CommonCourseSchema.parse({
    ...input,
    id: old?.id ?? randomUUID(),
    revision: (old?.revision ?? 0) + 1,
    operationalStatus: "active",
    createdAt: old?.createdAt ?? at,
    createdBy: old?.createdBy ?? actorId,
    updatedAt: at,
    updatedBy: actorId,
  });
  if (old && courseChange(old, next) === "none")
    return {
      ...commonCourseView(s, old),
      releaseChange: {
        kind: "none",
        before: releaseVersionLabel(old),
        after: releaseVersionLabel(old),
        reasons: [],
      },
    };
  const kind = old ? courseChange(old, next) : "none";
  const released = {
    ...CourseContentSchema.parse(next),
    id: randomUUID(),
    commonCourseId: next.id,
    sequence:
      Math.max(
        0,
        ...s.commonCourseReleases
          .filter((r) => r.commonCourseId === next.id)
          .map((r) => r.sequence),
      ) + 1,
    releaseVersion: old
      ? nextReleaseVersion(
          releaseNumber(old),
          kind === "major" ? "major" : "minor",
        )
      : { major: 1, minor: 0 },
    releaseInfo: releaseInfo(
      old ? (kind === "major" ? "major" : "minor") : "initial",
      actorId,
      "공통 원본 저장",
      old?.headReleaseId,
    ),
  };
  next.releaseVersion = released.releaseVersion;
  next.headReleaseId = released.id;
  s.commonCourseReleases.push(released);
  if (old) s.commonCourses[s.commonCourses.indexOf(old)] = next;
  else s.commonCourses.push(next);
  s.audits.push({
    id: randomUUID(),
    actorId,
    date: at,
    action: old ? "common-course.update" : "common-course.create",
    targetId: next.id,
    reason: "시스템 공통인증Set 관리",
    details: { before: old ?? null, after: next },
  });
  const propagation = propagateCommon(s, released, actorId);
  return {
    ...commonCourseView(s, next),
    propagation,
    releaseChange: {
      kind: old ? kind : "initial",
      before: releaseVersionLabel(old),
      after: releaseVersionLabel(next),
      reasons: [
        old
          ? kind === "major"
            ? "채점 문항 변경"
            : "이름·학습 정보·평가 설정 변경"
          : "최초 저장",
      ],
    },
  };
}
export function changeCommonCourseStatus(
  s: State,
  actorId: string,
  id: string,
  action: string,
  body: unknown,
) {
  const input = z
    .object({
      revision: z.number().int().positive(),
      reason: z.string().trim().min(1).max(2000),
    })
    .strict()
    .parse(body);
  const usage = commonCourseUsage(s, id),
    c = s.commonCourses.find((c) => c.id === id)!;
  demand(
    input.revision === c.revision,
    409,
    "공통인증Set이 변경되었습니다. 다시 확인해 주세요.",
    "REVISION_CONFLICT",
  );
  const status = action === "retire" ? "retired" : "active";
  demand(
    c.operationalStatus !== status,
    409,
    "운영 상태가 이미 변경되었습니다.",
  );
  demand(
    status !== "retired" || !usage.templates.length,
    409,
    `기본 목록에서 먼저 제외해 주세요: ${usage.templates.map((t) => t.title).join(", ")}`,
    "COMMON_COURSE_IN_USE",
  );
  const before = structuredClone(c);
  c.operationalStatus = status;
  c.revision++;
  c.updatedAt = new Date().toISOString();
  c.updatedBy = actorId;
  s.audits.push({
    id: randomUUID(),
    actorId,
    date: c.updatedAt,
    action: `common-course.${action}`,
    targetId: id,
    reason: input.reason,
    details: { before, after: structuredClone(c) },
  });
  return commonCourseView(s, c);
}
export function copyCommonCourses(s: State, ids: string[], team: string) {
  return ids.map((id) => {
    const original = s.commonCourses.find((c) => c.id === id)!;
    const released = latestCompleteCommon(s, id);
    demand(
      released,
      422,
      "완성된 공통인증Set 버전이 없습니다. 원본 기준을 보완해 주세요.",
      "COMMON_COURSE_INCOMPLETE",
    );
    const content = CourseContentSchema.parse(released),
      fresh = (items: { id: string }[]) =>
        items.map((item) => ({
          ...structuredClone(item),
          id: randomUUID(),
          catalogCode: undefined,
        }));
    const copyId = randomUUID();
    const copy = CourseSchema.parse({
      ...content,
      id: copyId,
      entityId: copyId,
      lv1OrganizationId: team,
      version: 1,
      releaseVersion: { major: 1, minor: 0 },
      releaseInfo: releaseInfo(
        "initial",
        "system",
        "공통 원본에서 팀 사본 등록",
      ),
      revision: 1,
      operationalStatus: "active",
      category: "common",
      commonCourseSource: {
        id: original.id,
        revision: original.revision,
        baselineHash: courseContentHash(content),
        releaseId: released.id,
        releaseVersion: released.releaseVersion,
      },
      learningItems: fresh(content.learningItems),
      materials: fresh(content.materials),
      questions: fresh(content.questions),
      practicalQuestions: fresh(content.practicalQuestions),
      subjectiveQuestions: content.subjectiveQuestions.map((q) => ({
        ...q,
        id: randomUUID(),
      })),
    });
    s.courses.push(copy);
    return copy;
  });
}
export function validateCommonSelection(s: State, q: Qualification) {
  const allowed = new Set(q.commonCourseEntityIds);
  for (const id of q.courseIds) {
    const c = s.courses.find((c) => c.id === id);
    demand(
      !c || c.category !== "common" || allowed.has(c.entityId),
      422,
      "이 자격에 등록된 공통인증Set만 연결할 수 있습니다.",
      "COMMON_COURSE_NOT_ALLOWED",
    );
  }
  const selected = q.courseIds
    .map((id) => s.courses.find((c) => c.id === id))
    .filter((c) => c?.category === "common");
  demand(
    new Set(selected.map((c) => c!.entityId)).size === selected.length,
    422,
    "같은 공통인증Set의 여러 버전을 함께 선택할 수 없습니다.",
  );
}
export function commonCourseOptions(s: State, q: Qualification) {
  return q.commonCourseEntityIds
    .map((entityId) => {
      const versions = s.courses
        .filter((c) => c.entityId === entityId && !c.deletedAt)
        .sort((a, b) => b.version - a.version);
      const c = versions[0];
      return c
        ? {
            ...c,
            teamModified: teamCourseModified(c),
            selected: q.courseIds.some((id) =>
              s.courses.some((x) => x.id === id && x.entityId === entityId),
            ),
            selectedCourseId: q.courseIds.find((id) =>
              s.courses.some((x) => x.id === id && x.entityId === entityId),
            ),
          }
        : undefined;
    })
    .filter(Boolean);
}

export function availableCommonCourses(s: State, q: Qualification) {
  const copied = new Set(
    s.courses
      .filter((c) => q.commonCourseEntityIds.includes(c.entityId))
      .map((c) => c.commonCourseSource?.id),
  );
  return s.commonCourses
    .filter(
      (c) =>
        c.qualificationType === q.qualificationType &&
        c.operationalStatus === "active" &&
        !copied.has(c.id),
    )
    .map((c) => {
      const released = latestCompleteCommon(s, c.id);
      return {
        ...CourseContentSchema.parse(released ?? c),
        id: c.id,
        revision: c.revision,
        releaseVersion: released?.releaseVersion ?? c.releaseVersion,
        available: !!released,
      };
    });
}
