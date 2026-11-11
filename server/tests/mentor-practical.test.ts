import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  CourseContentSchema,
  assessmentQuestions,
  organizationEntries,
} from "@eks/contracts";
import { buildApp } from "../src/app.ts";
import { JsonStore } from "../src/storage.ts";
import { validateState } from "../src/integrity.ts";
import { migrateMentorPractical } from "../src/mentor-practical-migration.ts";
import { migrateGroupPractical } from "../src/group-practical-migration.ts";
import { seedState } from "../src/seed.ts";
import { seedOrganizations } from "../src/organizations.ts";
import { canonicalHash } from "../src/releases.ts";
import { mentorSeed, mentorNow } from "./mentor-practical-fixture.ts";
import { groupSeed } from "./group-practical-fixture.ts";
const base = "/mentor-practicals/mentor-enrollment";
async function fixture(t: TestContext, objective = false, legacy = false) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-mentor-")),
    file = path.join(dir, "runtime/state.json");
  await new JsonStore(file).initialize(
    legacy ? seedState(true) : mentorSeed(objective),
  );
  const store = await new JsonStore(file).load(),
    app = await buildApp(store, { clock: () => mentorNow });
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const cookies = new Map<string, string>();
  async function call(
    url: string,
    body?: Record<string, unknown>,
    actor = "learner-1",
    status = 200,
    method?: "GET" | "POST" | "PUT" | "PATCH",
    key = randomUUID(),
    contract = "7",
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
      method: method || (body === undefined ? "GET" : "POST"),
      url: "/api" + url,
      headers: {
        cookie: cookies.get(actor)!,
        "idempotency-key": key,
        "x-eks-release-contract": contract,
      },
      ...(body === undefined ? {} : { payload: body }),
    });
    assert.equal(r.statusCode, status, r.body);
    return r.json();
  }
  const current = () => store.snapshot().mentorAttempts.at(-1)!;
  async function submitted() {
    if (!store.snapshot().mentorAssignments.length)
      await call(
        base + "/assign",
        { mentorId: "ft-1", revision: 0, reason: "" },
        "admin-1",
      );
    await call(base + "/start", {});
    await call(base + "/save", {
      attemptId: current().id,
      revision: current().revision,
      answers: { m1: "점검 완료", m2: "측정 완료", m3: "조치 완료" },
    });
    await call(base + "/submit", {
      attemptId: current().id,
      revision: current().revision,
    });
  }
  async function grade(scores = { m1: 20, m2: 30, m3: 50 }, mentor = "ft-1") {
    await call(
      base + "/grade",
      {
        attemptId: current().id,
        revision: current().revision,
        scores,
        feedback: { m1: "정확함" },
        comment: "종합 의견",
      },
      mentor,
    );
    return call(base + "/preview", {}, mentor);
  }
  async function finalize(mentor = "ft-1") {
    const review = await call(base + "/preview", {}, mentor);
    assert.deepEqual(review.blockers, []);
    const body = {
      attemptId: current().id,
      revision: current().revision,
      reviewToken: review.token,
    };
    await call(base + "/finalize", body, mentor);
    return body;
  }
  return { dir, file, app, store, call, current, submitted, grade, finalize };
}
test("필수 다중 실기: 배정·답변·부분 채점·합산·재응시·수료와 인증을 보존한다", async (t) => {
  const f = await fixture(t);
  await f.call(base + "/start", {}, "learner-1", 409);
  await f.call(
    base + "/assign",
    { mentorId: "ft-1", revision: 0, reason: "" },
    "admin-1",
  );
  await f.call(base + "/start", {});
  await f.call(
    base + "/submit",
    { attemptId: f.current().id, revision: 1 },
    "learner-1",
    422,
  );
  await f.call(base + "/save", {
    attemptId: f.current().id,
    revision: 1,
    answers: { m1: "비공개 작성 중" },
  });
  assert.deepEqual(
    (await f.call(base, undefined, "ft-1")).attempts[0].answers,
    {},
  );
  await f.submitted();
  assert.equal(f.store.snapshot().completions.length, 0);
  await f.call(
    base + "/save",
    { attemptId: f.current().id, revision: f.current().revision, answers: {} },
    "learner-1",
    409,
  );
  await f.call(
    base + "/grade",
    {
      attemptId: f.current().id,
      revision: f.current().revision,
      scores: { m1: 21 },
      feedback: {},
      comment: "",
    },
    "ft-1",
    422,
  );
  await f.call(
    base + "/grade",
    {
      attemptId: f.current().id,
      revision: f.current().revision,
      scores: { m1: -1 },
      feedback: {},
      comment: "",
    },
    "ft-1",
    422,
  );
  await f.call(
    base + "/grade",
    {
      attemptId: f.current().id,
      revision: f.current().revision,
      scores: { m1: 20 },
      feedback: {},
      comment: "임시",
    },
    "ft-1",
  );
  const blocked = await f.call(base + "/preview", {}, "ft-1");
  assert.ok(blocked.blockers.length);
  await f.call(
    base + "/finalize",
    {
      attemptId: f.current().id,
      revision: f.current().revision,
      reviewToken: blocked.token,
    },
    "ft-1",
    409,
  );
  const hidden = await f.call(base);
  assert.equal(hidden.attempts.at(-1).grading, undefined);
  assert.equal(
    (await f.call(base, undefined, "admin-1")).attempts.at(-1).grading,
    undefined,
  );
  await f.grade({ m1: 20, m2: 30, m3: 29.99 });
  await f.finalize();
  assert.equal(f.current().earned, 79.99);
  assert.equal(f.current().result, "failed");
  assert.equal(f.store.snapshot().completions.length, 0);
  await f.submitted();
  const review = await f.grade({ m1: 20, m2: 30, m3: 30 });
  assert.equal(review.wouldComplete, true);
  assert.equal(review.wouldCertify, true);
  await f.finalize();
  const s = f.store.snapshot();
  assert.equal(s.mentorAttempts.length, 2);
  assert.equal(s.completions.length, 1);
  assert.equal(s.certifications.length, 1);
  assert.equal(s.completions[0]!.mentorPractical!.earned, 80);
  await f.call(base + "/start", {}, "learner-1", 409);
  await f.call(
    base + "/assign",
    { mentorId: "ft-2", revision: 1, reason: "변경" },
    "admin-1",
    409,
  );
  assert.equal(
    validateState(
      JSON.parse(await readFile(f.file, "utf8")),
      seedOrganizations(),
    ).mentorAttempts.length,
    2,
  );
  validateState(s, seedOrganizations());
});
test("FT 전용 배정 범위·자기 평가·권한 회수·담당 변경과 채점 이력을 보호한다", async (t) => {
  const f = await fixture(t);
  await f.call(base, undefined, "ft-1", 403);
  await f.call(
    base + "/assign",
    { mentorId: "learner-1", revision: 0, reason: "" },
    "admin-1",
    422,
  );
  await f.call(
    base + "/assign",
    { mentorId: "ft-1", revision: 0, reason: "" },
    "learner-1",
    403,
  );
  await f.submitted();
  await f.grade();
  await f.call(
    base + "/grade",
    {
      attemptId: f.current().id,
      revision: f.current().revision,
      scores: {},
      feedback: {},
      comment: "",
    },
    "admin-1",
    403,
  );
  await f.call(base, undefined, "ft-2", 403);
  assert.equal(
    (await f.call("/mentor-practicals", undefined, "ft-1")).rows.length,
    1,
  );
  assert.equal(
    (await f.call("/mentor-practicals", undefined, "ft-2")).rows.length,
    0,
  );
  await f.call(
    base + "/assign",
    { mentorId: "ft-2", revision: 1, reason: "담당 교체" },
    "admin-1",
  );
  assert.equal(f.current().grading, undefined);
  assert.equal(f.current().previousGradings.length, 1);
  await f.call(base + "/preview", {}, "ft-1", 403);
  assert.ok((await f.call(base + "/preview", {}, "ft-2")).blockers.length);
  await f.grade(undefined, "ft-2");
  await f.finalize("ft-2");
  assert.deepEqual((await f.call(base)).attempts[0].previousGradings, []);
});
test("객관식과 실기는 어느 순서든 모두 통과해야 수료된다", async (t) => {
  for (const mentorFirst of [true, false]) {
    const f = await fixture(t, true);
    async function objective() {
      const c = f.store
        .snapshot()
        .courses.find((c) => c.id === "demo-course-1")!;
      const r = await f.call("/enrollments/mentor-enrollment/attempts", {
        kind: "objective",
      });
      await f.call(
        "/attempts/" + r.id + "/draft",
        {
          revision: r.revision,
          answers: Object.fromEntries(
            assessmentQuestions(c, "objective").map((q) => [q.id, q.correct]),
          ),
        },
        "learner-1",
        200,
        "PUT",
      );
      await f.call("/attempts/" + r.id + "/submit", {
        revision: r.revision + 1,
      });
    }
    if (!mentorFirst) await objective();
    await f.submitted();
    await f.grade();
    await f.finalize();
    assert.equal(f.store.snapshot().completions.length, mentorFirst ? 0 : 1);
    if (mentorFirst) await objective();
    assert.equal(f.store.snapshot().completions.length, 1);
    assert.equal(f.store.snapshot().certifications.length, 1);
    assert.equal(f.store.snapshot().completions[0]!.evidence.length, 1);
  }
});
test("중복 확정·동시 변경·저장 실패는 수료와 인증을 중복 발급하지 않는다", async (t) => {
  const f = await fixture(t);
  await f.submitted();
  const old = await f.grade();
  await f.call(
    base + "/grade",
    {
      attemptId: f.current().id,
      revision: f.current().revision,
      scores: { m1: 20, m2: 30, m3: 50 },
      feedback: {},
      comment: "의견 수정",
    },
    "ft-1",
  );
  await f.call(
    base + "/finalize",
    {
      attemptId: f.current().id,
      revision: f.current().revision,
      reviewToken: old.token,
    },
    "ft-1",
    409,
  );
  const review = await f.call(base + "/preview", {}, "ft-1"),
    body = {
      attemptId: f.current().id,
      revision: f.current().revision,
      reviewToken: review.token,
    },
    key = randomUUID(),
    before = f.store.snapshot(),
    bytes = await readFile(f.file);
  f.store.beforeReplace = () => {
    throw Error("injected failure");
  };
  await f.call(base + "/finalize", body, "ft-1", 503, undefined, key);
  assert.deepEqual(f.store.snapshot(), before);
  assert.deepEqual(await readFile(f.file), bytes);
  f.store.beforeReplace = undefined;
  const first = await f.call(
    base + "/finalize",
    body,
    "ft-1",
    200,
    undefined,
    key,
  );
  assert.deepEqual(
    await f.call(base + "/finalize", body, "ft-1", 200, undefined, key),
    first,
  );
  await f.call(base + "/finalize", body, "ft-1", 409);
  assert.equal(f.store.snapshot().certifications.length, 1);
  const mentor = f.store.snapshot().users.find((u) => u.id === "ft-1")!;
  await f.call(
    "/team-users/ft-1",
    {
      name: mentor.name,
      organizationId: mentor.organizationId,
      roles: ["learner"],
      revision: mentor.revision,
      organizationRevision: f.store.organizations.snapshot().revision,
    },
    "admin-1",
    200,
    "PATCH",
  );
  await f.call(base + "/finalize", body, "ft-1", 403, undefined, key);
});
test("명시적 이관은 과거 해시·역할·그룹 데이터를 보존하고 새 구조를 검증한다", () => {
  const org = seedOrganizations(),
    before = seedState(true),
    oldHashes = before.courses.map((c) =>
      canonicalHash(CourseContentSchema.parse(c)),
    ),
    m = migrateMentorPractical(before, org, mentorNow);
  assert.equal(m.state.schemaVersion, 34);
  assert.deepEqual(m.state.users, before.users);
  assert.deepEqual(
    m.state.courses.map((c) => canonicalHash(CourseContentSchema.parse(c))),
    oldHashes,
  );
  assert.equal(
    migrateMentorPractical(m.state, org).report.alreadyApplied,
    true,
  );
  const grouped = groupSeed(),
    both = migrateMentorPractical(grouped, org).state;
  assert.equal(both.groupPracticalEnvironment, "trial");
  assert.deepEqual(both.courses, grouped.courses);
  assert.equal(migrateGroupPractical(both, org).state.schemaVersion, 34);
  const malformed = mentorSeed();
  malformed.schemaVersion = 32;
  assert.throws(() => validateState(malformed, org), /업무34/);
});
test("구형 데이터의 FT 역할·실기 저장과 구형 클라이언트 요청을 차단한다", async (t) => {
  const f = await fixture(t, false, true),
    u = f.store.snapshot().users.find((u) => u.id === "ft-1")!;
  await f.call(
    "/team-users/ft-1",
    {
      name: u.name,
      organizationId: u.organizationId,
      roles: ["learner", "ft"],
      revision: u.revision,
      organizationRevision: f.store.organizations.snapshot().revision,
    },
    "admin-1",
    409,
    "PATCH",
  );
  const c = f.store.snapshot().courses[0]!;
  await f.call(
    "/courses/" + c.id,
    { ...c, mentorPractical: { passScore: 80, questions: [] } },
    "admin-1",
    409,
    "PUT",
  );
  await f.call(
    base + "/start",
    {},
    "learner-1",
    409,
    undefined,
    randomUUID(),
    "6",
  );
});

test("재응시의 동일 revision·동시 초안 저장은 이전 요청으로 덮어쓸 수 없다", async (t) => {
  const f = await fixture(t);
  await f.submitted();
  await f.grade({ m1: 0, m2: 0, m3: 0 });
  await f.finalize();
  const oldId = f.current().id;
  await f.call(base + "/start", {});
  await f.call(
    base + "/save",
    { attemptId: oldId, revision: 1, answers: { m1: "오래된 요청" } },
    "learner-1",
    409,
  );
  const payload = {
    attemptId: f.current().id,
    revision: 1,
    answers: { m1: "보존할 답변" },
  };
  await f.call(base + "/save", payload);
  await f.call(
    base + "/save",
    { ...payload, answers: { m1: "다른 창" } },
    "learner-1",
    409,
  );
  assert.equal(f.current().answers.m1, "보존할 답변");
  await f.call(base + "/save", { revision: 2, answers: {} }, "learner-1", 422);
});

test("새 FT 역할은 명시적으로 부여하고 다른 팀·자기 수강 채점을 금지한다", async (t) => {
  const f = await fixture(t),
    u = f.store.snapshot().users.find((u) => u.id === "learner-1")!;
  await f.call(
    "/team-users/" + u.id,
    {
      name: u.name,
      organizationId: u.organizationId,
      roles: ["learner", "ft"],
      revision: u.revision,
      organizationRevision: f.store.organizations.snapshot().revision,
    },
    "admin-1",
    200,
    "PATCH",
  );
  await f.call(
    base + "/assign",
    { mentorId: u.id, revision: 0, reason: "" },
    "admin-1",
    422,
  );
  const other = organizationEntries(f.store.organizations.snapshot()).find(
    (o) => o.level === 1 && o.id !== "org-photo",
  )!;
  const foreign = await f.call(
    "/system/users",
    { name: "다른 팀 FT", organizationId: other.id, roles: ["ft"] },
    "operator-1",
  );
  await f.call(
    base + "/assign",
    { mentorId: foreign.id, revision: 0, reason: "" },
    "admin-1",
    422,
  );
  await f.call(base, undefined, foreign.id, 403);
  await f.submitted();
  await f.store.transact(
    "operator-1",
    randomUUID(),
    "revoke-ft",
    () => {},
    (s) => {
      s.users.find((u) => u.id === "ft-1")!.roles = ["learner"];
      return {};
    },
  );
  await f.call(
    base + "/grade",
    {
      attemptId: f.current().id,
      revision: f.current().revision,
      scores: { m1: 20 },
      feedback: {},
      comment: "",
    },
    "ft-1",
    403,
  );
  const blocked = await f.call(base);
  assert.ok(blocked.blockers.some((v: string) => v.includes("FT 역할")));
});

test("실기 개정은 새 메이저로 저장하고 기존 수행·합격 근거 위조를 거부한다", async (t) => {
  const f = await fixture(t);
  await f.submitted();
  const original = f.store.snapshot(),
    c = original.courses.find((c) => c.id === "demo-course-1")!;
  const saved = await f.call(
    "/courses/" + c.id,
    { ...c, mentorPractical: { ...c.mentorPractical, passScore: 90 } },
    "admin-1",
    200,
    "PUT",
  );
  assert.deepEqual(saved.releaseVersion, { major: 2, minor: 0 });
  assert.deepEqual(
    f.store.snapshot().courses.find((v) => v.id === c.id),
    c,
  );
  assert.deepEqual(f.store.snapshot().assignments, original.assignments);
  await f.grade({ m1: 20, m2: 30, m3: 30 });
  await f.finalize();
  assert.equal(f.current().passScore, 80);
  for (const mutate of [
    (s: ReturnType<typeof mentorSeed>) => {
      s.mentorAttempts[0]!.earned = 100;
    },
    (s: ReturnType<typeof mentorSeed>) => {
      s.completions[0]!.mentorPractical!.mentorId = "learner-1";
    },
    (s: ReturnType<typeof mentorSeed>) => {
      s.mentorAttempts[0]!.questions[0]!.points = 100;
    },
  ]) {
    const bad = f.store.snapshot();
    mutate(bad);
    assert.throws(
      () => validateState(bad, seedOrganizations()),
      /멘토 실기 무결성/,
    );
  }
});

test("업무34 이관 CLI dry-run·해시 검증과 그룹 백업 묶음 복구", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-mentor-cli-")),
    file = path.join(dir, "runtime/state.json");
  t.after(() => rm(dir, { recursive: true, force: true }));
  await new JsonStore(file).initialize(groupSeed());
  const cli = async (args: string[]) =>
    JSON.parse(
      (
        await promisify(execFile)(
          process.execPath,
          ["--import", "tsx", "server/src/cli.ts", ...args],
          { env: { ...process.env, EKS_DATA_FILE: file } },
        )
      ).stdout,
    );
  const before = await readFile(file),
    plan = await cli(["migrate-mentor-practical", "--dry-run"]);
  assert.equal(plan.schemaVersion, 34);
  assert.deepEqual(await readFile(file), before);
  const args = [
    "migrate-mentor-practical",
    "--apply",
    `--expected-revision=${plan.expectedRevision}`,
    `--expected-sha256=${plan.stateHash}`,
    `--organization-sha256=${plan.organizationHash}`,
  ];
  await assert.rejects(
    cli(
      args.map((v) =>
        v.startsWith("--expected-sha256=")
          ? "--expected-sha256=" + "0".repeat(64)
          : v,
      ),
    ),
  );
  assert.deepEqual(await readFile(file), before);
  await cli(args);
  const store = await new JsonStore(file).load(),
    state = store.snapshot(),
    backup = await store.backup();
  assert.equal(state.schemaVersion, 34);
  assert.equal(state.groupPracticalEnvironment, "trial");
  await store.close();
  assert.equal((await cli(["restore-group", backup])).schemaVersion, 34);
  const loaded = await new JsonStore(file).load();
  assert.deepEqual(loaded.snapshot(), state);
  await loaded.close();
  assert.equal(
    (await cli(["migrate-mentor-practical", "--dry-run"])).alreadyApplied,
    true,
  );
});
