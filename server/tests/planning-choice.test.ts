import { loadPlanningFixture } from "./planning-migration-helper.ts";
import { releaseFixture } from "./release-fixture.ts";
import { legacyPlanFixture } from "./legacy-plan-fixture.ts";
import { legacyRequestFixture } from "./legacy-request-fixture.ts";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { seedState } from "../src/seed.ts";
import { JsonStore } from "../src/storage.ts";
import { buildApp } from "./release-test-app.ts";
import { migratePlanning } from "../src/planning-migration.ts";
import { migratePlanningSchedule } from "../src/planning-schedule-migration.ts";
import { validateState } from "../src/integrity.ts";
import { registerFixtureQualification } from "./template-helpers.ts";
const root = "org-photo",
  qid = "demo-qualification";
async function fixture(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-choice-")),
    file = path.join(dir, "runtime/state.json");
  await new JsonStore(file).initialize(seedState(true));
  let at = new Date().toISOString();
  const store = await new JsonStore(file).load(),
    app = await buildApp(store, { clock: () => at }),
    cookies = new Map<string, string>();
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  async function call(
    actor: string,
    url: string,
    body?: any,
    status = 200,
    method = body === undefined ? "GET" : "POST",
    key = randomUUID(),
  ) {
    if (!cookies.has(actor)) {
      const r = await app.inject({
        method: "POST",
        url: "/api/session",
        payload: { actorId: actor },
      });
      assert.equal(r.statusCode, 200, r.body);
      cookies.set(actor, `${r.cookies[0]!.name}=${r.cookies[0]!.value}`);
    }
    const r = await app.inject({
      method: method as any,
      url: "/api" + url,
      headers: { cookie: cookies.get(actor)!, "idempotency-key": key },
      ...(body === undefined ? {} : { payload: body }),
    });
    assert.equal(r.statusCode, status, `${actor} ${url}: ${r.body}`);
    return r.json();
  }
  const req = async () =>
    (
      await legacyRequestFixture(store, "admin-1", {
        learnerIds: ["learner-2"],
        message: "자격 선택",
      })
    ).ids[0];
  const row = (id: string) =>
    store.snapshot().planningRequests.find((r) => r.id === id)!;
  const view = (id: string) =>
    call("learner-2", `/planning-requests/${id}/candidates`);
  const pool = (ids = [qid]) =>
    call(
      "admin-1",
      `/organization-policies/${root}/qualification-pool`,
      {
        revision: store.organizations.snapshot().revision,
        qualificationIds: ids,
      },
      410,
      "PUT",
    );
  const required = (ids: string[] | null) =>
    call(
      "admin-1",
      `/organization-settings/${root}`,
      {
        revision: store.organizations.snapshot().revision,
        description: "",
        duties: "",
      },
      200,
      "PUT",
    );
  const select = (id: string, entityIds: string[], status = 200) =>
    call(
      "learner-2",
      `/planning-requests/${id}/selection`,
      { revision: row(id).revision, entityIds },
      status,
      "PUT",
    );
  async function plan(requestId: string, qualificationId = qid) {
    const { id } = await call("learner-2", "/plans", {
      requestRevision: store
        .snapshot()
        .planningRequests.find((r) => r.id === requestId)!.revision,
      requestId,
      qualificationId,
    });
    let p = store.snapshot().plans.find((p) => p.id === id)!;
    await call(
      "learner-2",
      `/plans/${id}`,
      {
        revision: p.revision,
        endOn: "2027-02-01",
        startOn: "2026-11-01",
        goal: "독립 수행",
      },
      200,
      "PUT",
    );
    p = store.snapshot().plans.find((p) => p.id === id)!;
    return p;
  }
  const confirmPlan = (p: any) =>
    call("learner-2", `/plans/${p.id}/complete`, { revision: p.revision });
  const finish = (id: string, status = 200, extra = {}) =>
    call(
      "learner-2",
      `/planning-requests/${id}/complete`,
      { revision: row(id).revision, ...extra },
      status,
    );
  const mutate = (fn: (s: ReturnType<typeof seedState>) => void) =>
    store.transact(
      "operator-1",
      randomUUID(),
      randomUUID(),
      () => {},
      (s) => {
        fn(s);
        return {};
      },
    );
  return {
    dir,
    file,
    store,
    app,
    call,
    req,
    row,
    view,
    pool,
    required,
    select,
    plan,
    confirmPlan,
    finish,
    mutate,
    clock: (value: string) => {
      at = value;
    },
  };
}
test("필수 null/빈 배열에도 등록 자격으로 시작하며 미착수 요청은 완료하지 않는다", async (t) => {
  const f = await fixture(t);
  for (const required of [null, []]) {
    await f.required(required);
    const id = await f.req();
    assert.equal((await f.view(id)).stage, "미착수");
    await f.finish(id, 409);
    assert.deepEqual(f.row(id).selections, []);
  }
  await f.pool();
  const id = f.store.snapshot().planningRequests[0]!.id;
  assert.equal((await f.view(id)).candidates[0].status, "available");
  await f.finish(id, 409);
  assert.equal((await f.view(id)).candidates[0].canStart, true);
  assert.deepEqual(f.row(id).selections, []);
  const p = await f.plan(id);
  await f.finish(id, 409);
  await f.confirmPlan(p);
  await f.finish(id);
  assert.equal(f.row(id).completion?.evidence[0]?.planId, p.id);
  assert.equal(
    f.store.snapshot().assignments.filter((a) => a.planId === p.id).length,
    1,
  );
});
test("모두 확정 계획으로 진행 중이면 0개 완료 확인과 기존 근거 재사용", async (t) => {
  const f = await fixture(t);
  await f.mutate((s) => {
    s.qualifications = s.qualifications.filter((q) => q.id === qid);
  });
  await f.pool();
  const first = await f.req();
  await f.select(first, [qid]);
  const p = await f.plan(first);
  await f.confirmPlan(p);
  await f.finish(first);
  const next = await f.req();
  assert.equal((await f.view(next)).noAdditional, true);
  await f.finish(next, 422);
  await f.finish(next, 200, { confirmNoAdditional: true });
  assert.equal(f.row(next).completion?.reason, "no_additional");
  assert.equal(f.row(next).completion?.evidence[0]?.planId, p.id);
  assert.equal(f.store.snapshot().plans.length, 1);
});
test("선택 권한·위조·revision·동시 저장·완료 재전송·초안 선택 해제를 보호한다", async (t) => {
  const f = await fixture(t);
  await f.pool();
  const id = await f.req();
  await f.call(
    "learner-1",
    `/planning-requests/${id}/candidates`,
    undefined,
    403,
  );
  await f.call(
    "admin-1",
    `/planning-requests/${id}/selection`,
    { revision: 1, entityIds: [qid] },
    403,
    "PUT",
  );
  await f.select(id, ["unknown"], 422);
  const key = randomUUID(),
    input = { revision: 1, entityIds: [qid] };
  const a = await f.call(
    "learner-2",
    `/planning-requests/${id}/selection`,
    input,
    200,
    "PUT",
    key,
  );
  assert.deepEqual(
    await f.call(
      "learner-2",
      `/planning-requests/${id}/selection`,
      input,
      200,
      "PUT",
      key,
    ),
    a,
  );
  await f.call(
    "learner-2",
    `/planning-requests/${id}/selection`,
    input,
    409,
    "PUT",
  );
  const p = await f.plan(id);
  await f.select(id, [], 409);
  await f.call(
    "learner-2",
    `/plans/${p.id}`,
    { revision: p.revision },
    200,
    "DELETE",
  );
  await f.select(id, []);
  await f.select(id, [qid]);
  const next = await f.plan(id);
  await f.confirmPlan(next);
  const finishKey = randomUUID(),
    body = { revision: f.row(id).revision };
  const result = await f.call(
    "learner-2",
    `/planning-requests/${id}/complete`,
    body,
    200,
    "POST",
    finishKey,
  );
  assert.deepEqual(
    await f.call(
      "learner-2",
      `/planning-requests/${id}/complete`,
      body,
      200,
      "POST",
      finishKey,
    ),
    result,
  );
  assert.equal(f.row(id).completion?.evidence.length, 1);
});
test("비활성·Hold·운영 중지는 발송 또는 계획 완료를 적절히 차단한다", async (t) => {
  const f = await fixture(t);
  await f.pool();
  const id = await f.req();
  await f.select(id, [qid]);
  await f.plan(id);
  await f.mutate((s) => {
    s.qualifications.find((q) => q.id === qid)!.lifecycleStatus = "Hold";
  });
  const v = await f.view(id);
  assert.equal(v.noAdditional, false);
  const workspace = await f.call("admin-1", "/workspace");
  const readiness = workspace.planningReadiness.find(
    (r: any) => r.learnerId === "learner-2",
  );
  assert.equal(readiness.draftCount, 1);
  assert.equal(readiness.count, 0);
  await f.finish(id, 409);
  await f.mutate((s) => {
    s.users.find((u) => u.id === "learner-2")!.certificationEligibility =
      "hold";
  });
  await f.call(
    "admin-1",
    "/planning-requests",
    {
      stateRevision: f.store.snapshot().revision,
      organizationRevision: f.store.organizations.snapshot().revision,
      learnerIds: ["learner-2"],
      message: "",
    },
    409,
  );
  await f.select(id, [qid], 409);
});
test("12→13 명시적 이관은 원래 요청 대상·계획을 보존하고 완료를 추정하지 않는다", async (t) => {
  const f = await fixture(t);
  await f.pool();
  await f.required([qid]);
  const id = await f.req();
  await f.plan(id);
  const raw: any = f.store.snapshot();
  raw.schemaVersion = 12;
  legacyPlanFixture(raw);
  for (const r of raw.planningRequests) {
    delete r.mode;
    delete r.selections;
  }
  const next = migratePlanning(raw, f.store.organizations.snapshot());
  assert.equal(next.state.schemaVersion, 28);
  assert.deepEqual(
    next.state.plans.map((p) => p.previousSchedule!.schedules),
    raw.plans.map((p: any) => p.schedules),
  );
  for (const p of next.state.plans) {
    const original = raw.plans.find((v: any) => v.id === p.id);
    assert.equal(p.revision, original.revision + 1);
    const restored: any = {
      ...p,
      workflowVersion: p.previousSchedule!.workflowVersion,
      targetOn: p.previousSchedule!.targetOn,
      schedules: p.previousSchedule!.schedules,
      revision: original.revision,
      updatedAt: original.updatedAt,
    };
    for (const k of ["startOn", "endOn", "goal", "previousSchedule"])
      delete restored[k];
    assert.deepEqual(restored, original);
  }
  assert.equal(
    next.state.planningRequests[0]!.selections[0]!.qualificationId,
    raw.plans[0].qualificationId,
  );
  assert.equal(next.state.planningRequests[0]!.mode, "learner_choice");
  assert.equal(next.state.planningRequests[0]!.completion, undefined);
  assert.deepEqual(
    migratePlanning(next.state, next.organizations).state,
    next.state,
  );
  assert.throws(() => validateState(raw, next.organizations));
  await f.app.close();
  await writeFile(f.file, JSON.stringify(raw));
  const bytes = await readFile(f.file),
    orgBytes = await readFile(f.store.organizations.file),
    hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const disk = new JsonStore(f.file);
  await disk.migratePolicies(
    {
      revision: raw.revision,
      stateHash: hash(bytes),
      organizationHash: hash(orgBytes),
    },
    migratePlanning,
    "planning",
  );
  assert.deepEqual(await readFile(f.store.organizations.file), orgBytes);
  const upgradedBytes = await readFile(f.file);
  await disk.migratePolicies(
    {
      revision: JSON.parse(upgradedBytes.toString()).revision,
      stateHash: hash(upgradedBytes),
      organizationHash: hash(orgBytes),
    },
    migratePlanningSchedule,
  );
  const restored = await loadPlanningFixture(f.file);
  assert.equal(restored.snapshot().planningRequests[0]!.mode, "learner_choice");
  await restored.close();
});
test("저장 실패는 선택·감사·요청 기록을 원복하고 동시 완료·재시작에도 근거는 하나다", async (t) => {
  const f = await fixture(t);
  await f.pool();
  const id = await f.req();
  const before = f.store.snapshot(),
    bytes = await readFile(f.file),
    key = randomUUID();
  const body = { revision: f.row(id).revision, entityIds: [qid] };
  f.store.beforeReplace = () => {
    throw new Error("write failed");
  };
  await f.call(
    "learner-2",
    `/planning-requests/${id}/selection`,
    body,
    503,
    "PUT",
    key,
  );
  assert.deepEqual(f.store.snapshot(), before);
  assert.deepEqual(await readFile(f.file), bytes);
  f.store.beforeReplace = undefined;
  await f.call(
    "learner-2",
    `/planning-requests/${id}/selection`,
    body,
    200,
    "PUT",
    key,
  );
  const p = await f.plan(id);
  await f.confirmPlan(p);
  const revision = f.row(id).revision;
  // Same idempotency key returns one durable completion even for concurrent callers.
  const finishKey = randomUUID(),
    input = { revision };
  const results = await Promise.all(
    [0, 1].map(() =>
      f.call(
        "learner-2",
        `/planning-requests/${id}/complete`,
        input,
        200,
        "POST",
        finishKey,
      ),
    ),
  );
  assert.deepEqual(results[0], results[1]);
  assert.equal(
    f.store
      .snapshot()
      .audits.filter(
        (a) => a.action === "planning.complete" && a.targetId === id,
      ).length,
    1,
  );
  await f.app.close();
  const restored = await loadPlanningFixture(f.file);
  assert.equal(
    restored.snapshot().planningRequests.find((r) => r.id === id)!.completion
      ?.evidence[0]?.planId,
    p.id,
  );
  await restored.close();
});
test("과거 직접 배정은 중복 계획 없이 근거로 연결하고 외부 자격·완료 후 선택을 차단한다", async (t) => {
  const f = await fixture(t);
  await f.mutate((s) => {
    s.qualifications = s.qualifications.filter((q) => q.id === qid);
  });
  await f.pool();
  const id = (
    await legacyRequestFixture(f.store, "admin-1", {
      learnerIds: ["learner-1"],
      message: "",
    })
  ).ids[0];
  const v = await f.call("learner-1", `/planning-requests/${id}/candidates`);
  assert.equal(v.noAdditional, true);
  await f.call("learner-1", `/planning-requests/${id}/complete`, {
    revision: 1,
    confirmNoAdditional: true,
  });
  assert.equal(f.row(id).completion?.evidence[0]?.assignmentId, "assignment-1");
  await f.call(
    "learner-1",
    `/planning-requests/${id}/selection`,
    { revision: f.row(id).revision, entityIds: [qid] },
    409,
    "PUT",
  );
  assert.equal(f.store.snapshot().plans.length, 0);
});
test("13 이관의 교체 실패·해시 충돌은 원본 파일 쌍을 보존한다", async (t) => {
  const f = await fixture(t),
    raw: any = f.store.snapshot();
  raw.schemaVersion = 12;
  legacyPlanFixture(raw);
  await f.app.close();
  await writeFile(f.file, JSON.stringify(raw));
  const bytes = await readFile(f.file),
    org = await readFile(f.store.organizations.file),
    hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const expected = {
    revision: raw.revision,
    stateHash: hash(bytes),
    organizationHash: hash(org),
  };
  const disk = new JsonStore(f.file);
  disk.beforeReplace = () => {
    throw new Error("interrupted");
  };
  await assert.rejects(
    disk.migratePolicies(expected, migratePlanning, "planning"),
    /interrupted/,
  );
  assert.deepEqual(await readFile(f.file), bytes);
  assert.deepEqual(await readFile(f.store.organizations.file), org);
  disk.beforeReplace = undefined;
  await assert.rejects(
    disk.migratePolicies(
      { ...expected, stateHash: "0".repeat(64) },
      migratePlanning,
      "planning",
    ),
    /바뀌었습니다/,
  );
  assert.deepEqual(await readFile(f.file), bytes);
});
test("인증 근거로 완료한 요청은 만료 후에도 당시 근거와 완료를 보존한다", async (t) => {
  const f = await fixture(t);
  await f.mutate((s) => {
    s.qualifications.find((q) => q.id === qid)!.validity = {
      type: "months",
      months: 1,
      reminderDays: [],
    };
  });
  await f.pool();
  const id = await f.req();
  await f.select(id, [qid]);
  const p = await f.plan(id);
  await f.confirmPlan(p);
  const assignment = f.store
    .snapshot()
    .assignments.find((a) => a.planId === p.id)!;
  for (const e of f.store
    .snapshot()
    .enrollments.filter((e) => e.assignmentId === assignment.id)) {
    const c = f.store.snapshot().courses.find((c) => c.id === e.courseId)!;
    for (const kind of c.assessmentKinds) {
      const attempt = await f.call(
        "learner-2",
        `/enrollments/${e.id}/attempts`,
        { kind },
      );
      const answers = Object.fromEntries(
        (kind === "objective" ? c.questions : c.practicalQuestions).map((q) => [
          q.id,
          q.correct,
        ]),
      );
      await f.call(
        "learner-2",
        `/attempts/${attempt.id}/draft`,
        { revision: attempt.revision, answers },
        200,
        "PUT",
      );
      await f.call("learner-2", `/attempts/${attempt.id}/submit`, {
        revision: attempt.revision + 1,
      });
    }
  }
  await f.finish(id);
  const evidence = f.row(id).completion;
  assert.ok(evidence?.evidence[0]?.certificationId);
  f.clock("2030-01-01T00:00:00.000Z");
  await f.store.refreshNotifications("2030-01-01T00:00:00.000Z");
  assert.equal((await f.view(id)).stage, "계획 완료");
  assert.deepEqual(f.row(id).completion, evidence);
  assert.equal(
    f.store
      .snapshot()
      .certifications.find(
        (c) => c.id === evidence!.evidence[0]!.certificationId,
      )!.lifecycleStatus,
    "Revoke",
  );
});

test("직접 계획 시작은 요청 포함·초안·감사를 함께 저장하고 실패·재전송·동시 요청을 보호한다", async (t) => {
  const f = await fixture(t);
  await f.pool();
  const id = await f.req(),
    key = randomUUID();
  await f.call(
    "learner-2",
    "/plans",
    { requestId: id, qualificationId: qid },
    422,
  );
  const body = {
    requestId: id,
    requestRevision: f.row(id).revision,
    qualificationId: qid,
  };
  const before = f.store.snapshot(),
    bytes = await readFile(f.file);
  f.store.beforeReplace = () => {
    throw new Error("write failed");
  };
  await f.call("learner-2", "/plans", body, 503, "POST", key);
  assert.deepEqual(f.store.snapshot(), before);
  assert.deepEqual(await readFile(f.file), bytes);
  f.store.beforeReplace = undefined;
  const [a, b] = await Promise.all([
    f.call("learner-2", "/plans", body, 200, "POST", key),
    f.call("learner-2", "/plans", body, 200, "POST", key),
  ]);
  assert.deepEqual(a, b);
  assert.equal(f.row(id).revision, 2);
  assert.equal(f.row(id).selections.length, 1);
  assert.equal(f.store.snapshot().plans.length, 1);
  assert.equal(
    f.store
      .snapshot()
      .audits.filter((a) => a.targetId === id && a.action === "planning.select")
      .length,
    1,
  );
  await f.call("learner-2", "/plans", body, 409);
  assert.equal(
    (await f.call("learner-2", "/plans", { ...body, requestRevision: 2 })).id,
    a.id,
  );
  assert.equal(f.row(id).revision, 2);
  assert.deepEqual(
    await f.call("learner-2", "/plans", body, 200, "POST", key),
    a,
  );
  await f.call(
    "learner-2",
    "/plans",
    { ...body, requestRevision: 2 },
    409,
    "POST",
    key,
  );
});
test("다른 요청의 초안을 동시 재사용하며 삭제는 관련 비필수 요청만 자동 제외한다", async (t) => {
  const f = await fixture(t);
  await f.pool();
  const first = await f.req(),
    second = await f.req();
  await f.required([qid]);
  const required = await f.req();
  const starts = await Promise.all(
    [first, second, required].map((id) =>
      f.call("learner-2", "/plans", {
        requestId: id,
        requestRevision: f.row(id).revision,
        qualificationId: qid,
      }),
    ),
  );
  assert.equal(new Set(starts.map((r) => r.id)).size, 1);
  assert.equal(f.store.snapshot().plans.length, 1);
  assert.equal(f.row(first).selections.length, 1);
  assert.equal(f.row(second).selections.length, 1);
  assert.equal(f.row(required).selections.length, 1);
  await f.finish(first, 409);
  await f.finish(required, 409);
  const p = f.store.snapshot().plans[0]!;
  await f.call(
    "learner-2",
    `/plans/${p.id}`,
    { revision: p.revision },
    200,
    "DELETE",
  );
  for (const id of [first, second, required]) {
    assert.deepEqual(f.row(id).selections, []);
    assert.equal(f.row(id).revision, 3);
  }
  assert.equal(f.row(required).selections.length, 0);
  assert.equal(f.row(required).revision, 3);
  assert.equal((await f.view(required)).candidates[0].canStart, true);
  await f.finish(required, 409);
  const next = await f.plan(required);
  assert.notEqual(next.id, p.id);
  await f.confirmPlan(next);
  await f.finish(required);
  const completion = structuredClone(f.row(required).completion);
  await f.call(
    "learner-2",
    `/plans/${next.id}`,
    { revision: next.revision + 1 },
    409,
    "DELETE",
  );
  assert.deepEqual(f.row(required).completion, completion);
});
test("초안 삭제 저장 실패는 요청 포함과 원본을 모두 보존한다", async (t) => {
  const f = await fixture(t);
  await f.pool();
  const id = await f.req(),
    p = await f.plan(id);
  const before = f.store.snapshot(),
    bytes = await readFile(f.file),
    key = randomUUID();
  f.store.beforeReplace = () => {
    throw new Error("delete failed");
  };
  await f.call(
    "learner-2",
    `/plans/${p.id}`,
    { revision: p.revision },
    503,
    "DELETE",
    key,
  );
  assert.deepEqual(f.store.snapshot(), before);
  assert.deepEqual(await readFile(f.file), bytes);
  f.store.beforeReplace = undefined;
  await f.call(
    "learner-2",
    `/plans/${p.id}`,
    { revision: p.revision },
    200,
    "DELETE",
    key,
  );
  await f.call(
    "learner-2",
    `/plans/${p.id}`,
    { revision: p.revision },
    200,
    "DELETE",
    key,
  );
  assert.deepEqual(f.row(id).selections, []);
});
test("시작의 본인·팀 버전·운영 상태 검사는 실패한 요청 포함을 남기지 않는다", async (t) => {
  const f = await fixture(t);
  await f.pool();
  const id = await f.req(),
    body = { requestId: id, requestRevision: 1, qualificationId: qid };
  await f.call("learner-1", "/plans", body, 403);
  await f.call("learner-2", "/plans", { ...body, requestRevision: 2 }, 409);
  await f.mutate((s) => {
    s.qualifications.find((q) => q.id === qid)!.lifecycleStatus = "Hold";
  });
  await f.call("learner-2", "/plans", body, 409);
  assert.deepEqual(f.row(id).selections, []);
  assert.equal(f.store.snapshot().plans.length, 0);
});

test("적용 버전이 바뀌면 원본 초안을 보존하고 새 초안만 재사용·자동 제외 대상으로 삼는다", async (t) => {
  const f = await fixture(t);
  await f.pool();
  const request = await f.req(),
    old = await f.plan(request);
  const next = await f.call(
    "admin-1",
    ...releaseFixture(f.store.snapshot(), "qualifications", qid),
    200,
    "PUT",
  );
  await f.pool([next.id]);
  const current = await f.plan(request, next.id);
  assert.notEqual(current.id, old.id);
  assert.deepEqual(
    f.store.snapshot().plans.find((p) => p.id === old.id),
    old,
  );
  const extra = await f.req();
  const reused = await f.call("learner-2", "/plans", {
    requestId: extra,
    requestRevision: f.row(extra).revision,
    qualificationId: next.id,
  });
  assert.equal(reused.id, current.id);
  await f.call(
    "learner-2",
    `/plans/${old.id}`,
    { revision: old.revision },
    200,
    "DELETE",
  );
  for (const id of [request, extra])
    assert.equal(f.row(id).selections.length, 1);
  await f.call(
    "learner-2",
    `/plans/${current.id}`,
    { revision: current.revision },
    200,
    "DELETE",
  );
  for (const id of [request, extra]) assert.deepEqual(f.row(id).selections, []);
});
