import { seedState } from "../src/seed.ts";
import { seedOrganizations } from "../src/organizations.ts";
import { migrateGroupPractical } from "../src/group-practical-migration.ts";
import { freezeCriteria } from "../src/releases.ts";
import { validateState } from "../src/integrity.ts";

export const groupNow = "2026-11-11T01:00:00.000Z";
export function groupSeed(count = 3, otherCourse = false) {
  const organizations = seedOrganizations();
  const { state } = migrateGroupPractical(
    seedState(true),
    organizations,
    groupNow,
  );
  state.attempts = [];
  const c = state.courses.find((c) => c.id === "demo-course-1")!;
  c.groupPractical = {
    instruction: "각자 같은 시료로 3회 측정",
    method: "외부 분석",
    criterion: "평가자가 결과값과 보고서 대조 후 판정",
    metrics: [{ id: "variation", label: "변동률", type: "number", unit: "%" }],
  };
  c.assessmentKinds = [];
  c.subjectiveEnabled = false;
  const q = state.qualifications.find((q) => q.id === "demo-qualification")!;
  if (!otherCourse) q.courseIds = [c.id];
  const prototype = state.assignments[0]!;
  prototype.frozenCriteria = freezeCriteria(
    state,
    q,
    "admin-1",
    "plan",
    groupNow,
  );
  state.assignments = ["learner-1", "ft-1", "learner-2", "ft-2"]
    .slice(0, count)
    .map((learnerId, i) => ({
      ...structuredClone(prototype),
      id: `group-assignment-${i}`,
      learnerId,
    }));
  state.enrollments = state.assignments.flatMap((a) =>
    q.courseIds.map((courseId) => ({
      id: `${a.id}:${courseId}`,
      assignmentId: a.id,
      courseId,
    })),
  );
  return validateState(state, organizations);
}
