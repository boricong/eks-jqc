import { configureTestPolicies } from "./policy-helpers.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  CourseSchema,
  QualificationSchema,
  unknownValidity,
  type State,
} from "@eks/contracts";
import { seedState } from "../src/seed.ts";
import { seedOrganizations, PHOTO_ID } from "../src/organizations.ts";
import { validateState } from "../src/integrity.ts";
import { photoSetupApplied, preparePhotoSetup } from "../src/photo-setup.ts";
import { photoCourseSpecs } from "../src/photo-certification-fixture.ts";
import { qualificationTemplates } from "../src/workflow.ts";
import { JsonStore } from "../src/storage.ts";
import { buildApp } from "../src/app.ts";

function source(): State {
  const state = seedState(true);
  const demo = state.qualifications.find((q) => q.id === "demo-qualification")!;
  state.qualifications.push(
    QualificationSchema.parse({
      ...demo,
      id: "old-bad-eqp-backup",
      entityId: "old-bad-eqp-backup",
      title: "설비 Backup 검증 자격",
      templateId: "eqp-backup",
      courseIds: ["recipe-create"],
      status: "draft",
      publishedAt: undefined,
      description: "",
      validity: unknownValidity(),
    }),
  );
  state.qualifications.push(
    QualificationSchema.parse({
      ...demo,
      id: "old-proc-backup-draft",
      entityId: "old-proc-backup-draft",
      title: "공정 Backup 검증 자격",
      templateId: "proc-backup",
      courseIds: [],
      status: "draft",
      publishedAt: undefined,
      description: "",
      validity: unknownValidity(),
    }),
  );
  state.courses.push(
    CourseSchema.parse({
      ...state.courses[0]!,
      id: "fab-unrelated-course",
      entityId: "fab-unrelated-course",
      lv1OrganizationId: "org-fab",
      title: "FAB 보존 과정",
    }),
  );
  return validateState(state, seedOrganizations());
}

test("Photo 15종 × 5과정 × 2유형 3항목: 정답 표기·채점값·진행 정리·무관한 기준 보존", () => {
  const before = source();
  const original = structuredClone(before);
  const organizations = seedOrganizations();
  const { state, report } = preparePhotoSetup(
    before,
    organizations,
    "operator-1",
    "2026-10-19T00:00:00.000Z",
  );
  assert.deepEqual(before, original, "미리보기는 원본을 변경하지 않는다");
  assert.equal(report.publishedQualificationIds.length, 15);
  assert.equal(report.publishedCourseIds.length, 75);
  assert.equal(
    state.courses.filter((c) => c.lv1OrganizationId === PHOTO_ID).length,
    75,
  );
  assert.equal(
    state.qualifications.filter(
      (q) => q.lv1OrganizationId === PHOTO_ID && q.status === "published",
    ).length,
    15,
  );
  assert.deepEqual(
    state.qualifications
      .filter(
        (q) => q.lv1OrganizationId === PHOTO_ID && q.status === "published",
      )
      .map((q) => q.title),
    qualificationTemplates.map((template) => template.title),
  );
  assert.ok(
    state.qualifications.some(
      (q) => q.id === "old-proc-backup-draft" && q.status === "published",
    ),
  );
  assert.ok(state.courses.some((c) => c.id === "fab-unrelated-course"));
  assert.ok(
    !state.courses.some((c) =>
      [
        "demo-course-1",
        "demo-course-2",
        "recipe-create",
        "recipe-edit",
      ].includes(c.id),
    ),
  );
  assert.ok(
    !state.qualifications.some((q) =>
      ["demo-qualification", "recipe", "old-bad-eqp-backup"].includes(q.id),
    ),
  );
  for (const key of [
    "assignments",
    "enrollments",
    "attempts",
    "completions",
    "certifications",
    "plans",
    "planningRequests",
    "learningRecords",
    "notifications",
    "comparisons",
  ] as const)
    assert.equal(state[key].length, 0, `${key} reset`);
  assert.ok(photoSetupApplied(state));
  const appliedAudit = state.audits.find(
    (event) => event.action === "fixture.photo.apply",
  )!;
  assert.equal(appliedAudit.details.removedQualificationCount, 3);
  assert.equal(appliedAudit.details.removedCourseCount, 4);
  assert.ok(!JSON.stringify(appliedAudit).includes("demo-qualification"));
  assert.throws(
    () =>
      preparePhotoSetup(
        state,
        organizations,
        "operator-1",
        "2026-10-19T00:00:00.000Z",
      ),
    /이미 적용/,
  );

  for (const template of qualificationTemplates) {
    const qualification = state.qualifications.find(
      (q) => q.lv1OrganizationId === PHOTO_ID && q.templateId === template.id,
    )!;
    assert.equal(qualification.englishName, template.englishName);
    assert.equal(qualification.courseIds.length, 5);
    assert.deepEqual(qualification.validity, {
      type: "months",
      months: 36,
      reminderDays: [90, 30, 7],
    });
    assert.match(qualification.description, /프로세스 검증용/);
    qualification.courseIds.forEach((id, i) => {
      const course = state.courses.find((c) => c.id === id)!;
      assert.equal(course.title, photoCourseSpecs[template.id]![i]![0]);
      assert.equal(course.status, "published");
      assert.deepEqual(course.assessmentKinds, ["objective", "practical"]);
      assert.equal(course.learningItems.length, 1);
      assert.equal(course.learningItems[0]!.required, true);
      assert.equal(course.passScore, 100);
      assert.equal(course.practicalPassScore, 100);
      assert.equal(course.questions.length, 3);
      assert.equal(course.practicalQuestions.length, 3);
      course.questions.forEach((question) => {
        const suffix = /\[테스트 정답: (\d)번 (.+)\]$/.exec(question.prompt);
        assert.ok(suffix, question.prompt);
        assert.equal(Number(suffix[1]) - 1, question.correct);
        assert.equal(suffix[2], question.choices[question.correct!]);
      });
      course.practicalQuestions.forEach((q) => {
        const m = /\[테스트 정답: (\d)번 (.+)\]$/.exec(q.prompt)!;
        assert.ok(q.scenario);
        assert.equal(Number(m[1]) - 1, q.correct);
        assert.equal(m[2], q.choices[q.correct!]);
      });
    });
  }
  validateState({ ...state, revision: state.revision + 1 }, organizations);
});

test("예상 밖의 자격이 삭제할 과정에 연결되어 있으면 전체 적용을 중단한다", () => {
  const state = source();
  const other = state.qualifications.find(
    (q) => q.id === "demo-qualification",
  )!;
  state.qualifications.push(
    QualificationSchema.parse({
      ...other,
      id: "unexpected-reference",
      entityId: "unexpected-reference",
      title: "예상 밖 참조",
      templateId: undefined,
      courseIds: ["recipe-create"],
    }),
  );
  assert.throws(
    () =>
      preparePhotoSetup(
        state,
        seedOrganizations(),
        "operator-1",
        "2026-10-19T00:00:00.000Z",
      ),
    /예상 밖의 자격/,
  );
});

test("최초 설치용 초기 데이터에는 옛 체험 자격·과정·진행이 없다", () => {
  const state = seedState();
  assert.equal(state.qualifications.length, 0);
  assert.equal(state.courses.length, 0);
  assert.equal(state.assignments.length, 0);
  assert.equal(
    state.notices.some((n) => n.id === "notice-3"),
    false,
  );
});

test("Photo 5과정 계획·학습·지식·상황 대응 완료 후 36개월 인증", async (t) => {
  const { state } = preparePhotoSetup(
    source(),
    seedOrganizations(),
    "operator-1",
    "2026-10-19T01:00:00.000Z",
  );
  const dir = await mkdtemp(path.join(tmpdir(), "eks-photo-process-"));
  const file = path.join(dir, "runtime", "state.json");
  await new JsonStore(file).initialize(state);
  const store = await new JsonStore(file).load();
  await configureTestPolicies(store);
  const app = await buildApp(store, {
    clock: () => "2026-10-19T01:00:00.000Z",
  });
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const sessions = new Map<string, string>();
  async function call(
    actor: string,
    route: string,
    payload?: any,
    method: "GET" | "POST" | "PUT" = payload === undefined ? "GET" : "POST",
  ) {
    if (!sessions.has(actor)) {
      const login = await app.inject({
        method: "POST",
        url: "/api/session",
        payload: { actorId: actor },
      });
      assert.equal(login.statusCode, 200, login.body);
      sessions.set(
        actor,
        `${login.cookies[0]!.name}=${login.cookies[0]!.value}`,
      );
    }
    const result = await app.inject({
      method,
      url: `/api${route}`,
      headers: {
        cookie: sessions.get(actor)!,
        "idempotency-key": randomUUID(),
      },
      ...(payload === undefined ? {} : { payload }),
    });
    assert.equal(result.statusCode, 200, `${actor} ${route}: ${result.body}`);
    return result.json();
  }
  const qualification = store
    .snapshot()
    .qualifications.find((q) => q.templateId === "eqp-backup")!;
  const request = await call("admin-1", "/planning-requests", {
    learnerIds: ["learner-1"],
    dueOn: "2026-10-31",
    message: "Photo 시험 계획",
  });
  const plan = await call("learner-1", "/plans", {
    requestId: request.ids[0],
    qualificationId: qualification.id,
  });
  const draft = store.snapshot().plans.find((p) => p.id === plan.id)!;
  await call(
    "learner-1",
    `/plans/${plan.id}`,
    {
      revision: draft.revision,
      targetOn: "2026-12-31",
      schedules: draft.schedules.map((schedule) => ({
        ...schedule,
        learningStart: "2026-10-01",
        learningEnd: "2026-10-19",
        assessmentOn: "2026-11-01",
        goal: "가상 기준과 결과를 독립적으로 검증한다.",
      })),
    },
    "PUT",
  );
  const completed = await call("learner-1", `/plans/${plan.id}/complete`, {
    revision: draft.revision + 1,
  });
  const assignment = store
    .snapshot()
    .assignments.find((a) => a.id === completed.assignmentId)!;
  const enrollments = store
    .snapshot()
    .enrollments.filter((e) => e.assignmentId === assignment.id);
  assert.equal(enrollments.length, 5);
  for (const enrollment of enrollments) {
    const course = store
      .snapshot()
      .courses.find((c) => c.id === enrollment.courseId)!;
    const objective = await call(
      "learner-1",
      `/enrollments/${encodeURIComponent(enrollment.id)}/attempts`,
      { kind: "objective" },
    );
    await call(
      "learner-1",
      `/attempts/${objective.id}/draft`,
      {
        revision: objective.revision,
        answers: Object.fromEntries(
          course.questions.map((q) => [q.id, q.correct]),
        ),
      },
      "PUT",
    );
    await call("learner-1", `/attempts/${objective.id}/submit`, {
      revision: objective.revision + 1,
    });
    const practical = await call(
      "learner-1",
      `/enrollments/${encodeURIComponent(enrollment.id)}/attempts`,
      { kind: "practical" },
    );
    await call(
      "learner-1",
      `/attempts/${practical.id}/draft`,
      {
        revision: practical.revision,
        answers: Object.fromEntries(
          course.practicalQuestions.map((q) => [q.id, q.correct]),
        ),
      },
      "PUT",
    );
    await call("learner-1", `/attempts/${practical.id}/submit`, {
      revision: practical.revision + 1,
    });
  }
  const final = store.snapshot();
  assert.equal(
    final.completions.filter((c) =>
      enrollments.some((e) => e.id === c.enrollmentId),
    ).length,
    5,
  );
  const certificate = final.certifications.find(
    (c) => c.assignmentId === assignment.id,
  )!;
  assert.ok(certificate);
  assert.equal(certificate.expiresOn, "2029-10-19");
  assert.equal(
    final.certifications.filter((c) => c.assignmentId === assignment.id).length,
    1,
  );
  const workspace = await call("learner-1", "/workspace");
  assert.ok(
    workspace.assignments.some((a: { id: string }) => a.id === assignment.id),
  );
});
