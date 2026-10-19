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
      roles: ["ft"],
      organizationId: "org-etch",
      revision: 1,
    },
    {
      id: "dual",
      name: "겸직자",
      roles: ["learner", "ft"],
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
      s.users.find((u) => u.id === "learner-2")!.roles = ["ft"];
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
  kinds: Kind[] = ["objective", "subjective", "practical"],
) {
  const c = await f.call("operator-1", scope("/courses", root), {});
  await f.call("operator-1", scope(`/courses/${c.id}/publish`, root), {
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
    subjectiveQuestions: [
      {
        id: "essay-1",
        prompt: "문제 원인과 조치를 설명하세요.",
        points: 10,
        rubric: "내부 채점 기준",
        modelAnswer: "비공개 모범답안",
      },
    ],
    subjectivePassScore: 60,
  });
  const q = await f.call("operator-1", scope("/qualifications", root), {});
  await f.call("operator-1", scope(`/qualifications/${q.id}/publish`, root), {
    revision: 1,
    title: "개인 계획 자격",
    description: "직무를 독립 수행할 수 있는지 검증",
    validity: period,
    courseIds: [c.id],
  });
  return { c: c.id as string, q: q.id as string };
}
async function invitation(
  f: Fixture,
  learner = "learner-2",
  ftId: string | null = null,
  root = "org-photo",
) {
  return (
    await f.call("operator-1", scope("/planning-requests", root), {
      learnerIds: [learner],
      ftId,
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
  return f.call(
    learner,
    `/enrollments/${enrollment}/learning`,
    {
      itemId: "learn-1",
      performedOn: kstDate(),
      content: "독립 수행 학습 완료",
      evidenceUrl: "",
      revision: 0,
    },
    200,
    "PUT",
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
  const actor = kind === "objective" ? learner : ft;
  await f.call(
    actor,
    `/attempts/${t.id}/draft`,
    {
      revision: t.revision,
      answers:
        kind === "objective"
          ? Object.fromEntries(course.questions.map((q) => [q.id, q.correct]))
          : {},
      verdicts:
        kind === "practical"
          ? Object.fromEntries(
              course.practicalItems.map((i) => [
                i.id,
                { value: "pass", evidence: "독립 수행 관찰" },
              ]),
            )
          : {},
    },
    200,
    "PUT",
  );
  await f.call(actor, `/attempts/${t.id}/submit`, { revision: t.revision + 1 });
  return t.id as string;
}
async function submitEssay(
  f: Fixture,
  enrollment: string,
  learner = "learner-2",
) {
  const t = await attempt(f, enrollment, "subjective", learner);
  await f.call(
    learner,
    `/attempts/${t.id}/draft`,
    {
      revision: t.revision,
      answers: {},
      verdicts: {},
      subjectiveAnswers: { "essay-1": "원인 확인 후 조치합니다." },
    },
    200,
    "PUT",
  );
  const submitted = await f.call(learner, `/attempts/${t.id}/submit`, {
    revision: t.revision + 1,
  });
  return submitted as { id: string; revision: number };
}

test("15종 선택 가져오기·조직별 독립·중복·미정 기준 공개 차단·추가 자격", async (t) => {
  const f = await fixture(t);
  const incompleteCourse = await f.call("admin-1", "/courses", {});
  const noLearning = await f.call(
    "admin-1",
    `/courses/${incompleteCourse.id}/publish`,
    { ...f.store.snapshot().courses[0], revision: 1, learningItems: [] },
    422,
  );
  assert.match(noLearning.message, /필수 학습 항목/);
  const templates = await f.call(
    "operator-1",
    scope("/qualification-templates"),
  );
  assert.equal(templates.length, 15);
  assert.equal(templates[4].englishName, "FDC Diagnois Cert");
  const ids = templates.map((q: any) => q.id),
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
  await f.call("admin-1", `/qualifications/${q.id}/publish`, q, 422);
  const etch = await f.call(
    "operator-1",
    scope("/qualification-templates/import", "org-etch"),
    { templateIds: [ids[0]] },
  );
  await f.call(
    "admin-1",
    `/qualifications/${q.id}`,
    { ...q, title: "Photo 독립 기준", templateId: "위조" },
    200,
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
    { requestId: r, qualificationId: q },
    403,
  );
  await f.call(
    "admin-1",
    "/assignments",
    { learnerId: "learner-2", qualificationId: q, ftId: null },
    409,
  );
  const { q: etch } = await catalog(f, "org-etch");
  await f.call(
    "learner-2",
    "/plans",
    { requestId: r, qualificationId: etch },
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
  assert.equal(done.workflowVersion, "personal-certification-v1");
  assert.equal(
    f.store.snapshot().assignments.filter((a) => a.planId === p.id).length,
    1,
  );
  const fixed = f.store
    .snapshot()
    .assignments.find((a) => a.id === done.assignmentId)!;
  assert.equal(fixed.createdBy, "learner-2");
  assert.equal(fixed.ownerAdminId, "operator-1");
  assert.equal(fixed.ftId, null);
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

test("FT 없이 학습·객관식→주관식 제출·독립 재응시·FT 교체·수료 인증·근거 보존", async (t) => {
  const f = await fixture(t),
    { c, q } = await catalog(f),
    { a, e, p } = await plan(f, q);
  for (const kind of ["objective", "subjective", "practical"])
    await f.call("learner-2", `/enrollments/${e.id}/attempts`, { kind }, 409);
  await f.call(
    "learner-1",
    `/enrollments/${e.id}/learning`,
    { itemId: "learn-1" },
    403,
    "PUT",
  );
  await learning(f, e.id);
  const objective = await finish(f, e.id, "objective");
  const essay = await attempt(f, e.id, "subjective");
  await f.call(
    "learner-2",
    `/attempts/${essay.id}/draft`,
    {
      revision: 1,
      answers: {},
      verdicts: {},
      subjectiveAnswers: { "essay-1": "학습한 원인과 조치" },
    },
    200,
    "PUT",
  );
  await f.call(
    "learner-2",
    `/attempts/${essay.id}/submit`,
    { revision: 2 },
    409,
  );
  await f.call(
    "learner-2",
    `/enrollments/${e.id}/attempts`,
    { kind: "practical" },
    409,
  );
  const learnerView = await f.call("learner-2", "/workspace");
  assert.equal(
    learnerView.courses.find((x: any) => x.id === c).subjectiveQuestions[0]
      .rubric,
    undefined,
  );
  assert.equal(
    learnerView.courses.find((x: any) => x.id === c).subjectiveQuestions[0]
      .modelAnswer,
    undefined,
  );
  await f.call("admin-1", `/assignments/${a.id}/ft`, {
    revision: 1,
    ftId: "ft-1",
    reason: "FT 지정",
  });
  const essayRevision = f.store
    .snapshot()
    .attempts.find((t) => t.id === essay.id)!.revision;
  assert.equal(
    essayRevision,
    2,
    "FT assignment must not modify the learner-owned answer draft",
  );
  const submitted = await f.call("learner-2", `/attempts/${essay.id}/submit`, {
    revision: essayRevision,
  });
  await f.call(
    "learner-2",
    `/attempts/${essay.id}/draft`,
    {
      revision: submitted.revision,
      answers: {},
      verdicts: {},
      subjectiveAnswers: { "essay-1": "변경" },
    },
    409,
    "PUT",
  );
  for (const actor of ["operator-1", "admin-1", "ft-2", "learner-2"])
    await f.call(
      actor,
      `/attempts/${essay.id}/grading/finalize`,
      { revision: submitted.revision },
      403,
    );
  await f.call(
    "ft-1",
    `/attempts/${essay.id}/grading/finalize`,
    {
      revision: submitted.revision,
      grades: { "essay-1": { points: 11, reason: "초과" } },
      feedback: "",
    },
    422,
  );
  await f.call(
    "ft-1",
    `/attempts/${essay.id}/grading/finalize`,
    {
      revision: submitted.revision,
      grades: { "essay-1": { points: 5, reason: "원인 누락" } },
      feedback: "",
    },
    422,
  );
  await f.call("ft-1", `/attempts/${essay.id}/grading/finalize`, {
    revision: submitted.revision,
    grades: { "essay-1": { points: 5, reason: "내부 미통과 이유" } },
    feedback: "원인 설명을 보완하세요.",
  });
  const publicResult = await f.call("learner-2", `/attempts/${essay.id}`);
  assert.deepEqual(publicResult.grades, {});
  assert.equal(publicResult.feedback, "원인 설명을 보완하세요.");
  await finish(f, e.id, "practical");
  assert.ok(
    !f.store.snapshot().completions.some((x) => x.enrollmentId === e.id),
  );
  const next = await submitEssay(f, e.id);
  await f.call(
    "ft-1",
    `/attempts/${next.id}/grading`,
    {
      revision: next.revision,
      grades: { "essay-1": { points: 8, reason: "이전 FT의 미확정 근거" } },
      feedback: "이전 초안",
    },
    200,
    "PUT",
  );
  await f.call("admin-1", `/assignments/${a.id}/ft`, {
    revision: 2,
    ftId: "ft-2",
    reason: "담당자 변경",
  });
  await f.call(
    "ft-1",
    `/attempts/${next.id}/grading/finalize`,
    { revision: next.revision + 1 },
    403,
  );
  const fresh = await f.call("ft-2", `/attempts/${next.id}`);
  assert.deepEqual(fresh.grades, {});
  assert.equal(fresh.feedback, "");
  assert.equal(fresh.subjectiveAnswers["essay-1"], "원인 확인 후 조치합니다.");
  assert.ok(
    JSON.stringify(f.store.snapshot().audits).includes("이전 FT의 미확정 근거"),
  );
  await f.call(
    "operator-1",
    "/system/users/learner-2",
    {
      revision: 1,
      name: "정하린 수정",
      roles: ["learner"],
      organizationId: "org-photo-pyeongtaek-1",
    },
    200,
    "PATCH",
  );
  const body = {
      revision: fresh.revision,
      grades: { "essay-1": { points: 6, reason: "필수 요소 충족" } },
      feedback: "통과했습니다.",
    },
    key = randomUUID();
  const results = await Promise.all([
    f.call(
      "ft-2",
      `/attempts/${next.id}/grading/finalize`,
      body,
      200,
      "POST",
      key,
    ),
    f.call(
      "ft-2",
      `/attempts/${next.id}/grading/finalize`,
      body,
      200,
      "POST",
      key,
    ),
  ]);
  assert.deepEqual(results[0], results[1]);
  const s = f.store.snapshot(),
    co = s.completions.find((x) => x.enrollmentId === e.id)!,
    cert = s.certifications.find((x) => x.assignmentId === a.id)!;
  assert.equal(co.evidence.length, 3);
  assert.ok(co.evidence.some((x) => x.attemptId === objective));
  assert.equal(
    s.attempts.filter((x) => x.enrollmentId === e.id && x.kind === "subjective")
      .length,
    2,
  );
  assert.equal(cert.snapshot!.learnerName, "정하린 수정");
  assert.equal(
    cert.snapshot!.organizationPath.at(-1)!.id,
    "org-photo-pyeongtaek-1",
  );
  assert.deepEqual(cert.validity, period);
  assert.equal(cert.expiresOn, expirationDate(cert.date, period));
  assert.equal(
    s.notifications.filter(
      (n) => n.type === "certification" && n.assignmentId === a.id,
    ).length,
    1,
  );
  assert.equal(
    (await f.call("learner-2", `/completions/${co.id}`)).completion.id,
    co.id,
  );
  await f.call("learner-1", `/completions/${co.id}`, undefined, 404);
  const notification = s.notifications.find(
    (n) => n.certificationId === cert.id,
  )!;
  await f.call("learner-2", `/notifications/${notification.id}/read`, {});
  assert.deepEqual(
    f.store.snapshot().certifications.find((x) => x.id === cert.id),
    cert,
  );
  // Process/learning data do not modify the comparison's independent task evidence.
  const comparison = await f.call(
    "admin-1",
    `/enrollments/${e.id}/comparisons`,
    {},
  );
  await f.call("admin-1", `/comparisons/${comparison.id}/finalize`, {
    revision: 1,
    attemptIds: co.evidence.map((ev) => ev.attemptId),
    observedAt: "2026-10-19",
    observer: "현장 관찰자",
    task: "작업",
    criterion: "독립 수행",
    evidence: "별도 관찰",
    evidenceUrl: "",
    independence: "independent",
    performance: "met",
  });
  const usage = await f.call("admin-1", `/courses/${c}/usage`);
  await f.call("admin-1", `/courses/${c}/retirement`, {
    ...usage,
    reason: "신규 운영 종료",
  });
  const clone = await f.call("admin-1", `/qualifications/${q}/versions`, {});
  const copy = f.store
    .snapshot()
    .qualifications.find((x) => x.id === clone.id)!;
  await f.call(
    "admin-1",
    `/qualifications/${clone.id}`,
    {
      ...copy,
      validity: { type: "unlimited", months: null, reminderDays: [] },
    },
    200,
    "PUT",
  );
  await f.restart();
  assert.deepEqual(
    f.store.snapshot().certifications.find((x) => x.id === cert.id),
    cert,
  );
  assert.deepEqual(
    f.store.snapshot().completions.find((x) => x.id === co.id),
    co,
  );
  assert.equal(
    f.store.snapshot().plans.find((x) => x.id === p)!.status,
    "completed",
  );
  assert.equal(
    (await f.call("learner-2", "/workspace")).assignments.find(
      (x: any) => x.id === a.id,
    ).enrollments[0].subjective,
    "passed",
  );
});

test("계획 완료 직전 운영 종료 차단, 기존 미시작 계획 배정은 학습·평가 가능", async (t) => {
  const f = await fixture(t),
    { q, c } = await catalog(f, "org-photo", ["objective"]);
  const active = await plan(f, q);
  const requestId = await invitation(f, "dual");
  const draft = await f.call("dual", "/plans", {
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
    422,
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
    409,
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
      (n) => n.certificationId === cert.id && n.type === "expiry",
    );
  assert.equal(reminders.length, 1);
  assert.match(reminders[0]!.key, /7/);
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
    f.store.snapshot().certifications.find((c) => c.id === cert.id),
    cert,
  );
  assert.ok(
    (await f.call("learner-1", "/notifications")).every(
      (n: any) => n.recipientId === "learner-1",
    ),
  );
});

test("스키마3 명시적 이관은 기존 ID·점수·시각·종료 정책·조직을 보존하고 반복 안전", async (t) => {
  const f = await fixture(t);
  const source: any = f.store.snapshot();
  source.schemaVersion = 3;
  for (const c of source.courses) {
    c.mode = c.assessmentKinds.length === 2 ? "both" : c.assessmentKinds[0];
    delete c.assessmentKinds;
    delete c.learningItems;
    delete c.subjectiveQuestions;
    delete c.subjectivePassScore;
  }
  for (const q of source.qualifications) {
    delete q.englishName;
    delete q.description;
    delete q.validity;
  }
  for (const a of source.attempts) {
    if (a.status === "graded") a.status = "submitted";
    delete a.submittedAt;
  }
  delete source.plans;
  delete source.planningRequests;
  delete source.learningRecords;
  delete source.notifications;
  source.courses[0].operationalStatus = "retired";
  source.courses[0].retiredAt = "2026-10-18T00:00:00.000Z";
  source.courses[0].retiredBy = "admin-1";
  source.courses[0].retirementReason = "운영 종료";
  const master = f.store.organizations.snapshot();
  const migrated = migrateState(source, master);
  assert.equal(migrated.schemaVersion, 5);
  assert.equal(migrated.courses[0]!.operationalStatus, "retired");
  for (const [i, a] of migrated.attempts.entries()) {
    const { status, submittedAt, ...preserved } = a;
    const { status: oldStatus, ...previous } = source.attempts[i];
    assert.deepEqual(preserved, previous);
    assert.equal(status, "graded");
    assert.equal(submittedAt, a.date);
  }
  assert.ok(
    migrated.qualifications.every((q) => q.validity.type === "unknown"),
  );
  assert.deepEqual(migrateState(migrated, master), migrated);
  assert.deepEqual(f.store.organizations.snapshot(), master);
  // Normal startup must reject schema3 and must not rewrite the input.
  const other = path.join(f.dir, "legacy", "state.json"),
    org = path.join(f.dir, "legacy-master.json");
  await writeFile(org, JSON.stringify(master));
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.dirname(other));
  await writeFile(other, JSON.stringify(source));
  await assert.rejects(new JsonStore(other, org).load());
  assert.equal(await readFile(other, "utf8"), JSON.stringify(source));
  await new JsonStore(other, org).migrate(migrateState);
  const bytes = await readFile(other, "utf8");
  await new JsonStore(other, org).migrate(migrateState);
  assert.equal(await readFile(other, "utf8"), bytes);
  assert.equal(
    (await readdir(new JsonStore(other, org).backupDir)).filter((name) =>
      name.startsWith("before-migration-"),
    ).length,
    1,
  );
  const restored: State = JSON.parse(bytes);
  validateState(restored, master);
});

test("추가 계획 요청은 새 기한·안내를 보존하고 같은 요청 재시도만 중복 방지", async (t) => {
  const f = await fixture(t),
    { q } = await catalog(f),
    first = await plan(f, q);
  const before = f.store.snapshot(),
    key = randomUUID();
  const body = {
    learnerIds: ["learner-2"],
    ftId: "ft-1",
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
    scope(`/qualifications/${etchDraft.id}/publish`, "org-etch"),
    {
      ...f.store.snapshot().qualifications.find((q) => q.id === etchDraft.id)!,
      validity: { type: "months", months: 6, reminderDays: [90] },
    },
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

test("한 과정 채점 대기 중 다른 과정 수료와 마지막 유형 동시 확정은 단일 인증 생성", async (t) => {
  const f = await fixture(t),
    first = await catalog(f),
    second = await catalog(f);
  const qualification = await f.call("admin-1", "/qualifications", {});
  await f.call("admin-1", `/qualifications/${qualification.id}/publish`, {
    revision: 1,
    title: "독립 진행 검증",
    description: "과정별 진행 확인",
    validity: period,
    courseIds: [first.c, second.c],
  });
  const { a, e } = await plan(f, qualification.id, "learner-2", "ft-1");
  const other = f.store
    .snapshot()
    .enrollments.find((x) => x.assignmentId === a.id && x.id !== e.id)!;
  await learning(f, e.id);
  await learning(f, other.id);
  await finish(f, e.id, "objective");
  const pending = await submitEssay(f, e.id);
  await finish(f, other.id, "objective");
  await finish(f, other.id, "practical");
  const otherEssay = await submitEssay(f, other.id);
  const grade = {
    grades: { "essay-1": { points: 10, reason: "독립 수행 요건 충족" } },
    feedback: "",
  };
  await f.call("ft-1", `/attempts/${otherEssay.id}/grading/finalize`, {
    revision: otherEssay.revision,
    ...grade,
  });
  assert.ok(
    f.store.snapshot().completions.some((x) => x.enrollmentId === other.id),
  );
  assert.equal(
    f.store.snapshot().attempts.find((x) => x.id === pending.id)!.status,
    "submitted",
  );
  assert.ok(
    !f.store.snapshot().certifications.some((x) => x.assignmentId === a.id),
  );
  const practical = await attempt(f, e.id, "practical");
  const course = f.store.snapshot().courses.find((x) => x.id === first.c)!;
  await f.call(
    "ft-1",
    `/attempts/${practical.id}/draft`,
    {
      revision: practical.revision,
      answers: {},
      verdicts: Object.fromEntries(
        course.practicalItems.map((i) => [
          i.id,
          { value: "pass", evidence: "수행 확인" },
        ]),
      ),
    },
    200,
    "PUT",
  );
  await Promise.all([
    f.call("ft-1", `/attempts/${pending.id}/grading/finalize`, {
      revision: pending.revision,
      ...grade,
    }),
    f.call("ft-1", `/attempts/${practical.id}/submit`, {
      revision: practical.revision + 1,
    }),
  ]);
  const before = f.store.snapshot(),
    cert = before.certifications.find((x) => x.assignmentId === a.id)!;
  assert.equal(
    before.certifications.filter((x) => x.assignmentId === a.id).length,
    1,
  );
  assert.equal(
    before.completions.filter((x) => x.enrollmentId === e.id).length,
    1,
  );
  assert.equal(
    before.notifications.filter(
      (x) => x.type === "certification" && x.assignmentId === a.id,
    ).length,
    1,
  );
  await f.call(
    "operator-1",
    "/system/users/learner-2",
    {
      revision: 1,
      name: "취득 후 이름 변경",
      organizationId: "org-photo-pyeongtaek-1",
      roles: ["learner"],
    },
    200,
    "PATCH",
  );
  assert.deepEqual(
    f.store.snapshot().certifications.find((x) => x.id === cert.id),
    cert,
  );
  assert.deepEqual(f.store.snapshot().completions, before.completions);
});
