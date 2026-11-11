import { seedState } from "../src/seed.ts";
import { seedOrganizations } from "../src/organizations.ts";
import { migrateMentorPractical } from "../src/mentor-practical-migration.ts";
import { freezeCriteria } from "../src/releases.ts";
import { validateState } from "../src/integrity.ts";
export const mentorNow = "2026-11-11T01:00:00.000Z";
export function mentorSeed(objective = false) {
  const doc = seedOrganizations(),
    { state: s } = migrateMentorPractical(seedState(true), doc, mentorNow);
  s.attempts = [];
  const c = s.courses.find((c) => c.id === "demo-course-1")!;
  c.mentorPractical = {
    passScore: 80,
    questions: [
      {
        id: "m1",
        prompt: "장비를 점검하고 수행 내용을 기록하세요.",
        points: 20,
      },
      { id: "m2", prompt: "시료를 측정하고 결과를 설명하세요.", points: 30 },
      { id: "m3", prompt: "오차 원인과 조치를 설명하세요.", points: 50 },
    ],
  };
  c.assessmentKinds = objective ? ["objective"] : [];
  const q = s.qualifications.find((q) => q.id === "demo-qualification")!;
  q.courseIds = [c.id];
  const a = s.assignments.find((a) => a.learnerId === "learner-1")!;
  a.frozenCriteria = freezeCriteria(s, q, "admin-1", "plan", mentorNow);
  s.assignments = [a];
  s.enrollments = [
    { id: "mentor-enrollment", assignmentId: a.id, courseId: c.id },
  ];
  s.users.find((u) => u.id === "ft-1")!.roles = ["ft"];
  s.users.find((u) => u.id === "ft-2")!.roles = ["learner", "ft"];
  return validateState(s, doc);
}
