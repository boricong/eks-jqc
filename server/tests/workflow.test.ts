import { registerFixtureQualification } from "./template-helpers.ts";
import { configureTestPolicies } from "./policy-helpers.ts";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  certificationStatus,
  expirationDate,
  kstDate,
  defaultPlanSchedule,
  type Kind,
  type State,
  type ValidityPolicy,
} from "@eks/contracts";
import { buildApp } from "../src/app.ts";
import { seedState } from "../src/seed.ts";
import { JsonStore } from "../src/storage.ts";
import { migrateState } from "../src/migration.ts";
import { validateState } from "../src/integrity.ts";

for (const goals of [
  ["", ""],
  ["", "선택 입력한 목표"],
  ["   ", "\n"],
]) {
  test(`선택 목표 ${JSON.stringify(goals)} 계획 확정·재시도·확정 후 삭제와 날짜/길이 제한`, async (t) => {
    const f = await fixture(t);
    const requestId = await invitation(f);
    const created = await f.call("learner-2", "/plans", {
      requestId,
      requestRevision: f.store
        .snapshot()
        .planningRequests.find((r) => r.id === requestId)!.revision,
      qualificationId: "demo-qualification",
    });
    const latest = () =>
      f.store.snapshot().plans.find((p) => p.id === created.id)!;
    const fields = {
      targetOn: "2026-12-01",
      schedules: latest().schedules.map((s, i) => ({
        ...s,
        learningStart: "2026-10-01",
        learningEnd: "2026-10-15",
        assessmentOn: "2026-11-01",
        goal: goals[i]!,
      })),
    };
    await f.call(
      "learner-2",
      `/plans/${created.id}`,
      { ...fields, revision: latest().revision },
      200,
      "PUT",
    );
    const revision = latest().revision,
      key = randomUUID();
    const result = await f.call(
      "learner-2",
      `/plans/${created.id}/complete`,
      { revision },
      200,
      "POST",
      key,
    );
    assert.deepEqual(
      await f.call(
        "learner-2",
        `/plans/${created.id}/complete`,
        { revision },
        200,
        "POST",
        key,
      ),
      result,
    );
    assert.deepEqual(
      latest().schedules.map((s) => s.goal),
      goals,
    );
    const assignment = f.store
      .snapshot()
      .assignments.find((a) => a.id === result.assignmentId)!;
    const empty = {
      ...fields,
      schedules: fields.schedules.map((s) => ({ ...s, goal: "" })),
    };
    await f.call(
      "learner-2",
      `/plans/${created.id}`,
      { ...empty, revision: latest().revision },
      422,
      "PUT",
    );
    await f.call(
      "learner-2",
      `/plans/${created.id}`,
      { ...empty, revision: latest().revision, reason: "선택 목표 정리" },
      200,
      "PUT",
    );
    assert.ok(latest().schedules.every((s) => s.goal === ""));
    const before = f.store.snapshot();
    const invalid = {
      ...empty,
      schedules: empty.schedules.map((s) => ({ ...s, learningEnd: "" })),
    };
    await f.call(
      "learner-2",
      `/plans/${created.id}`,
      { ...invalid, revision: latest().revision, reason: "날짜 누락" },
      422,
      "PUT",
    );
    await f.call(
      "learner-2",
      `/plans/${created.id}`,
      {
        ...empty,
        schedules: empty.schedules.map((s) => ({
          ...s,
          goal: "가".repeat(2001),
        })),
        revision: latest().revision,
        reason: "길이 초과",
      },
      422,
      "PUT",
    );
    assert.deepEqual(f.store.snapshot(), before);
    assert.deepEqual(
      f.store.snapshot().assignments.find((a) => a.id === assignment.id),
      assignment,
    );
    assert.equal(
      f.store.snapshot().assignments.filter((a) => a.planId === created.id)
        .length,
      1,
    );
    assert.equal(
      f.store.snapshot().planningRequests.find((r) => r.id === requestId)!
        .completion,
      undefined,
    );
  });
}

async function fixture(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-workflow-"));
  const file = path.join(dir, "runtime", "state.json");
  const seed = seedState(true);
  seed.users.push(
    {
      id: "etch-learner",
      name: "Etch 학습자",
      roles: ["learner"],
      organizationId: "org-etch",
      revision: 1,
    },
    {
      id: "etch-ft",
      name: "Etch FT",
      roles: ["learner"],
      organizationId: "org-etch",
      revision: 1,
    },
    {
      id: "dual",
      name: "겸직자",
      roles: ["learner"],
      organizationId: "org-photo",
      revision: 1,
    },
  );
  await new JsonStore(file).initialize(seed);
  let store = await new JsonStore(file).load();
  let clock = "2026-10-19T01:00:00.000Z";
  let app = await buildApp(store, { clock: () => clock });
  const sessions = new Map<string, string>();
  async function call(
    actor: string,
    url: string,
    data?: any,
    status = 200,
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    key = randomUUID(),
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
    const response = await app.inject({
      method: method || (data === undefined ? "GET" : "POST"),
      url: `/api${url}`,
      headers: { cookie: sessions.get(actor)!, "idempotency-key": key },
      ...(data === undefined ? {} : { payload: data }),
    });
    assert.equal(
      response.statusCode,
      status,
      `${actor} ${url}: ${response.body}`,
    );
    return response.json();
  }
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  return {
    dir,
    file,
    call,
    get store() {
      return store;
    },
    async restart(at = clock) {
      await app.close();
      clock = at;
      store = await new JsonStore(file).load();
      app = await buildApp(store, { clock: () => clock });
      sessions.clear();
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
test("계획 기본 일정은 KST 날짜·월말·윤년을 기준으로 1회 계산한다", () => {
  assert.deepEqual(defaultPlanSchedule("2026-10-18T15:00:00Z"), {
    learningStart: "2026-10-26",
    learningEnd: "2026-11-16",
    assessmentOn: "2026-11-23",
  });
  assert.equal(
    defaultPlanSchedule("2026-10-18T14:59:59Z").learningStart,
    "2026-10-25",
  );
  assert.deepEqual(defaultPlanSchedule("2028-01-31T14:59:00Z"), {
    learningStart: "2028-02-07",
    learningEnd: "2028-02-28",
    assessmentOn: "2028-03-06",
  });
  assert.equal(
    defaultPlanSchedule("2028-02-22T00:00:00Z").learningStart,
    "2028-02-29",
  );
  assert.equal(
    defaultPlanSchedule("2026-12-28T00:00:00Z").assessmentOn,
    "2027-02-01",
  );
});
test("신규 일정 저장·기존 빈 날짜만 최초 보완·수정과 삭제한 날짜 보존", async (t) => {
  const f = await fixture(t),
    { q } = await catalog(f),
    requestId = await invitation(f);
  const { id } = await f.call("learner-2", "/plans", {
    requestRevision: f.store
      .snapshot()
      .planningRequests.find((r) => r.id === requestId)!.revision,
    requestId,
    qualificationId: q,
  });
  let p = f.store.snapshot().plans.find((p) => p.id === id)!;
  assert.deepEqual(p.schedules[0], {
    courseId: p.schedules[0]!.courseId,
    ...defaultPlanSchedule(p.createdAt),
    goal: "",
  });
  assert.equal(p.scheduleDefaultsAppliedAt, p.createdAt);
  assert.equal(p.targetOn, "");
  await f.store.transact(
    "learner-2",
    randomUUID(),
    randomUUID(),
    () => {},
    (s) => {
      const legacy = s.plans.find((p) => p.id === id)!;
      delete legacy.scheduleDefaultsAppliedAt;
      legacy.schedules[0]!.learningStart = "2028-02-08";
      legacy.schedules[0]!.learningEnd = "";
      legacy.schedules[0]!.assessmentOn = "2028-03-12";
      legacy.schedules[0]!.goal = "입력한 목표 보존";
      return {};
    },
  );
  await f.call("learner-2", `/plans/${id}/schedule-defaults`, { revision: 1 });
  p = f.store.snapshot().plans.find((p) => p.id === id)!;
  assert.deepEqual(p.schedules[0], {
    courseId: p.schedules[0]!.courseId,
    learningStart: "2028-02-08",
    learningEnd: "2028-02-29",
    assessmentOn: "2028-03-12",
    goal: "입력한 목표 보존",
  });
  const schedules = p.schedules.map((s) => ({
    ...s,
    learningStart: "2028-02-10",
    learningEnd: "",
  }));
  await f.call(
    "learner-2",
    `/plans/${id}`,
    { revision: 2, targetOn: "", schedules },
    200,
    "PUT",
  );
  await f.restart();
  await f.call("learner-2", `/plans/${id}/schedule-defaults`, { revision: 3 });
  p = f.store.snapshot().plans.find((p) => p.id === id)!;
  assert.deepEqual(p.schedules, schedules);
  assert.equal(p.revision, 3);
  await f.call("learner-2", `/plans/${id}/complete`, { revision: 3 }, 422);
  await f.call(
    "learner-2",
    `/plans/${id}/schedule-defaults`,
    { revision: 2 },
    409,
  );
});
test("미확정 계획 삭제는 본인·revision·최신 역할을 검사하고 재시도·재작성을 보호한다", async (t) => {
  const f = await fixture(t),
    { q } = await catalog(f),
    requestId = await invitation(f);
  const { id } = await f.call("learner-2", "/plans", {
    requestRevision: f.store
      .snapshot()
      .planningRequests.find((r) => r.id === requestId)!.revision,
    requestId,
    qualificationId: q,
  });
  const n = f.store
    .snapshot()
    .notifications.find((n) => n.key === `planning:${requestId}`)!;
  await f.call("learner-2", `/notifications/${n.id}/read`, {});
  const readAt = f.store
    .snapshot()
    .notifications.find((v) => v.id === n.id)!.readAt;
  await f.call("learner-1", `/plans/${id}`, { revision: 1 }, 403, "DELETE");
  await f.call("admin-1", `/plans/${id}`, { revision: 1 }, 403, "DELETE");
  await f.call("learner-2", `/plans/${id}`, { revision: 2 }, 409, "DELETE");
  const key = randomUUID(),
    result = await f.call(
      "learner-2",
      `/plans/${id}`,
      { revision: 1 },
      200,
      "DELETE",
      key,
    );
  assert.deepEqual(
    await f.call(
      "learner-2",
      `/plans/${id}`,
      { revision: 1 },
      200,
      "DELETE",
      key,
    ),
    result,
  );
  assert.equal(
    f.store.snapshot().audits.filter((a) => a.action === "plan.delete").length,
    1,
  );
  const deleted = f.store.snapshot().plans.find((p) => p.id === id)!;
  assert.equal(deleted.deletedBy, "learner-2");
  assert.ok(deleted.deletedAt);
  for (const actor of ["learner-2", "admin-1", "operator-1"]) {
    const workspace = await f.call(
      actor,
      actor === "operator-1"
        ? "/workspace?lv1OrganizationId=org-photo"
        : "/workspace",
    );
    assert.ok(!workspace.plans.some((p: any) => p.id === id));
  }
  assert.equal(
    f.store.snapshot().notifications.find((v) => v.id === n.id)!.readAt,
    readAt,
  );
  const stale = await f.call(
    "learner-2",
    `/plans/${id}`,
    { revision: 1, targetOn: "", schedules: deleted.schedules },
    410,
    "PUT",
  );
  assert.equal(stale.code, "PLAN_DELETED");
  assert.equal(
    (await f.call("learner-2", `/plans/${id}/complete`, { revision: 1 }, 410))
      .code,
    "PLAN_DELETED",
  );
  const recreated = await f.call("learner-2", "/plans", {
    requestRevision: f.store
      .snapshot()
      .planningRequests.find((r) => r.id === requestId)!.revision,
    requestId,
    qualificationId: q,
  });
  assert.notEqual(recreated.id, id);
  await f.store.transact(
    "operator-1",
    randomUUID(),
    randomUUID(),
    () => {},
    (s) => {
      s.users.find((u) => u.id === "learner-2")!.roles = ["admin"];
      return {};
    },
  );
  await f.call(
    "learner-2",
    `/plans/${id}`,
    { revision: 1 },
    403,
    "DELETE",
    key,
  );
  await f.call(
    "learner-2",
    `/plans/${recreated.id}`,
    { revision: 1 },
    403,
    "DELETE",
  );
});
test("삭제와 확정의 경합은 배정을 중복 생성하지 않으며 확정 후 삭제를 거부한다", async (t) => {
  const f = await fixture(t),
    { q } = await catalog(f),
    requestId = await invitation(f);
  const { id } = await f.call("learner-2", "/plans", {
    requestRevision: f.store
      .snapshot()
      .planningRequests.find((r) => r.id === requestId)!.revision,
    requestId,
    qualificationId: q,
  });
  const p = f.store.snapshot().plans.find((p) => p.id === id)!;
  await f.call(
    "learner-2",
    `/plans/${id}`,
    {
      revision: 1,
      targetOn: "2029-12-01",
      schedules: p.schedules.map((s) => ({ ...s, goal: "독립 수행" })),
    },
    200,
    "PUT",
  );
  await Promise.all([
    f.call("learner-2", `/plans/${id}/complete`, { revision: 2 }),
    f.call("learner-2", `/plans/${id}`, { revision: 2 }, 409, "DELETE"),
  ]);
  assert.equal(
    f.store.snapshot().assignments.filter((a) => a.planId === id).length,
    1,
  );
  await f.call("learner-2", `/plans/${id}`, { revision: 3 }, 409, "DELETE");
  await f.call(
    "learner-2",
    `/plans/${id}/schedule-defaults`,
    { revision: 3 },
    409,
  );
  const other = await catalog(f),
    r = await invitation(f),
    second = await f.call("learner-2", "/plans", {
      requestRevision: f.store
        .snapshot()
        .planningRequests.find((request) => request.id === r)!.revision,
      requestId: r,
      qualificationId: other.q,
    });
  await Promise.all([
    f.call("learner-2", `/plans/${second.id}`, { revision: 1 }, 200, "DELETE"),
    f.call("learner-2", `/plans/${second.id}/complete`, { revision: 1 }, 410),
  ]);
  assert.equal(
    f.store.snapshot().assignments.filter((a) => a.planId === second.id).length,
    0,
  );
  await f.restart();
  validateState(f.store.snapshot());
});
const scope = (url: string, root = "org-photo") =>
  `${url}?lv1OrganizationId=${root}`;
const period: ValidityPolicy = {
  type: "months",
  months: 1,
  reminderDays: [30, 7],
};
async function catalog(
  f: Fixture,
  root = "org-photo",
  kinds: Kind[] = ["objective", "practical"],
) {
  const c = await f.call("operator-1", scope("/courses", root), {});
  await f.call(
    "operator-1",
    scope(`/courses/${c.id}`, root),
    {
      ...f.store.snapshot().courses[0],
      revision: 1,
      title: "계획 검증 과정",
      assessmentKinds: kinds,
      learningItems: [
        {
          id: "learn-1",
          title: "OJT 독립 수행 학습",
          type: "ojt",
          required: true,
        },
      ],
    },
    undefined,
    "PUT",
  );
  const q = await registerFixtureQualification(
    f.store,
    "개인 계획 자격",
    "직무를 독립 수행할 수 있는지 검증",
    root,
  );
  await f.call(
    "operator-1",
    scope(`/qualifications/${q.id}`, root),
    {
      revision: 1,
      title: "개인 계획 자격",
      description: "직무를 독립 수행할 수 있는지 검증",
      validity: period,
      courseIds: [c.id],
    },
    undefined,
    "PUT",
  );
  return { c: c.id as string, q: q.id as string };
}
async function invitation(
  f: Fixture,
  learner = "learner-2",
  ftId: string | null = null,
  root = "org-photo",
) {
  await configureTestPolicies(f.store, root);
  return (
    await f.call("operator-1", scope("/planning-requests", root), {
      learnerIds: [learner],
      dueOn: "2026-10-31",
      message: "자격별 계획을 작성하세요.",
    })
  ).ids[0] as string;
}
async function plan(
  f: Fixture,
  q: string,
  learner = "learner-2",
  ft: string | null = null,
  root = "org-photo",
) {
  const request = await invitation(f, learner, ft, root);
  const p = await f.call(learner, "/plans", {
    requestRevision: f.store
      .snapshot()
      .planningRequests.find((r) => r.id === request)!.revision,
    requestId: request,
    qualificationId: q,
  });
  const value = f.store.snapshot().plans.find((v) => v.id === p.id)!;
  const fields = {
    revision: 1,
    targetOn: "2026-12-01",
    schedules: value.schedules.map((s) => ({
      ...s,
      learningStart: "2026-10-01",
      learningEnd: "2026-10-15",
      assessmentOn: "2026-11-01",
      goal: "원인을 설명하고 독립 수행",
    })),
  };
  await f.call(learner, `/plans/${p.id}`, fields, 200, "PUT");
  const key = randomUUID();
  const completed = await f.call(
    learner,
    `/plans/${p.id}/complete`,
    { revision: 2 },
    200,
    "POST",
    key,
  );
  assert.deepEqual(
    await f.call(
      learner,
      `/plans/${p.id}/complete`,
      { revision: 2 },
      200,
      "POST",
      key,
    ),
    completed,
  );
  const a = f.store
    .snapshot()
    .assignments.find((a) => a.id === completed.assignmentId)!;
  const e = f.store
    .snapshot()
    .enrollments.find((e) => e.assignmentId === a.id)!;
  return { a, e, p: p.id as string, request };
}
async function learning(f: Fixture, enrollment: string, learner = "learner-2") {
  await f.call(
    learner,
    `/enrollments/${enrollment}/learning`,
    {
      itemId: "learn-1",
      performedOn: "2026-10-19",
      content: "deprecated",
      evidenceUrl: "",
      revision: 0,
    },
    410,
    "PUT",
  );
  return f.store.transact(
    learner,
    randomUUID(),
    "historical-fixture",
    () => {},
    (state) => {
      const record = {
        id: randomUUID(),
        enrollmentId: enrollment,
        itemId: "learn-1",
        learnerId: learner,
        performedOn: "2026-10-19",
        content: "이관된 과거 학습 기록",
        evidenceUrl: "",
        revision: 1,
        createdAt: "2026-10-19T01:00:00Z",
        updatedAt: "2026-10-19T01:00:00Z",
      };
      state.learningRecords.push(record);
      return record;
    },
  );
}
async function attempt(
  f: Fixture,
  enrollment: string,
  kind: Kind,
  learner = "learner-2",
) {
  return f.call(
    learner,
    `/enrollments/${encodeURIComponent(enrollment)}/attempts`,
    { kind },
  );
}
async function finish(
  f: Fixture,
  enrollment: string,
  kind: "objective" | "practical",
  learner = "learner-2",
  ft = "ft-1",
) {
  const t = await attempt(f, enrollment, kind, learner);
  const course = f.store
    .snapshot()
    .courses.find(
      (c) =>
        c.id ===
        f.store.snapshot().enrollments.find((e) => e.id === enrollment)!
          .courseId,
    )!;
  const actor = learner;
  await f.call(
    actor,
    `/attempts/${t.id}/draft`,
    {
      revision: t.revision,
      answers: Object.fromEntries(
        (kind === "objective"
          ? course.questions
          : course.practicalQuestions
        ).map((q) => [q.id, q.correct]),
      ),
    },
    200,
    "PUT",
  );
  await f.call(actor, `/attempts/${t.id}/submit`, { revision: t.revision + 1 });
  return t.id as string;
}
test("15종 선택 가져오기·조직별 독립·중복·미정 기준 공개 차단·추가 자격", async (t) => {
  const f = await fixture(t);
  const incompleteCourse = await f.call("admin-1", "/courses", {});
  const noLearning = await f.call(
    "admin-1",
    `/courses/${incompleteCourse.id}`,
    { ...f.store.snapshot().courses[0], revision: 1, learningItems: [] },
    200,
    "PUT",
  );
  assert.ok(
    noLearning.readiness.some((m: string) => m.includes("필수 학습 항목")),
  );
  const templates = await f.call(
    "operator-1",
    scope("/qualification-templates"),
  );
  assert.equal(templates.length, 17);
  assert.equal(templates[4].englishName, "FDC Diagnois Cert");
  const ids = templates
      .filter((q: any) => !q.id.startsWith("fixture-"))
      .map((q: any) => q.id),
    key = randomUUID();
  await f.call("learner-1", "/qualification-templates", undefined, 403);
  await f.call(
    "operator-1",
    "/qualification-templates/import",
    { templateIds: ids },
    403,
  );
  const imported = await f.call(
    "operator-1",
    scope("/qualification-templates/import"),
    { templateIds: ids },
    200,
    "POST",
    key,
  );
  assert.equal(imported.imported.length, 15);
  assert.deepEqual(
    await f.call(
      "operator-1",
      scope("/qualification-templates/import"),
      { templateIds: ids },
      200,
      "POST",
      key,
    ),
    imported,
  );
  await f.call(
    "operator-1",
    scope("/qualification-templates/import", "org-etch"),
    { templateIds: ids },
    409,
    "POST",
    key,
  );
  const repeated = await f.call("admin-1", "/qualification-templates/import", {
    templateIds: ids,
  });
  assert.equal(repeated.imported.length, 0);
  assert.equal(repeated.existing.length, 15);
  assert.ok(
    (await f.call("learner-2", "/workspace")).qualifications.every(
      (q: any) => !q.templateId,
    ),
  );
  const q = f.store
    .snapshot()
    .qualifications.find((q) => q.id === imported.imported[0])!;
  await f.call("admin-1", `/qualifications/${q.id}`, q, 200, "PUT");
  const etch = await f.call(
    "operator-1",
    scope("/qualification-templates/import", "org-etch"),
    { templateIds: [ids[0]] },
  );
  await f.call(
    "admin-1",
    `/qualifications/${q.id}`,
    { ...q, title: "Photo 독립 기준", templateId: "위조" },
    422,
    "PUT",
  );
  assert.equal(
    f.store.snapshot().qualifications.find((x) => x.id === q.id)!.templateId,
    ids[0],
  );
  assert.equal(
    f.store.snapshot().qualifications.find((x) => x.id === etch.imported[0])!
      .title,
    templates[0].title,
  );
  assert.equal(
    (
      await f.call("operator-1", scope("/qualification-templates", "org-fab"))
    ).filter((q: any) => q.imported).length,
    0,
  );
  const { q: custom } = await catalog(f);
  assert.ok(
    !(await f.call("learner-2", "/workspace")).qualifications.some(
      (q: any) => q.id === custom,
    ),
  );
  await configureTestPolicies(f.store);
  assert.ok(
    (await f.call("learner-2", "/workspace")).qualifications.some(
      (q: any) => q.id === custom,
    ),
  );
});

test("계획 원자성·자동 결재 생략·일정 목표 수정·동시 변경·본인과 Lv1 경계", async (t) => {
  const f = await fixture(t),
    { q } = await catalog(f);
  const r = await invitation(f);
  await f.call(
    "learner-1",
    "/plans",
    {
      requestRevision: f.store
        .snapshot()
        .planningRequests.find((request) => request.id === r)!.revision,
      requestId: r,
      qualificationId: q,
    },
    403,
  );
  await f.call(
    "admin-1",
    "/assignments",
    { learnerId: "learner-2", qualificationId: q },
    409,
  );
  const { q: etch } = await catalog(f, "org-etch");
  await f.call(
    "learner-2",
    "/plans",
    {
      requestRevision: f.store
        .snapshot()
        .planningRequests.find((request) => request.id === r)!.revision,
      requestId: r,
      qualificationId: etch,
    },
    422,
  );
  await f.call(
    "operator-1",
    scope("/planning-requests"),
    {
      learnerIds: ["learner-2"],
      ftId: "etch-ft",
      dueOn: "2026-11-01",
      message: "",
    },
    422,
  );
  await f.call(
    "operator-1",
    scope("/planning-requests"),
    { learnerIds: ["dual"], ftId: "dual", dueOn: "2026-11-01", message: "" },
    422,
  );
  const p = await f.call("learner-2", "/plans", {
    requestRevision: f.store
      .snapshot()
      .planningRequests.find((request) => request.id === r)!.revision,
    requestId: r,
    qualificationId: q,
  });
  await f.call("learner-2", `/plans/${p.id}/complete`, { revision: 1 }, 422);
  const value = f.store.snapshot().plans.find((p2) => p2.id === p.id)!;
  const body = {
    revision: 1,
    targetOn: "2026-12-01",
    schedules: value.schedules.map((s) => ({
      ...s,
      goal: "독립 수행",
      learningStart: "2026-10-15",
      learningEnd: "2026-10-01",
      assessmentOn: "2026-11-01",
    })),
  };
  await f.call("learner-2", `/plans/${p.id}`, body, 200, "PUT");
  await f.call("learner-2", `/plans/${p.id}/complete`, { revision: 2 }, 422);
  await f.call("learner-2", `/plans/${p.id}`, body, 409, "PUT");
  body.revision = 2;
  body.schedules[0]!.learningStart = "2026-10-01";
  await f.call("learner-2", `/plans/${p.id}`, body, 200, "PUT");
  const before = f.store.snapshot();
  f.store.beforeReplace = () => {
    throw new Error("시험용 저장 실패");
  };
  await f.call("learner-2", `/plans/${p.id}/complete`, { revision: 3 }, 503);
  assert.deepEqual(f.store.snapshot(), before);
  f.store.beforeReplace = undefined;
  const key = randomUUID(),
    complete = { revision: 3 };
  const results = await Promise.all([
    f.call("learner-2", `/plans/${p.id}/complete`, complete, 200, "POST", key),
    f.call("learner-2", `/plans/${p.id}/complete`, complete, 200, "POST", key),
  ]);
  assert.deepEqual(results[0], results[1]);
  const done = f.store.snapshot().plans.find((x) => x.id === p.id)!;
  assert.equal(done.approval, "skipped_by_policy");
  assert.equal(done.workflowVersion, "personal-certification-v5");
  assert.equal(
    f.store.snapshot().assignments.filter((a) => a.planId === p.id).length,
    1,
  );
  const fixed = f.store
    .snapshot()
    .assignments.find((a) => a.id === done.assignmentId)!;
  assert.equal(fixed.createdBy, "learner-2");
  assert.equal(fixed.ownerAdminId, "operator-1");
  assert.ok(!("ftId" in fixed));
  await f.call(
    "learner-2",
    `/plans/${p.id}`,
    { ...body, revision: 4 },
    422,
    "PUT",
  );
  await f.call(
    "learner-2",
    `/plans/${p.id}`,
    { ...body, targetOn: "2026-12-31", revision: 4, reason: "일정 조정" },
    200,
    "PUT",
  );
  assert.deepEqual(
    f.store.snapshot().assignments.find((a) => a.id === fixed.id),
    fixed,
  );
  const record = f.store.snapshot().plans.find((x) => x.id === p.id)!;
  assert.equal(record.targetOn, "2026-12-31");
  await f.restart();
  assert.deepEqual(
    f.store.snapshot().plans.find((x) => x.id === p.id),
    record,
  );
});

test("계획 완료 직전 운영 종료 차단, 기존 미시작 계획 배정은 학습·평가 가능", async (t) => {
  const f = await fixture(t),
    { q, c } = await catalog(f, "org-photo", ["objective"]);
  const active = await plan(f, q);
  const requestId = await invitation(f, "dual");
  const draft = await f.call("dual", "/plans", {
    requestRevision: f.store
      .snapshot()
      .planningRequests.find((r) => r.id === requestId)!.revision,
    requestId,
    qualificationId: q,
  });
  const value = f.store.snapshot().plans.find((p) => p.id === draft.id)!;
  await f.call(
    "dual",
    `/plans/${draft.id}`,
    {
      revision: 1,
      targetOn: "2026-12-01",
      schedules: value.schedules.map((s) => ({
        ...s,
        learningStart: "2026-10-01",
        learningEnd: "2026-10-15",
        assessmentOn: "2026-11-01",
        goal: "학습",
      })),
    },
    200,
    "PUT",
  );
  await f.call("admin-1", `/courses/${c}/retirement`, {
    ...(await f.call("admin-1", `/courses/${c}/usage`)),
    reason: "신규 운영 종료",
  });
  const error = await f.call(
    "dual",
    `/plans/${draft.id}/complete`,
    { revision: 2 },
    409,
  );
  assert.match(error.message, /운영 종료/);
  await learning(f, active.e.id);
  await finish(f, active.e.id, "objective");
  assert.ok(
    f.store
      .snapshot()
      .certifications.some((c) => c.assignmentId === active.a.id),
  );
});

test("선택 조직 초기화는 계획·학습 일정·역할·기준을 보존하고 진행만 삭제", async (t) => {
  const f = await fixture(t),
    photo = await catalog(f, "org-photo", ["objective"]),
    etch = await catalog(f, "org-etch", ["objective"]);
  const a = await plan(f, photo.q),
    b = await plan(f, etch.q, "etch-learner", null, "org-etch");
  await learning(f, a.e.id);
  await finish(f, a.e.id, "objective");
  await learning(f, b.e.id, "etch-learner");
  await finish(f, b.e.id, "objective", "etch-learner");
  const old = f.store.snapshot(),
    master = await readFile(f.store.organizations.file, "utf8");
  const preview = await f.call(
    "operator-1",
    "/testing/progress?scope=organization&lv1OrganizationId=org-photo",
  );
  assert.equal(preview.counts.learningRecords, 1);
  assert.ok(preview.counts.notifications > 0);
  const key = randomUUID(),
    payload = {
      revision: preview.revision,
      scope: preview.scope,
      confirmation: "초기화",
    };
  const reset = await f.call(
    "operator-1",
    "/testing/progress/reset",
    payload,
    200,
    "POST",
    key,
  );
  const after = f.store.snapshot();
  for (const field of [
    "plans",
    "planningRequests",
    "assignments",
    "courses",
    "qualifications",
    "users",
  ] as const)
    assert.deepEqual(after[field], old[field]);
  assert.deepEqual(
    after.learningRecords,
    old.learningRecords.filter((r) => r.enrollmentId === b.e.id),
  );
  assert.deepEqual(
    after.certifications,
    old.certifications.filter((r) => r.assignmentId === b.a.id),
  );
  assert.deepEqual(
    after.requests.filter((r) => r.lv1OrganizationId === "org-etch"),
    old.requests.filter((r) => r.lv1OrganizationId === "org-etch"),
  );
  assert.ok(
    after.notifications.some(
      (n) => n.type === "planning" && n.recipientId === "learner-2",
    ),
  );
  assert.equal(await readFile(f.store.organizations.file, "utf8"), master);
  const previousLearning = old.learningRecords.find(
    (r) => r.enrollmentId === a.e.id,
  )!;
  await f.call(
    "learner-2",
    `/enrollments/${a.e.id}/learning`,
    { ...previousLearning, reason: "오래된 탭" },
    410,
    "PUT",
  );
  await learning(f, a.e.id);
  assert.deepEqual(
    await f.call(
      "operator-1",
      "/testing/progress/reset",
      payload,
      200,
      "POST",
      key,
    ),
    reset,
  );
  assert.ok(
    f.store.snapshot().learningRecords.some((r) => r.enrollmentId === a.e.id),
  );
  await f.restart();
  assert.equal(await readFile(f.store.organizations.file, "utf8"), master);
});

test("개월·월말·윤년·KST 만료일 경계와 무기한·기존 미설정의 구분", () => {
  assert.equal(
    expirationDate("2024-01-31T00:00:00.000Z", period),
    "2024-02-29",
  );
  assert.equal(
    expirationDate("2025-01-31T00:00:00.000Z", period),
    "2025-02-28",
  );
  assert.equal(
    expirationDate("2024-02-29T14:00:00.000Z", { ...period, months: 12 }),
    "2025-02-28",
  );
  assert.equal(
    expirationDate("2025-01-30T15:00:00.000Z", period),
    "2025-02-28",
  );
  const c = { validity: period, expiresOn: "2025-02-28" };
  assert.equal(certificationStatus(c, "2025-02-28T14:59:59.999Z"), "expiring");
  assert.equal(certificationStatus(c, "2025-02-28T15:00:00.000Z"), "expired");
  assert.equal(
    certificationStatus(
      { validity: { type: "unlimited", months: null, reminderDays: [] } },
      "2099-01-01T00:00:00Z",
    ),
    "valid",
  );
  assert.equal(certificationStatus({}), "unknown");
});

test("알림 시작 시 누락 보충·최신 시점만 생성·중복 방지·실패 재시도·읽음과 업무 분리", async (t) => {
  const f = await fixture(t),
    { q } = await catalog(f, "org-photo", ["objective"]),
    { e, a } = await plan(f, q);
  await learning(f, e.id);
  await finish(f, e.id, "objective");
  const cert = f.store
    .snapshot()
    .certifications.find((c) => c.assignmentId === a.id)!;
  const dateAt = (days: number) =>
    new Date(Date.parse(cert.expiresOn!) - days * 86400000).toISOString();
  const before = f.store.snapshot();
  f.store.beforeReplace = () => {
    throw new Error("알림 저장 실패");
  };
  await assert.rejects(
    f.store.refreshNotifications(dateAt(6)),
    /알림 저장 실패/,
  );
  assert.deepEqual(f.store.snapshot(), before);
  f.store.beforeReplace = undefined;
  await f.restart(dateAt(6));
  let reminders = f.store
    .snapshot()
    .notifications.filter(
      (n) => n.certificationId === cert.id && n.type === "renewal",
    );
  assert.equal(reminders.length, 1);
  assert.match(reminders[0]!.key, /^renewal:notice:/);
  const revision = f.store.snapshot().revision;
  await f.store.refreshNotifications(dateAt(5));
  assert.equal(f.store.snapshot().revision, revision);
  await f.call("learner-2", `/notifications/${reminders[0]!.id}/read`, {});
  await f.call("learner-1", `/notifications/${reminders[0]!.id}/read`, {}, 403);
  await f.restart(dateAt(-1));
  await f.store.refreshNotifications(dateAt(-2));
  assert.equal(
    f.store
      .snapshot()
      .notifications.filter(
        (n) => n.type === "expired" && n.certificationId === cert.id,
      ).length,
    1,
  );
  assert.deepEqual(
    f.store.snapshot().certifications.find((c) => c.id === cert.id)?.evidence,
    cert.evidence,
  );
  assert.equal(
    f.store.snapshot().certifications.find((c) => c.id === cert.id)
      ?.lifecycleStatus,
    "Revoke",
  );
  assert.ok(
    (await f.call("learner-1", "/notifications")).every(
      (n: any) => n.recipientId === "learner-1",
    ),
  );
});

test("추가 계획 요청은 새 기한·안내를 보존하고 같은 요청 재시도만 중복 방지", async (t) => {
  const f = await fixture(t),
    { q } = await catalog(f),
    first = await plan(f, q);
  const before = f.store.snapshot(),
    key = randomUUID();
  const body = {
    learnerIds: ["learner-2"],
    dueOn: "2027-01-31",
    message: "추가 직무 자격을 계획하세요.",
  };
  const second = await f.call(
    "admin-1",
    "/planning-requests",
    body,
    200,
    "POST",
    key,
  );
  assert.notEqual(second.ids[0], first.request);
  assert.deepEqual(
    await f.call("admin-1", "/planning-requests", body, 200, "POST", key),
    second,
  );
  const after = f.store.snapshot();
  assert.equal(after.planningRequests.length, 2);
  assert.deepEqual(after.planningRequests[0], before.planningRequests[0]);
  assert.deepEqual(after.plans, before.plans);
  assert.deepEqual(after.assignments, before.assignments);
  assert.equal(
    after.notifications.filter((n) => n.type === "planning").length,
    2,
  );
  await f.call(
    "admin-1",
    "/planning-requests",
    { ...body, dueOn: "2027-02-01" },
    409,
    "POST",
    key,
  );
  await f.call(
    "admin-1",
    "/planning-requests",
    { ...body, learnerIds: ["etch-learner"] },
    422,
  );
  const etch = await catalog(f, "org-etch");
  const etchDraft = await f.call(
    "operator-1",
    scope(`/qualifications/${etch.q}/versions`, "org-etch"),
    {},
  );
  await f.call(
    "operator-1",
    scope(`/qualifications/${etchDraft.id}`, "org-etch"),
    {
      ...f.store.snapshot().qualifications.find((q) => q.id === etchDraft.id)!,
      validity: { type: "months", months: 6, reminderDays: [90] },
    },
    undefined,
    "PUT",
  );
  assert.deepEqual(
    f.store.snapshot().qualifications.find((x) => x.id === q)!.validity,
    period,
  );
  assert.equal(
    f.store.snapshot().qualifications.find((x) => x.id === etchDraft.id)!
      .validity.months,
    6,
  );
});
