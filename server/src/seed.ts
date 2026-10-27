import { initializeObjectiveRenewals } from "./objective-renewal-migration.ts";
import { initializeRequirementExceptions } from "./requirement-exception-migration.ts";
import { initializeReleases } from "./release-migration.ts";
import { initialTemplates, metadata } from "./qualification-templates.ts";
import {
  convertCourseFields,
  scenarioQuestions,
} from "./assessment-transition.ts";
import { readFileSync } from "node:fs";
import {
  StateSchema,
  type State,
  type AssessmentAttempt,
  unknownValidity,
  assessmentQuestions,
  assessmentPassScore,
} from "@eks/contracts";
import { validateState } from "./integrity.ts";
import { PHOTO_ID, seedOrganizations, organization } from "./organizations.ts";

// Production initialization starts with users and organizations. The older
// fictional catalog is stored only in an isolated regression-test fixture.
export function seedState(testFixture = false): State {
  const source = JSON.parse(
    readFileSync(
      new URL(
        testFixture
          ? "../tests/fixtures/seed-source.json"
          : "./seed-source.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const state: State = {
    schemaVersion: 25,
    organizationQualificationRequirements: [],
    subjectiveResponses: [],
    commonCourses: [],
    commonCourseReleases: [],
    commonUpdates: [],
    auditorPrograms: [],
    qualificationTemplates: initialTemplates(),
    renewalBatches: [],
    renewals: [],
    lifecycleEvents: [],
    catalogBatches: [],
    revision: 0,
    users: source.users.map((u: any) => ({
      id: u.id,
      name: u.name,
      roles: (u.roles || [u.role]).map((r: string) =>
        r === "ft" ? "learner" : r,
      ),
      organizationId: PHOTO_ID,
      revision: 1,
    })),
    courses: (testFixture ? source.courses : []).map((c: any) =>
      convertCourseFields({
        ...c,
        assessmentKinds:
          c.mode === "both" ? ["objective", "practical"] : [c.mode],
        learningItems:
          c.status === "published"
            ? [
                {
                  id: `${c.id}-learning`,
                  type: "team",
                  title: "가상 학습자료 확인과 독립 수행 연습",
                  required: true,
                },
              ]
            : [],
        operationalStatus: "active",
        lv1OrganizationId: PHOTO_ID,
        entityId: c.id,
        revision: 1,
        materialUrl: "",
        questions: c.questions.map((q: any) => ({
          ...q,
          category: q.category || "written",
        })),
        practicalQuestions: scenarioQuestions(
          c.id,
          c.title,
          c.practicalItems.map((i: any) => i.criterion),
        ),
        practicalPassScore: 100,
        ...(c.status === "published"
          ? { publishedAt: "2026-10-15T00:00:00.000Z" }
          : {}),
      }),
    ),
    qualifications: (testFixture ? source.qualifications : []).map(
      (q: any) => ({
        ...q,
        qualificationType: "auditee",
        templateId: `fixture-${q.id}`,
        templateRevision: 1,
        englishName: "",
        description:
          q.status === "published"
            ? "실제 직무 기준이 아닌 가상 평가 흐름 체험입니다."
            : "",
        validity:
          q.status === "published"
            ? { type: "unlimited", months: null, reminderDays: [] }
            : unknownValidity(),
        lv1OrganizationId: PHOTO_ID,
        entityId: q.id,
        revision: 1,
        ...(q.status === "published"
          ? { publishedAt: "2026-10-15T00:00:00.000Z" }
          : {}),
      }),
    ),
    assignments: [],
    enrollments: [],
    attempts: [],
    completions: [],
    certifications: [],
    notices: source.notices
      .filter((n: any) => testFixture || n.id !== "notice-3")
      .map((n: any) => ({
        ...n,
        scope: "team",
        ...(n.id === "notice-2"
          ? {
              body: "학습 안내에서 범위와 자료를 확인한 뒤 지식·상황 대응 평가에 응시하세요. 별도 학습 완료 기록 없이 서버가 유형별 기준으로 자동 채점합니다.",
            }
          : {}),
        revision: 1,
        lv1OrganizationId: PHOTO_ID,
      })),
    comparisons: [],
    audits: [],
    requests: [],
    planningRequests: [],
    plans: [],
    learningRecords: [],
    learningChecklists: [],
    notifications: [],
  };
  for (const q of state.qualifications)
    state.qualificationTemplates.push({
      qualificationType: q.qualificationType,
      defaultCommonCourseIds: [],
      id: q.templateId,
      revision: 1,
      title: q.title,
      englishName: q.englishName,
      description: q.description,
      updatedAt: "2026-10-15T00:00:00.000Z",
      updatedBy: "operator-1",
    });
  state.users.push({
    id: "operator-1",
    name: "시스템 운영자",
    roles: ["system_operator"],
    organizationId: PHOTO_ID,
    revision: 1,
  });
  for (const a of testFixture ? source.assignments : []) {
    state.assignments.push({
      id: a.id,
      qualificationId: a.qualificationId,
      qualificationMetadata: metadata(
        state.qualifications.find((q) => q.id === a.qualificationId)!,
      ),
      learnerId: a.learnerId,
      ownerAdminId: "admin-1",
      lv1OrganizationId: PHOTO_ID,
      organizationPath: organization(seedOrganizations(), PHOTO_ID).path,
      organizationSource: "assigned",
      assignedAt: `${a.assignedAt}T00:00:00.000Z`,
      revision: 1,
    });
    for (const e of a.enrollments) {
      const id = `${a.id}:${e.courseId}`;
      state.enrollments.push({ id, assignmentId: a.id, courseId: e.courseId });
      for (const h of e.history) {
        const t: AssessmentAttempt = {
          ...h,
          enrollmentId: id,
          courseId: e.courseId,
          learnerId: a.learnerId,
          revision: 1,
          status: "graded",
          submittedAt: h.date,
          createdAt: h.date,
          answers: h.answers || {},
        };
        {
          const c = state.courses.find((c) => c.id === e.courseId)!;
          const questions = assessmentQuestions(c, t.kind);
          if (t.kind === "practical")
            t.answers = Object.fromEntries(
              questions.map((q) => [
                q.id,
                h.result === "passed"
                  ? q.correct!
                  : (q.correct! + 1) % q.choices.length,
              ]),
            );
          t.itemResults = questions.map((q) => ({
            itemId: q.id,
            correct: t.answers[q.id] === q.correct,
            earned: t.answers[q.id] === q.correct ? q.points : 0,
            possible: q.points,
          }));
          t.earned = t.itemResults.reduce((n, r) => n + r.earned, 0);
          t.total = questions.reduce((n, q) => n + q.points, 0);
        }
        state.attempts.push(t);
      }
    }
  }
  if (testFixture)
    state.audits.push({
      id: "seed-event",
      lv1OrganizationId: PHOTO_ID,
      actorId: "admin-1",
      date: "2026-10-15T00:00:00.000Z",
      action: "seed",
      targetId: "assignment-1",
      assignmentId: "assignment-1",
      reason: "가상 데이터 초기화",
      details: { fictional: true },
    });
  return validateState(
    StateSchema.parse(
      initializeObjectiveRenewals(
        initializeRequirementExceptions(initializeReleases(state)),
      ),
    ),
    seedOrganizations(),
  );
}
