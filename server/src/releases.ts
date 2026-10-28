import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  CourseContentSchema,
  comparableCourseContent,
  courseUseErrors,
  renewalQualificationErrors,
  nextReleaseVersion,
  latestQualification,
  currentTeamQualifications,
  type State,
  type Course,
  type CourseContent,
  type Qualification,
  type ReleaseVersion,
  type ReleaseInfo,
  type ReleasePropagation,
  type FrozenCriteria,
} from "@eks/contracts";
import { demand } from "./errors.ts";

export function canonicalHash(value: unknown): string {
  const canonical = (v: any): any =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .filter((k) => v[k] !== undefined)
              .map((k) => [k, canonical(v[k])]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export const releaseNumber = (v: {
  releaseVersion?: ReleaseVersion | null;
  version?: number | null;
}): ReleaseVersion => v.releaseVersion || { major: v.version || 1, minor: 0 };
function withoutIds(value: any): any {
  if (Array.isArray(value)) return value.map(withoutIds);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !["id", "catalogCode"].includes(k))
        .map(([k, v]) => [k, withoutIds(v)]),
    );
  return value;
}
export function courseChange(
  before: CourseContent,
  after: CourseContent,
): "none" | "minor" | "major" {
  if (
    isDeepStrictEqual(
      withoutIds(CourseContentSchema.parse(before)),
      withoutIds(CourseContentSchema.parse(after)),
    )
  )
    return "none";
  return isDeepStrictEqual(
    withoutIds([before.questions, before.practicalQuestions]),
    withoutIds([after.questions, after.practicalQuestions]),
  )
    ? "minor"
    : "major";
}
// Drafts use v0.x. Readiness, rather than question edits, controls their promotion.
export function courseRelease(
  before:
    | (CourseContent & {
        releaseVersion?: ReleaseVersion | null;
        version?: number | null;
      })
    | undefined,
  after: CourseContent,
): {
  kind: "none" | "initial" | "minor" | "major";
  releaseVersion: ReleaseVersion;
  reasons: string[];
} {
  const ready = !courseUseErrors(after).length;
  if (!before)
    return {
      kind: "initial",
      releaseVersion: ready ? { major: 1, minor: 0 } : { major: 0, minor: 1 },
      reasons: [ready ? "최초 준비 완료" : "보완 필요 · 최초 초안 저장"],
    };
  const change = courseChange(before, after),
    previous = releaseNumber(before);
  if (change === "none")
    return { kind: "none", releaseVersion: previous, reasons: [] };
  if (previous.major === 0 && ready)
    return {
      kind: "major",
      releaseVersion: { major: 1, minor: 0 },
      reasons: ["최초 준비 완료 · v1.0 시작"],
    };
  const incomplete = !ready || !!courseUseErrors(before).length;
  const kind = incomplete ? "minor" : change;
  return {
    kind,
    releaseVersion: nextReleaseVersion(previous, kind),
    reasons: [
      incomplete
        ? "보완 필요 단계의 변경 · 마이너 업데이트"
        : kind === "major"
          ? "채점 문항 변경"
          : "이름·학습 정보·평가 설정 변경",
    ],
  };
}
export function qualificationChange(
  s: State,
  before: Qualification,
  after: Qualification,
): "minor" | "major" {
  const entities = (q: Qualification) =>
    q.courseIds
      .map((id) => s.courses.find((c) => c.id === id)?.entityId || id)
      .sort();
  return isDeepStrictEqual(entities(before), entities(after))
    ? "minor"
    : "major";
}
export function releaseInfo(
  kind: ReleaseInfo["kind"],
  actorId: string,
  cause: string,
  previousId?: string,
): ReleaseInfo {
  return {
    kind,
    createdAt: new Date().toISOString(),
    createdBy: actorId,
    cause,
    summary: cause,
    ...(previousId ? { previousId } : {}),
  };
}
export function latestCourse(s: State, entityId: string) {
  return s.courses
    .filter((c) => c.entityId === entityId && !c.deletedAt)
    .sort((a, b) => b.version - a.version)[0];
}
export function appendQualification(
  s: State,
  before: Qualification,
  candidate: Qualification,
  actorId: string,
  cause: string,
) {
  if (before.version === null) {
    Object.assign(before, candidate, {
      id: before.id,
      version: null,
      releaseVersion: null,
      revision: before.revision + 1,
      lifecycleStatus: "Ready",
    });
    return before;
  }
  const kind = qualificationChange(s, before, candidate);
  const next: Qualification = {
    ...structuredClone(candidate),
    id: randomUUID(),
    parentId: before.id,
    version:
      Math.max(
        ...s.qualifications
          .filter((q) => q.entityId === before.entityId)
          .map((q) => q.version || 0),
      ) + 1,
    revision: 1,
    releaseVersion: nextReleaseVersion(releaseNumber(before), kind),
    releaseInfo: releaseInfo(kind, actorId, cause, before.id),
  };
  s.qualifications.push(next);
  return next;
}
export function propagateCourses(
  s: State,
  courses: Course[],
  actorId: string,
  cause: string,
): ReleasePropagation {
  const result: ReleasePropagation = { updated: [], deferred: [] };
  for (const ref of currentTeamQualifications(s)) {
    const q = s.qualifications.find((q) => q.id === ref.qualificationId)!;
    const ids = q.courseIds.map((id) => {
      const old = s.courses.find((c) => c.id === id)!;
      const next = courses.find(
        (c) =>
          c.entityId === old.entityId &&
          c.lv1OrganizationId === q.lv1OrganizationId,
      );
      if (!next || next.id === id) return id;
      const errors = [
        ...courseUseErrors(next),
        ...renewalQualificationErrors({ ...q, courseIds: [next.id] }, [next]),
      ];
      if (errors.length || next.operationalStatus !== "active") {
        result.deferred.push({
          id: q.id,
          title: q.title,
          reason: errors.join(" · ") || "인증Set 운영 종료",
        });
        return id;
      }
      return next.id;
    });
    if (isDeepStrictEqual(ids, q.courseIds)) continue;
    const next = appendQualification(
      s,
      q,
      { ...q, courseIds: ids },
      actorId,
      cause,
    );
    if (next.releaseVersion)
      result.updated.push({
        id: next.id,
        title: next.title,
        releaseVersion: next.releaseVersion,
      });
  }
  return result;
}
export function criteriaFingerprint(s: State, q: Qualification) {
  return canonicalHash({
    qualificationId: q.id,
    qualificationVersion: releaseNumber(q),
    qualificationHash: qualificationHash(q),
    courses: q.courseIds.map((id) => {
      const c = s.courses.find((c) => c.id === id)!;
      return {
        id: c.id,
        entityId: c.entityId,
        releaseVersion: releaseNumber(c),
        hash: canonicalHash(CourseContentSchema.parse(c)),
      };
    }),
  });
}
export function qualificationHash(q: Qualification) {
  const {
    revision,
    lifecycleStatus,
    deletedAt,
    deletedBy,
    deletionReason,
    releaseInfo: info,
    ...content
  } = q;
  if (content.purpose === "acquisition") delete content.purpose;
  return canonicalHash(content);
}
export function freezeCriteria(
  s: State,
  q: Qualification,
  actorId: string,
  source: FrozenCriteria["source"],
  at = new Date().toISOString(),
): FrozenCriteria {
  demand(q.version !== null, 409, "최초 자격 설정을 저장해 주세요.");
  return {
    qualificationId: q.id,
    qualificationVersion: releaseNumber(q),
    qualificationHash: qualificationHash(q),
    courses: q.courseIds.map((id) => {
      const c = s.courses.find((c) => c.id === id)!;
      return {
        id,
        entityId: c.entityId,
        releaseVersion: releaseNumber(c),
        hash: canonicalHash(CourseContentSchema.parse(c)),
      };
    }),
    confirmedAt: at,
    confirmedBy: actorId,
    source,
  };
}
export function latestCompleteCommon(s: State, id: string) {
  return s.commonCourseReleases
    .filter((r) => r.commonCourseId === id && !courseUseErrors(r).length)
    .sort((a, b) => b.sequence - a.sequence)[0];
}
function sourceHash(c: CourseContent) {
  return createHash("sha256")
    .update(JSON.stringify(comparableCourseContent(c)))
    .digest("hex");
}
export function applyCommonRelease(
  s: State,
  old: Course,
  source: State["commonCourseReleases"][number],
  actorId: string,
): Course {
  const decision = courseRelease(old, source);
  const kind = decision.kind;
  // IDs are local to the team. Old releases retain their original IDs and all progress.
  const fresh = <T extends { id: string }>(values: T[]) =>
    values.map((v) => ({ ...structuredClone(v), id: randomUUID() }));
  const content = CourseContentSchema.parse(source);
  const next: Course = {
    ...old,
    ...structuredClone(content),
    id: randomUUID(),
    parentId: old.id,
    version: old.version + 1,
    revision: 1,
    releaseVersion: decision.releaseVersion,
    releaseInfo: releaseInfo(
      kind === "major" ? "major" : "minor",
      actorId,
      "공통 원본 반영",
      old.id,
    ),
    commonCourseSource: {
      id: source.commonCourseId,
      revision: s.commonCourses.find((c) => c.id === source.commonCourseId)!
        .revision,
      releaseId: source.id,
      releaseVersion: source.releaseVersion,
      baselineHash: sourceHash(source),
    },
    learningItems: fresh(content.learningItems),
    materials: fresh(content.materials),
    questions: fresh(content.questions),
    practicalQuestions: fresh(content.practicalQuestions),
    subjectiveQuestions: fresh(content.subjectiveQuestions),
  };
  s.courses.push(next);
  return next;
}
export function propagateCommon(
  s: State,
  source: State["commonCourseReleases"][number],
  actorId: string,
): ReleasePropagation {
  const result: ReleasePropagation = { updated: [], deferred: [] },
    changed: Course[] = [];
  const copies = [
    ...new Set(
      s.courses
        .filter((c) => c.commonCourseSource?.id === source.commonCourseId)
        .map((c) => c.entityId),
    ),
  ]
    .map((id) => latestCourse(s, id))
    .filter((c): c is Course => !!c);
  for (const copy of copies) {
    const errors = courseUseErrors(source);
    if (errors.length) {
      result.deferred.push({
        id: copy.id,
        title: copy.title,
        reason: errors.join(" · "),
      });
      continue;
    }
    if (copy.operationalStatus !== "active") {
      result.deferred.push({
        id: copy.id,
        title: copy.title,
        reason: "팀 인증Set 운영 종료",
      });
      continue;
    }
    for (const pending of s.commonUpdates.filter(
      (u) => u.courseEntityId === copy.entityId && u.status === "pending",
    ))
      pending.status = "superseded";
    if (sourceHash(copy) !== copy.commonCourseSource!.baselineHash) {
      s.commonUpdates.push({
        id: randomUUID(),
        commonCourseId: source.commonCourseId,
        sourceReleaseId: source.id,
        courseEntityId: copy.entityId,
        teamId: copy.lv1OrganizationId,
        status: "pending",
        reason: "팀에서 수정한 내용이 있어 원본 반영을 보류했습니다.",
        createdAt: new Date().toISOString(),
      });
      result.deferred.push({
        id: copy.id,
        title: copy.title,
        reason: "팀 수정 내용 확인 필요",
      });
      continue;
    }
    if (courseChange(copy, source) === "none") continue;
    const next = applyCommonRelease(s, copy, source, actorId);
    changed.push(next);
    result.updated.push({
      id: next.id,
      title: next.title,
      releaseVersion: releaseNumber(next),
    });
  }
  const linked = propagateCourses(
    s,
    changed,
    actorId,
    "공통 원본 → 팀 인증Set 자동 반영",
  );
  result.updated.push(...linked.updated);
  result.deferred.push(...linked.deferred);
  return result;
}
export function resolveCommonUpdate(
  s: State,
  id: string,
  actorId: string,
  team: string,
  body: any,
) {
  const pending = s.commonUpdates.find((u) => u.id === id);
  demand(
    pending && pending.teamId === team,
    404,
    "반영 보류 항목을 찾을 수 없습니다.",
  );
  const copy = latestCourse(s, pending.courseEntityId),
    source = s.commonCourseReleases.find(
      (r) => r.id === pending.sourceReleaseId,
    );
  demand(
    pending.status === "pending" && copy && source,
    409,
    "반영 상태가 변경되었습니다.",
  );
  demand(
    body.courseId === copy.id &&
      body.revision === copy.revision &&
      body.sourceReleaseId === source.id,
    409,
    "비교 후 기준이 변경되었습니다. 다시 확인해 주세요.",
    "REVISION_CONFLICT",
  );
  demand(
    body.decision === "apply" || body.decision === "keep",
    422,
    "원본 반영 또는 팀 내용 유지를 선택해 주세요.",
  );
  let propagation: ReleasePropagation = { updated: [], deferred: [] };
  if (body.decision === "apply") {
    demand(
      !courseUseErrors(source).length && copy.operationalStatus === "active",
      409,
      "운영 가능한 기준을 확인해 주세요.",
    );
    const next = applyCommonRelease(s, copy, source, actorId);
    propagation = propagateCourses(
      s,
      [next],
      actorId,
      "팀 관리자의 공통 원본 반영",
    );
  }
  pending.status = body.decision === "apply" ? "applied" : "kept";
  pending.resolvedAt = new Date().toISOString();
  pending.resolvedBy = actorId;
  return { id: pending.id, propagation };
}
