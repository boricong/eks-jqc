import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { State, Kind, Course } from "@eks/contracts";
import { seedState } from "../src/seed.ts";
import { JsonStore } from "../src/storage.ts";
import { validateState } from "../src/integrity.ts";
import { buildApp } from "../src/app.ts";

async function fixture(t: TestContext, change?: (s: State) => void) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "eks-api-")),
    file = path.join(dir, "runtime", "state.json"),
    seed = seedState();
  seed.users.push(
    { id: "admin-2", name: "다른 운영자", roles: ["admin"] },
    { id: "dual", name: "겸직 참여자", roles: ["learner", "ft"] },
  );
  change?.(seed);
  await new JsonStore(file).initialize(seed);
  let store = await new JsonStore(file).load(),
    app = await buildApp(store);
  await app.ready();
  let closed = false;
  const cookies = new Map<string, string>();
  async function cookieFor(actor: string) {
    if (!cookies.has(actor)) {
      const r = await app.inject({
        method: "POST",
        url: "/api/session",
        payload: { actorId: actor },
      });
      assert.equal(r.statusCode, 200, r.body);
      cookies.set(actor, r.cookies[0]!.name + "=" + r.cookies[0]!.value);
    }
    return cookies.get(actor)!;
  }
  async function call(
    actor: string,
    url: string,
    body?: unknown,
    expected = 200,
    key = randomUUID(),
    method?: "GET" | "POST" | "PUT",
  ) {
    const r = await app.inject({
      method: method || (body === undefined ? "GET" : "POST"),
      url: "/api" + url,
      headers: { cookie: await cookieFor(actor), "idempotency-key": key },
      ...(body === undefined ? {} : { payload: body as any }),
    });
    assert.equal(r.statusCode, expected, `${url}: ${r.body}`);
    return r.json();
  }
  async function restart() {
    await app.close();
    store = await new JsonStore(file).load();
    app = await buildApp(store);
    await app.ready();
    cookies.clear();
  }
  t.after(async () => {
    if (!closed) {
      await app.close();
      closed = true;
    }
    await rm(dir, { recursive: true, force: true });
  });
  return {
    dir,
    file,
    get app() {
      return app;
    },
    get store() {
      return store;
    },
    call,
    cookieFor,
    restart,
    async stop() {
      await app.close();
      closed = true;
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const eid = "assignment-1:demo-course-1";
async function start(
  f: Fixture,
  enrollmentId: string,
  kind: Kind,
  learner = "learner-1",
) {
  return f.call(
    learner,
    `/enrollments/${encodeURIComponent(enrollmentId)}/attempts`,
    { kind },
  );
}
async function saved(f: Fixture, attemptId: string, pass = true, ft = "ft-1") {
  const t = f.store.snapshot().attempts.find((t) => t.id === attemptId)!,
    c = f.store.snapshot().courses.find((c) => c.id === t.courseId)!;
  const answers =
    t.kind === "objective"
      ? Object.fromEntries(
          c.questions.map((q, i) => [
            q.id,
            !pass && i === 0 ? (q.correct! + 1) % q.choices.length : q.correct,
          ]),
        )
      : {};
  const verdicts =
    t.kind === "practical"
      ? Object.fromEntries(
          c.practicalItems.map((item, i) => [
            item.id,
            {
              value: !pass && i === 0 ? "fail" : "pass",
              evidence: "독립 수행을 관찰한 가상 근거",
            },
          ]),
        )
      : {};
  return f.call(
    t.kind === "objective" ? t.learnerId : ft,
    `/attempts/${t.id}/draft`,
    { revision: t.revision, answers, verdicts },
    200,
    randomUUID(),
    "PUT",
  );
}
async function submit(f: Fixture, attemptId: string, ft = "ft-1") {
  const t = f.store.snapshot().attempts.find((t) => t.id === attemptId)!;
  return f.call(
    t.kind === "objective" ? t.learnerId : ft,
    `/attempts/${t.id}/submit`,
    {
      revision: t.revision,
    },
  );
}
async function finish(
  f: Fixture,
  enrollmentId: string,
  kind: Kind,
  pass = true,
  learner = "learner-1",
  ft = "ft-1",
) {
  const t = await start(f, enrollmentId, kind, learner);
  await saved(f, t.id, pass, ft);
  return submit(f, t.id, ft);
}

test("세션·서버 권한·정답 보호·담당 관계", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.app.inject("/api/workspace")).statusCode, 401);
  const learner = await f.call("learner-1", "/workspace");
  assert.equal(learner.assignments.length, 1);
  assert.equal(learner.courses.length, 2);
  assert.ok(
    learner.courses.every((c: any) =>
      c.questions.every((q: any) => !Object.hasOwn(q, "correct")),
    ),
  );
  assert.ok(
    learner.assignments[0].enrollments.every((e: any) =>
      e.history.every(
        (h: any) => !("answers" in h) && !("verdicts" in h) && !("earned" in h),
      ),
    ),
  );
  assert.equal((await f.call("learner-2", "/workspace")).assignments.length, 0);
  await f.call("learner-2", "/attempts/attempt-1", undefined, 403);
  await f.call("admin-2", "/assignments/assignment-1/results", undefined, 404);
  await f.call("learner-1", "/courses", {}, 403);
  await f.call(
    "learner-2",
    `/enrollments/${encodeURIComponent(eid)}/attempts`,
    { kind: "practical" },
    403,
  );
  const s = await start(f, eid, "practical");
  await f.call(
    "ft-2",
    `/attempts/${s.id}/draft`,
    { revision: 1, answers: {}, verdicts: {} },
    403,
    randomUUID(),
    "PUT",
  );
  await f.call(
    "admin-1",
    "/assignments",
    { qualificationId: "demo-qualification", learnerId: "dual", ftId: "dual" },
    422,
  );
  const response = await f.app.inject({
    method: "POST",
    url: "/api/session",
    headers: { origin: "https://untrusted.example" },
    payload: { actorId: "admin-1" },
  });
  assert.equal(response.statusCode, 403);
  const login = await f.app.inject({
    method: "POST",
    url: "/api/session",
    payload: { actorId: "learner-1" },
  });
  assert.match(String(login.headers["set-cookie"]), /HttpOnly/);
  assert.match(String(login.headers["set-cookie"]), /SameSite=Strict/i);
});

test("응시 이어쓰기·새로고침·서버 재시작·미응답 차단", async (t) => {
  const f = await fixture(t),
    enrollmentId = "assignment-1:demo-course-2";
  const first = await start(f, enrollmentId, "objective"),
    again = await start(f, enrollmentId, "objective");
  assert.equal(first.id, again.id);
  await f.call(
    "learner-1",
    `/attempts/${first.id}/draft`,
    { revision: 1, answers: { "d2-q1": 0 }, verdicts: {} },
    200,
    randomUUID(),
    "PUT",
  );
  await f.call(
    "learner-1",
    `/attempts/${first.id}/submit`,
    { revision: 2 },
    422,
  );
  const oldCookie = await f.cookieFor("learner-1");
  await f.restart();
  assert.equal(
    (
      await f.app.inject({
        url: "/api/workspace",
        headers: { cookie: oldCookie },
      })
    ).statusCode,
    401,
  );
  const resumed = await start(f, enrollmentId, "objective");
  assert.equal(resumed.id, first.id);
  const data = await f.call("learner-1", `/attempts/${first.id}`);
  assert.deepEqual(data.answers, { "d2-q1": 0 });
  await f.call(
    "learner-1",
    `/attempts/${first.id}/draft`,
    { revision: 2, answers: { "d2-q1": 99 }, verdicts: {} },
    422,
    randomUUID(),
    "PUT",
  );
});

test("부분 통과 유지·실기 재응시·복수 합격 근거·자동 인증", async (t) => {
  const f = await fixture(t);
  await f.call(
    "learner-1",
    `/enrollments/${encodeURIComponent(eid)}/attempts`,
    { kind: "objective" },
    409,
  );
  await finish(f, eid, "practical");
  let s = f.store.snapshot();
  assert.equal(s.completions.length, 1);
  assert.equal(s.certifications.length, 0);
  const completion = s.completions[0]!;
  assert.equal(
    completion.evidence.find((x) => x.kind === "objective")!.attemptId,
    "attempt-1",
  );
  assert.equal(
    s.attempts.find(
      (x) =>
        x.id ===
        completion.evidence.find((ev) => ev.kind === "practical")!.attemptId,
    )!.round,
    2,
  );
  const e2 = "assignment-1:demo-course-2";
  await finish(f, e2, "practical");
  await finish(f, e2, "objective", false);
  assert.equal(f.store.snapshot().certifications.length, 0);
  await finish(f, e2, "objective");
  s = f.store.snapshot();
  assert.equal(s.certifications.length, 1);
  assert.equal(s.completions.length, 2);
  assert.equal(s.certifications[0]!.evidence.length, 2);
  assert.equal(s.attempts.filter((a) => a.result === "failed").length, 2);
  const learner = await f.call(
    "learner-1",
    "/assignments/assignment-1/certification",
  );
  assert.equal(learner.certification.id, s.certifications[0]!.id);
  await f.restart();
  assert.equal(
    f.store.snapshot().certifications[0]!.id,
    s.certifications[0]!.id,
  );
});

test("객관식 전용·실기 전용과 비필수 실기 항목", async (t) => {
  const f = await fixture(t, (s) => {
    for (const mode of ["objective", "practical"] as const) {
      const c = {
        ...structuredClone(s.courses[0]!),
        id: `only-${mode}`,
        entityId: `only-${mode}`,
        mode,
      };
      if (mode === "practical")
        c.practicalItems.push({
          id: "optional",
          title: "관찰 항목",
          criterion: "참고",
          mandatory: false,
        });
      s.courses.push(c);
      s.qualifications.push({
        id: `qual-${mode}`,
        entityId: `qual-${mode}`,
        version: 1,
        revision: 1,
        title: mode,
        status: "published",
        courseIds: [c.id],
      });
    }
  });
  for (const kind of ["objective", "practical"] as const) {
    const a = await f.call("admin-1", "/assignments", {
      qualificationId: `qual-${kind}`,
      learnerId: "learner-2",
      ftId: kind === "practical" ? "ft-1" : null,
    });
    const e = f.store
      .snapshot()
      .enrollments.find((e) => e.assignmentId === a.id)!;
    const attempt = await start(f, e.id, kind, "learner-2");
    await saved(f, attempt.id);
    if (kind === "practical") {
      const current = f.store
        .snapshot()
        .attempts.find((t) => t.id === attempt.id)!;
      current.verdicts.optional = { value: "fail", evidence: "필수 아님" };
      await f.call(
        "ft-1",
        `/attempts/${attempt.id}/draft`,
        { revision: current.revision, answers: {}, verdicts: current.verdicts },
        200,
        randomUUID(),
        "PUT",
      );
    }
    await submit(f, attempt.id);
    assert.ok(
      f.store.snapshot().certifications.some((c) => c.assignmentId === a.id),
    );
  }
});

test("중복 제출·동시 마지막 평가 확정·요청 식별자 충돌", async (t) => {
  const f = await fixture(t);
  await finish(f, eid, "practical");
  const e2 = "assignment-1:demo-course-2",
    objective = await start(f, e2, "objective"),
    practical = await start(f, e2, "practical");
  await saved(f, objective.id);
  await saved(f, practical.id);
  const key = randomUUID(),
    payload = { revision: 2 };
  const results = await Promise.all([
    f.call("learner-1", `/attempts/${objective.id}/submit`, payload, 200, key),
    f.call("learner-1", `/attempts/${objective.id}/submit`, payload, 200, key),
    f.call("ft-1", `/attempts/${practical.id}/submit`, { revision: 2 }),
  ]);
  assert.deepEqual(results[0], results[1]);
  const s = f.store.snapshot();
  assert.equal(s.completions.length, 2);
  assert.equal(s.certifications.length, 1);
  await f.call(
    "learner-1",
    `/attempts/${objective.id}/submit`,
    { revision: 3 },
    409,
    key,
  );
  await f.restart();
  assert.deepEqual(
    await f.call(
      "learner-1",
      `/attempts/${objective.id}/submit`,
      payload,
      200,
      key,
    ),
    results[0],
  );
  assert.equal(f.store.snapshot().certifications.length, 1);
});

test("저장 충돌·파일 저장 실패·동일 요청 복구", async (t) => {
  const f = await fixture(t),
    a = await start(f, "assignment-1:demo-course-2", "objective");
  await f.call(
    "learner-1",
    `/attempts/${a.id}/draft`,
    { revision: 1, answers: { "d2-q1": 0 }, verdicts: {} },
    200,
    randomUUID(),
    "PUT",
  );
  await f.call(
    "learner-1",
    `/attempts/${a.id}/draft`,
    { revision: 1, answers: { "d2-q1": 1 }, verdicts: {} },
    409,
    randomUUID(),
    "PUT",
  );
  await saved(f, a.id);
  const before = f.store.snapshot(),
    disk = await readFile(f.file, "utf8"),
    key = randomUUID(),
    payload = { revision: 3 };
  f.store.beforeReplace = () => {
    throw new Error("simulated disk failure");
  };
  await f.call("learner-1", `/attempts/${a.id}/submit`, payload, 503, key);
  assert.deepEqual(f.store.snapshot(), before);
  assert.equal(await readFile(f.file, "utf8"), disk);
  f.store.beforeReplace = undefined;
  await f.call("learner-1", `/attempts/${a.id}/submit`, payload, 200, key);
  assert.equal(
    f.store
      .snapshot()
      .attempts.filter((t) => t.id === a.id && t.status === "submitted").length,
    1,
  );
});

test("FT 교체: 미확정 초안 보존·초기화·늦은 요청 차단", async (t) => {
  const f = await fixture(t),
    attempt = await start(f, eid, "practical");
  await saved(f, attempt.id, false);
  const old = f.store.snapshot().attempts.find((t) => t.id === attempt.id)!;
  await f.call("admin-1", "/assignments/assignment-1/ft", {
    revision: 1,
    ftId: "ft-2",
    reason: "담당자 변경",
  });
  const s = f.store.snapshot(),
    current = s.attempts.find((t) => t.id === attempt.id)!;
  assert.equal(current.round, 2);
  assert.deepEqual(current.verdicts, {});
  assert.equal(current.evaluatorId, "ft-2");
  assert.equal(current.revision, old.revision + 1);
  const event = s.audits.find((e) => e.action === "assignment.ft")!;
  assert.equal(event.reason, "담당자 변경");
  assert.deepEqual(
    (event.details.archivedDrafts as any)[0].verdicts,
    old.verdicts,
  );
  assert.equal(
    s.attempts.find((t) => t.id === "attempt-2")!.evaluatorId,
    "ft-1",
  );
  await f.call(
    "ft-1",
    `/attempts/${attempt.id}/submit`,
    { revision: old.revision },
    403,
  );
  await f.call("ft-1", `/attempts/${attempt.id}`, undefined, 403);
  await saved(f, attempt.id, true, "ft-2");
  await submit(f, attempt.id, "ft-2");
  assert.equal(f.store.snapshot().completions.length, 1);
});

test("기준 버전 계보·사용 등록 검증·고정·공지 영속 저장", async (t) => {
  const f = await fixture(t);
  const recipe = f.store
    .snapshot()
    .courses.find((c) => c.id === "recipe-edit")!;
  await f.call("admin-1", "/courses/recipe-edit/publish", recipe, 422);
  const original = f.store.snapshot().courses[0]!;
  await f.call(
    "admin-1",
    `/courses/${original.id}`,
    original,
    409,
    randomUUID(),
    "PUT",
  );
  const v2 = await f.call("admin-1", `/courses/${original.id}/versions`, {}),
    v3 = await f.call("admin-1", `/courses/${original.id}/versions`, {});
  const s = f.store.snapshot();
  assert.equal(s.courses.find((c) => c.id === v2.id)!.version, 2);
  assert.equal(s.courses.find((c) => c.id === v3.id)!.version, 3);
  const draft = s.courses.find((c) => c.id === v2.id)!;
  await f.call("admin-1", `/courses/${v2.id}/publish`, {
    ...draft,
    questions: draft.questions.map((q) => ({ ...q, category: "case" })),
    materialUrl: "https://example.com/manual",
  });
  assert.equal(f.store.snapshot().enrollments[0]!.courseId, original.id);
  await f.call("admin-1", "/notices", {
    title: "새 공지",
    body: "내용",
    published: true,
  });
  await f.restart();
  assert.ok(
    (await f.call("learner-1", "/notices")).some(
      (n: any) => n.title === "새 공지",
    ),
  );
});

test("검증 제외 후 원본 보존과 모든 새 처리 차단", async (t) => {
  const f = await fixture(t),
    attempt = await start(f, eid, "practical");
  await saved(f, attempt.id);
  const before = f.store.snapshot();
  await f.call("admin-1", "/assignments/assignment-1/exclusion", {
    revision: 1,
    reason: "잘못된 배정",
  });
  await f.call("ft-1", `/attempts/${attempt.id}/submit`, { revision: 2 }, 409);
  await f.call(
    "learner-1",
    `/enrollments/${encodeURIComponent(eid)}/attempts`,
    { kind: "practical" },
    409,
  );
  const after = f.store.snapshot();
  assert.deepEqual(after.attempts, before.attempts);
  assert.deepEqual(after.completions, before.completions);
  assert.equal((await f.call("learner-1", "/home")).assignments.length, 0);
  assert.equal(
    (await f.call("admin-1", "/assignments/assignment-1/results")).assignment
      .excludedReason,
    "잘못된 배정",
  );
});

const comparisonData = {
  attemptIds: ["attempt-1", "attempt-2"],
  observedAt: "2026-10-16",
  observer: "현장 관찰자",
  task: "별도의 작업 수행",
  criterion: "최소 요건을 독립 수행",
  evidence: "동일 평가와 별개로 관찰한 수행 근거",
  evidenceUrl: "https://example.com/evidence",
  independence: "independent",
  performance: "met",
};
test("실제 수행 비교: 선택 회차 고정·정정·권한·독립성", async (t) => {
  const f = await fixture(t);
  const result = await f.call(
    "admin-1",
    `/enrollments/${encodeURIComponent(eid)}/comparisons`,
    {},
  );
  await f.call("admin-1", `/comparisons/${result.id}/finalize`, {
    ...comparisonData,
    revision: 1,
  });
  const fixed = structuredClone(f.store.snapshot().comparisons[0]!);
  assert.equal(fixed.outcome, "performance_only");
  await finish(f, eid, "practical");
  assert.deepEqual(f.store.snapshot().comparisons[0], fixed);
  await f.call("admin-2", `/comparisons/${result.id}`, undefined, 404);
  await f.call(
    "admin-2",
    `/comparisons/${result.id}/corrections`,
    { reason: "수정" },
    403,
  );
  await f.call(
    "admin-1",
    `/comparisons/${result.id}`,
    { ...fixed },
    409,
    randomUUID(),
    "PUT",
  );
  const corrected = await f.call(
    "admin-1",
    `/comparisons/${result.id}/corrections`,
    {
      reason: "근거 출처 정정",
    },
  );
  await f.call("admin-1", `/comparisons/${corrected.id}/finalize`, {
    ...comparisonData,
    revision: 1,
    independence: "same_assessment",
  });
  const revised = f.store
    .snapshot()
    .comparisons.find((c) => c.id === corrected.id)!;
  assert.equal(revised.outcome, "pending");
  assert.equal(revised.supersedesId, fixed.id);
  assert.deepEqual(f.store.snapshot().comparisons[0], fixed);
  await f.call("admin-1", "/assignments/assignment-1/exclusion", {
    revision: 1,
    reason: "검증 제외",
  });
  await f.call(
    "admin-1",
    `/comparisons/${corrected.id}/corrections`,
    { reason: "다시 정정" },
    409,
  );
});

test("비교 기록의 잘못된 근거 연결·필수 입력 차단", async (t) => {
  const f = await fixture(t),
    record = await f.call(
      "admin-1",
      `/enrollments/${encodeURIComponent(eid)}/comparisons`,
      {},
    );
  await finish(f, "assignment-1:demo-course-2", "objective");
  const wrong = f.store
    .snapshot()
    .attempts.find((t) => t.enrollmentId === "assignment-1:demo-course-2")!;
  await f.call(
    "admin-1",
    `/comparisons/${record.id}/finalize`,
    { ...comparisonData, attemptIds: [wrong.id, "attempt-2"], revision: 1 },
    422,
  );
  await f.call(
    "admin-1",
    `/comparisons/${record.id}/finalize`,
    { ...comparisonData, attemptIds: ["attempt-1"], revision: 1 },
    422,
  );
  await f.call(
    "admin-1",
    `/comparisons/${record.id}/finalize`,
    { ...comparisonData, observer: "", revision: 1 },
    422,
  );
  await f.call(
    "admin-1",
    `/comparisons/${record.id}`,
    {
      ...comparisonData,
      observer: "",
      observedAt: "",
      attemptIds: [],
      revision: 1,
    },
    200,
    randomUUID(),
    "PUT",
  );
  assert.equal(f.store.snapshot().comparisons[0]!.status, "draft");
});

test("비교 결과 다섯 유형과 수료·인증 독립성", async (t) => {
  const f = await fixture(t);
  await finish(f, eid, "practical");
  const passed = f.store
    .snapshot()
    .attempts.find(
      (a) =>
        a.enrollmentId === eid &&
        a.kind === "practical" &&
        a.result === "passed",
    )!;
  const before = f.store.snapshot();
  for (const [attempt, performance, independence, expected] of [
    [passed.id, "met", "independent", "both_met"],
    [passed.id, "unmet", "independent", "assessment_only"],
    ["attempt-2", "met", "independent", "performance_only"],
    ["attempt-2", "unmet", "independent", "neither_met"],
    [passed.id, "unknown", "independent", "pending"],
    [passed.id, "met", "unknown", "pending"],
  ]) {
    const record = await f.call(
      "admin-1",
      `/enrollments/${encodeURIComponent(eid)}/comparisons`,
      {},
    );
    await f.call("admin-1", `/comparisons/${record.id}/finalize`, {
      ...comparisonData,
      revision: 1,
      attemptIds: ["attempt-1", attempt],
      performance,
      independence,
    });
    assert.equal(
      f.store.snapshot().comparisons.find((c) => c.id === record.id)!.outcome,
      expected,
    );
  }
  assert.deepEqual(f.store.snapshot().completions, before.completions);
  assert.deepEqual(f.store.snapshot().certifications, before.certifications);
  const broken = f.store.snapshot();
  broken.comparisons[0]!.outcome = "neither_met";
  assert.throws(() => validateState(broken), /비교 판정 불일치/);
});

test("정확한 합격 경계와 반올림 독립 판정", async (t) => {
  const f = await fixture(t, (s) => {
    for (const score of [66, 67]) {
      const c: Course = {
        ...structuredClone(s.courses[0]!),
        id: `boundary-${score}`,
        entityId: `boundary-${score}`,
        mode: "objective",
        passScore: score,
      };
      c.questions[0]!.points = 2;
      c.questions[1]!.points = 1;
      s.courses.push(c);
      s.qualifications.push({
        id: `q-${score}`,
        entityId: `q-${score}`,
        title: "경계 시험",
        version: 1,
        revision: 1,
        status: "published",
        courseIds: [c.id],
      });
    }
  });
  for (const score of [66, 67]) {
    const a = await f.call("admin-1", "/assignments", {
      qualificationId: `q-${score}`,
      learnerId: "learner-2",
      ftId: null,
    });
    const e = f.store
      .snapshot()
      .enrollments.find((e) => e.assignmentId === a.id)!;
    const t = await start(f, e.id, "objective", "learner-2");
    await f.call(
      "learner-2",
      `/attempts/${t.id}/draft`,
      { revision: 1, answers: { "d1-q1": 0, "d1-q2": 0 }, verdicts: {} },
      200,
      randomUUID(),
      "PUT",
    );
    const result = await submit(f, t.id);
    assert.equal(result.result, score === 66 ? "passed" : "failed");
  }
});

test("저장소 잠금·손상 중단·백업 복구·잘못된 근거 파일 거부", async (t) => {
  const f = await fixture(t);
  await assert.rejects(new JsonStore(f.file).load(), /잠겨/);
  const backup = await f.store.backup();
  const original = f.store.snapshot();
  await f.stop();
  await writeFile(f.file, "broken json");
  await assert.rejects(new JsonStore(f.file).load(), /열 수 없습니다/);
  assert.equal(await readFile(f.file, "utf8"), "broken json");
  await new JsonStore(f.file).restore(backup);
  const restored = await new JsonStore(f.file).load();
  assert.deepEqual(restored.snapshot(), original);
  await restored.close();
  const corrupt = structuredClone(original);
  corrupt.attempts[0]!.learnerId = "learner-2";
  assert.throws(() => validateState(corrupt), /무결성/);
  const malformed = structuredClone(original);
  malformed.courses[0]!.questions[0]!.correct = 99;
  assert.throws(() => validateState(malformed), /무결성/);
  assert.ok(
    (await readdir(path.dirname(backup))).some((n) =>
      n.startsWith("before-restore"),
    ),
  );
});
