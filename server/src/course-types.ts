import type { Course, QualificationType, State } from "@eks/contracts";
import { demand } from "./errors.ts";

// A lineage may only change type before any version or business reference exists.
export function courseTypeEditing(s: State, course: Course) {
  const lineage = s.courses.filter((c) => c.entityId === course.entityId);
  const ids = new Set(lineage.map((c) => c.id));
  const linked =
    s.qualifications.some((q) => q.courseIds.some((id) => ids.has(id))) ||
    s.plans.some(
      (p) =>
        p.previousSchedule?.schedules.some((x) => ids.has(x.courseId)) ||
        p.qualificationPolicySnapshot?.courseIds.some((id) => ids.has(id)),
    ) ||
    s.assignments.some((a) =>
      a.qualificationPolicySnapshot?.courseIds.some((id) => ids.has(id)),
    ) ||
    s.enrollments.some((e) => ids.has(e.courseId)) ||
    s.subjectiveResponses.some((r) => ids.has(r.courseId)) ||
    s.attempts.some((a) => ids.has(a.courseId)) ||
    s.completions.some((c) => ids.has(c.courseId)) ||
    s.comparisons.some((c) => ids.has(c.courseId));
  const versioned =
    lineage.length !== 1 || course.version !== 1 || !!course.parentId;
  const canChangeType =
    course.category !== "common" && !course.deletedAt && !linked && !versioned;
  return {
    canChangeType,
    typeChangeReason: course.deletedAt
      ? "삭제된 인증Set은 변경할 수 없습니다."
      : linked
        ? "자격 연결 또는 학습·평가 이력이 있어 유형을 변경할 수 없습니다."
        : versioned
          ? "버전이 분리된 인증Set은 유형을 변경할 수 없습니다."
          : "첫 버전이며 사용 이력이 없어 유형을 변경할 수 있습니다.",
  };
}
export function requireCourseTypeChange(
  s: State,
  source: Course,
  type: QualificationType,
) {
  const editing = courseTypeEditing(s, source);
  demand(
    type === source.qualificationType || editing.canChangeType,
    409,
    editing.typeChangeReason,
    "COURSE_TYPE_LOCKED",
  );
}

// Used only by explicit legacy migration/import. Never infer from names or latest versions.
export function classifyCourseTypes(data: any) {
  const groups = new Map<string, any[]>();
  for (const c of data.courses)
    groups.set(c.entityId, [...(groups.get(c.entityId) || []), c]);
  const qualification = new Map<string, any>(
    data.qualifications.map((q: any) => [q.id, q]),
  );
  const assignment = new Map<string, any>(
    (data.assignments || []).map((a: any) => [a.id, a]),
  );
  const classifications: {
    entityId: string;
    courseIds: string[];
    qualificationType: QualificationType;
    inferred: boolean;
  }[] = [];
  for (const [entityId, courses] of groups) {
    const ids = new Set(courses.map((c) => c.id)),
      types = new Set<QualificationType>();
    const add = (id: string, record?: any) => {
      const q = qualification.get(id),
        type =
          record?.qualificationMetadata?.qualificationType ??
          q?.qualificationType;
      if (!q || !["auditee", "auditor"].includes(type))
        throw new Error(
          `인증Set 계보 ${entityId}: 연결 자격 유형을 확인할 수 없습니다.`,
        );
      types.add(type);
    };
    for (const q of data.qualifications)
      if (q.courseIds.some((id: string) => ids.has(id))) add(q.id);
    for (const p of data.plans || [])
      if (
        (p.schedules || p.previousSchedule?.schedules || []).some((x: any) =>
          ids.has(x.courseId),
        ) ||
        p.qualificationPolicySnapshot?.courseIds.some((id: string) =>
          ids.has(id),
        )
      )
        add(p.qualificationId, p);
    for (const a of data.assignments || [])
      if (
        a.qualificationPolicySnapshot?.courseIds.some((id: string) =>
          ids.has(id),
        )
      )
        add(a.qualificationId, a);
    for (const e of data.enrollments || [])
      if (ids.has(e.courseId)) {
        const a = assignment.get(e.assignmentId);
        if (!a)
          throw new Error(
            `인증Set 계보 ${entityId}: 배정 근거가 누락되었습니다.`,
          );
        add(a.qualificationId, a);
      }
    if (types.size > 1)
      throw new Error(
        `인증Set 유형 이관 보류: ${courses[0].title || "이름 없음"} (${entityId}) 계보가 Auditee와 Auditor에 함께 연결되어 있습니다. 대상 ID: ${[...ids].join(", ")}`,
      );
    const type = [...types][0] || "auditee";
    for (const c of courses) {
      if (c.qualificationType !== undefined && c.qualificationType !== type)
        throw new Error(`인증Set ${c.id}: 기존 유형과 연결 근거가 다릅니다.`);
      c.qualificationType = type;
    }
    classifications.push({
      entityId,
      courseIds: [...ids],
      qualificationType: type,
      inferred: types.size > 0,
    });
  }
  return classifications;
}

export function auditorAssessmentChanged(candidate: Course, source?: Course) {
  if (candidate.qualificationType !== "auditor") return false;
  const fields = [
    "assessmentKinds",
    "passScore",
    "practicalPassScore",
    "questions",
    "practicalQuestions",
  ] as const;
  const baseline = source || {
    assessmentKinds: [],
    passScore: null,
    practicalPassScore: null,
    questions: [],
    practicalQuestions: [],
  };
  return fields.some(
    (k) => JSON.stringify(candidate[k]) !== JSON.stringify(baseline[k]),
  );
}
