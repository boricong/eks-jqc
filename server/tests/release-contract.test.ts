import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assessmentQuestions } from "@eks/contracts";
import { buildApp } from "../src/app.ts";
import { JsonStore } from "../src/storage.ts";
import { seedState } from "../src/seed.ts";
import { legacyRequestFixture } from "./legacy-request-fixture.ts";
import { latestCourse } from "../src/releases.ts";
async function fixture(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-release-contract-")),
    file = path.join(dir, "runtime/state.json");
  await new JsonStore(file).initialize(seedState(true));
  const store = await new JsonStore(file).load(),
    app = await buildApp(store);
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const cookies = new Map<string, string>();
  async function call(
    actor: string,
    url: string,
    body?: any,
    status = 200,
    method: any = body === undefined ? "GET" : "POST",
    key = randomUUID(),
    contract = true,
  ) {
    if (!cookies.has(actor)) {
      const r = await app.inject({
        method: "POST",
        url: "/api/session",
        payload: { actorId: actor },
      });
      assert.equal(r.statusCode, 200, r.body);
      cookies.set(actor, r.cookies[0]!.name + "=" + r.cookies[0]!.value);
    }
    const r = await app.inject({
      method,
      url: "/api" + url,
      headers: {
        cookie: cookies.get(actor)!,
        "idempotency-key": key,
        ...(contract ? { "x-eks-release-contract": "3" } : {}),
      },
      ...(body === undefined ? {} : { payload: body }),
    });
    assert.equal(r.statusCode, status, r.body);
    return r.json();
  }
  async function change() {
    const c = latestCourse(store.snapshot(), "demo-course-1")!;
    return call(
      "admin-1",
      "/courses/" + c.id,
      { ...c, title: c.title + " 개정" },
      200,
      "PUT",
    );
  }
  return { store, app, file, call, change };
}
test("공개 저장 계약·미리보기 충돌·실패 롤백·동일 요청 재시도는 버전 수를 보호한다", async (t) => {
  const f = await fixture(t),
    c = f.store.snapshot().courses[0]!;
  const body = { ...c, title: "원자적 개정" };
  const outdated = await f.call(
    "admin-1",
    "/courses/" + c.id,
    body,
    409,
    "PUT",
    randomUUID(),
    false,
  );
  assert.equal(outdated.code, "RELEASE_CONTRACT_CHANGED");
  const queryContract = await f.call(
    "admin-1",
    "/team-users?lv1OrganizationId=org-photo",
    {},
    409,
    "POST",
    randomUUID(),
    false,
  );
  assert.equal(queryContract.code, "RELEASE_CONTRACT_CHANGED");
  const p = await f.call("admin-1", "/courses/" + c.id + "/save-preview", body);
  const reviewed = {
    ...body,
    stateRevision: p.stateRevision,
    organizationRevision: p.organizationRevision,
  };
  const before = f.store.snapshot(),
    bytes = await readFile(f.file),
    key = randomUUID();
  f.store.beforeReplace = () => {
    throw Error("injected failure");
  };
  await f.call("admin-1", "/courses/" + c.id, reviewed, 503, "PUT", key);
  assert.deepEqual(f.store.snapshot(), before);
  assert.deepEqual(await readFile(f.file), bytes);
  f.store.beforeReplace = undefined;
  const saved = await f.call(
    "admin-1",
    "/courses/" + c.id,
    reviewed,
    200,
    "PUT",
    key,
  );
  assert.deepEqual(saved.releaseVersion, { major: 1, minor: 1 });
  const count = f.store.snapshot().qualifications.length;
  assert.deepEqual(
    await f.call("admin-1", "/courses/" + c.id, reviewed, 200, "PUT", key),
    saved,
  );
  assert.equal(f.store.snapshot().qualifications.length, count);
  await f.call("admin-1", "/courses/" + c.id, reviewed, 409, "PUT");
  const head = latestCourse(f.store.snapshot(), c.entityId)!;
  await f.call(
    "admin-1",
    "/courses/" + head.id,
    {
      ...head,
      title: "늦은 검토",
      stateRevision: p.stateRevision,
      organizationRevision: p.organizationRevision,
    },
    409,
    "PUT",
  );
  assert.deepEqual(
    f.store.snapshot().courses.find((v) => v.id === c.id),
    c,
  );
});
test("최종 확인의 두 번 변경 충돌·입력 보존·고정 버전 채점과 인증서 근거", async (t) => {
  const f = await fixture(t),
    request = await legacyRequestFixture(f.store, "admin-1", {
      learnerIds: ["learner-2"],
      message: "기준 확정 시험",
    });
  const p = await f.call("learner-2", "/plans", {
    requestId: request.ids[0],
    requestRevision: 1,
    qualificationId: "demo-qualification",
  });
  await f.call(
    "learner-2",
    "/plans/" + p.id,
    {
      revision: f.store.snapshot().plans.find((x) => x.id === p.id)!.revision,
      startOn: "2026-10-27",
      endOn: "2026-12-31",
      goal: "보존할 목표",
    },
    200,
    "PUT",
  );
  const row = () => f.store.snapshot().plans.find((x) => x.id === p.id)!;
  let review = await f.call("learner-2", "/plans/" + p.id + "/criteria");
  await f.change();
  await f.call(
    "learner-2",
    "/plans/" + p.id + "/complete",
    { revision: row().revision, criteriaToken: review.criteriaToken },
    409,
  );
  review = await f.call("learner-2", "/plans/" + p.id + "/criteria");
  await f.call("learner-2", "/plans/" + p.id + "/review-criteria", {
    revision: row().revision,
    qualificationId: review.current.id,
    criteriaToken: review.criteriaToken,
  });
  await f.change();
  await f.call(
    "learner-2",
    "/plans/" + p.id + "/complete",
    { revision: row().revision, criteriaToken: review.criteriaToken },
    409,
  );
  review = await f.call("learner-2", "/plans/" + p.id + "/criteria");
  await f.call("learner-2", "/plans/" + p.id + "/review-criteria", {
    revision: row().revision,
    qualificationId: review.current.id,
    criteriaToken: review.criteriaToken,
  });
  const key = randomUUID(),
    body = { revision: row().revision, criteriaToken: review.criteriaToken };
  const done = await f.call(
    "learner-2",
    "/plans/" + p.id + "/complete",
    body,
    200,
    "POST",
    key,
  );
  assert.deepEqual(
    await f.call(
      "learner-2",
      "/plans/" + p.id + "/complete",
      body,
      200,
      "POST",
      key,
    ),
    done,
  );
  assert.equal(row().goal, "보존할 목표");
  assert.equal(row().startOn, "2026-10-27");
  const fixed = structuredClone(row().frozenCriteria)!;
  await f.change();
  for (const e of f.store
    .snapshot()
    .enrollments.filter((e) => e.assignmentId === done.assignmentId)) {
    const c = f.store.snapshot().courses.find((c) => c.id === e.courseId)!;
    for (const kind of c.assessmentKinds) {
      const a = await f.call(
        "learner-2",
        "/enrollments/" + e.id + "/attempts",
        { kind },
      );
      await f.call(
        "learner-2",
        "/attempts/" + a.id + "/draft",
        {
          revision: a.revision,
          answers: Object.fromEntries(
            assessmentQuestions(c, kind).map((q) => [q.id, q.correct]),
          ),
        },
        200,
        "PUT",
      );
      await f.call("learner-2", "/attempts/" + a.id + "/submit", {
        revision: a.revision + 1,
      });
    }
  }
  const cert = f.store
    .snapshot()
    .certifications.find((c) => c.assignmentId === done.assignmentId)!;
  assert.ok(cert);
  assert.deepEqual(cert.frozenCriteria, fixed);
  assert.deepEqual(cert.snapshot!.releaseVersion, fixed.qualificationVersion);
  const issued = await f.call(
    "learner-2",
    "/assignments/" + done.assignmentId + "/certification",
  );
  await f.change();
  assert.deepEqual(
    await f.call(
      "learner-2",
      "/assignments/" + done.assignmentId + "/certification",
    ),
    issued,
  );
  await assert.rejects(
    f.store.transact(
      "admin-1",
      randomUUID(),
      "tamper",
      () => {},
      (s) => {
        s.courses.find(
          (c) => c.id === fixed.courses[0]!.id,
        )!.questions[0]!.prompt = "변조";
        return {};
      },
    ),
    /확정 인증Set 내용 변경/,
  );
});
