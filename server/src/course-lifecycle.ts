import { z } from "zod";
import type { State, CourseUsage, UserView } from "@eks/contracts";
import { demand } from "./errors.ts";

export function courseUsage(
  s: State,
  courseId: string,
  scope: string,
): CourseUsage {
  const course = s.courses.find((c) => c.id === courseId);
  demand(course, 404, "인증Set을 찾을 수 없습니다.");
  demand(
    course.lv1OrganizationId === scope,
    403,
    "선택한 Lv1의 인증Set만 관리할 수 있습니다.",
  );
  const qualifications = s.qualifications.filter((q) =>
    q.courseIds.includes(courseId),
  );
  const enrollments = s.enrollments.filter((e) => e.courseId === courseId);
  const assignmentIds = new Set(enrollments.map((e) => e.assignmentId));
  const successorVersions = s.courses
    .filter((c) => c.parentId === courseId)
    .map(({ id, version }) => ({ id, version }));
  const counts = {
    assignments: assignmentIds.size,
    enrollments: enrollments.length,
    attempts: s.attempts.filter((a) => a.courseId === courseId).length,
    completions: s.completions.filter((c) => c.courseId === courseId).length,
    certifications: s.certifications.filter((c) =>
      assignmentIds.has(c.assignmentId),
    ).length,
    comparisons: s.comparisons.filter((c) => c.courseId === courseId).length,
  };
  const blockers = [
    ...qualifications.map(
      (q) => `연결된 자격: ${q.title || "이름 없는 자격"} v${q.version}`,
    ),
    ...(Object.values(counts).some((n) => n > 0)
      ? ["수강·평가·수료·인증·비교 기록이 연결되어 있습니다."]
      : []),
    ...(successorVersions.length ? ["후속 버전이 연결되어 있습니다."] : []),
  ];
  return {
    courseId,
    lv1OrganizationId: scope,
    courseRevision: course.revision,
    stateRevision: s.revision,
    canDelete: !blockers.length,
    blockers,
    qualifications: qualifications.map(({ id, title, version }) => ({
      id,
      title,
      version,
    })),
    successorVersions,
    counts,
  };
}

export function changeCourseLifecycle(
  s: State,
  user: UserView,
  action: string,
  id: string,
  body: unknown,
  scope: string,
) {
  const input = z
    .object({
      courseRevision: z.number().int().positive(),
      stateRevision: z.number().int().nonnegative(),
      reason: z.string().trim().min(1, "변경 사유를 입력해 주세요.").max(2000),
    })
    .parse(body);
  const usage = courseUsage(s, id, scope);
  demand(
    usage.courseRevision === input.courseRevision &&
      usage.stateRevision === input.stateRevision,
    409,
    "확인 후 데이터가 변경되었습니다. 영향을 다시 조회해 주세요.",
    "REVISION_CONFLICT",
  );
  const course = s.courses.find((c) => c.id === id)!;
  const before = structuredClone(course);
  if (action === "course.delete") {
    demand(usage.canDelete, 409, usage.blockers.join("\n"));
    s.courses = s.courses.filter((c) => c.id !== id);
  } else {
    const retire = action === "course.retire";
    demand(
      course.operationalStatus === (retire ? "active" : "retired"),
      409,
      "인증Set의 운영 상태가 변경되었습니다. 다시 확인해 주세요.",
    );
    course.operationalStatus = retire ? "retired" : "active";
    course.revision++;
    if (retire) {
      course.retiredAt = new Date().toISOString();
      course.retiredBy = user.id;
      course.retirementReason = input.reason;
    } else {
      delete course.retiredAt;
      delete course.retiredBy;
      delete course.retirementReason;
    }
  }
  return {
    response: { id, revision: course.revision },
    reason: input.reason,
    details: JSON.parse(
      JSON.stringify({
        before,
        usage,
        operationalStatus:
          action === "course.delete" ? "deleted" : course.operationalStatus,
      }),
    ),
  };
}
