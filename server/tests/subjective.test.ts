import { historicalContent } from "./historical-content.ts";
import { legacyPlanFixture } from "./legacy-plan-fixture.ts";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { courseUseErrors, assessmentQuestions } from "@eks/contracts";
import { seedState } from "../src/seed.ts";
import { seedOrganizations } from "../src/organizations.ts";
import { JsonStore } from "../src/storage.ts";
import { buildApp } from "./release-test-app.ts";
import { migrateSubjective } from "../src/subjective-migration.ts";
import { validateState } from "../src/integrity.ts";
import { courseContentHash } from "../src/common-courses.ts";
import { exportMaster, readMaster, contentHash } from "./legacy-master-data.ts";
const enrollment = "assignment-1:demo-course-2";
async function fixture(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-subjective-"));
  const file = path.join(dir, "runtime/state.json");
  const initial = seedState(true),
    c = initial.courses.find((c) => c.id === "demo-course-2")!;
  c.subjectiveEnabled = true;
  c.subjectiveQuestions = [
    { id: "essay-1", prompt: "문제를 설명하세요." },
    { id: "essay-2", prompt: "대응 방안을 작성하세요." },
  ];
  await new JsonStore(file).initialize(initial);
  const store = await new JsonStore(file).load(),
    app = await buildApp(store);
  const cookies = new Map<string, string>();
  async function call(
    who: string,
    url: string,
    body?: any,
    status = 200,
    method?: any,
    key = randomUUID(),
  ) {
    if (!cookies.has(who)) {
      const r = await app.inject({
        method: "POST",
        url: "/api/session",
        payload: { actorId: who },
      });
      cookies.set(who, `${r.cookies[0]!.name}=${r.cookies[0]!.value}`);
    }
    const r = await app.inject({
      method: method || (body === undefined ? "GET" : "POST"),
      url: "/api" + url,
      headers: { cookie: cookies.get(who)!, "idempotency-key": key },
      ...(body === undefined ? {} : { payload: body }),
    });
    assert.equal(r.statusCode, status, r.body);
    return r.json();
  }
  const start = () =>
    call("learner-1", `/enrollments/${enrollment}/subjective-response`, {});
  const change = async (fn: (s: ReturnType<typeof seedState>) => void) =>
    store.transact(
      "operator-1",
      randomUUID(),
      "test",
      () => {},
      (s) => {
        fn(s);
        return {};
      },
    );
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, file, store, app, call, start, change };
}
test("주관식 조회는 무변경이며 초안 비공개·본문 검증·전 문항 제출·재시도·제출 잠금을 지킨다", async (t) => {
  const f = await fixture(t),
    before = await readFile(f.file);
  await f.call("learner-1", `/enrollments/${enrollment}/subjective-response`);
  assert.deepEqual(await readFile(f.file), before);
  const r = await f.start();
  const again = await f.start();
  assert.equal(r.id, again.id);
  await f.call("admin-1", `/subjective-responses/${r.id}`, undefined, 403);
  await f.call("operator-1", `/subjective-responses/${r.id}`, undefined, 403);
  await f.call("learner-2", `/subjective-responses/${r.id}`, undefined, 403);
  await f.call(
    "learner-1",
    `/subjective-responses/${r.id}/draft`,
    { revision: 1, answers: { "essay-1": "비공개 초안" } },
    200,
    "PUT",
  );
  const own = await f.call("learner-1", "/workspace");
  assert.ok(!JSON.stringify(own).includes("비공개 초안"));
  const admin = await f.call("admin-1", "/workspace");
  assert.ok(!JSON.stringify(admin).includes("비공개 초안"));
  await f.call(
    "learner-1",
    `/subjective-responses/${r.id}/submit`,
    { revision: 2 },
    422,
  );
  for (const body of [
    { revision: 2, answers: { forged: "답변" } },
    { revision: 2, answers: { "essay-1": "x".repeat(20001) } },
    { revision: 2, answers: {}, earned: 100 },
  ])
    await f.call(
      "learner-1",
      `/subjective-responses/${r.id}/draft`,
      body,
      422,
      "PUT",
    );
  await f.call(
    "learner-1",
    `/subjective-responses/${r.id}/draft`,
    { revision: 1, answers: {} },
    409,
    "PUT",
  );
  await f.call(
    "learner-1",
    `/subjective-responses/${r.id}/draft`,
    {
      revision: 2,
      answers: { "essay-1": "첫 답변\n두 줄", "essay-2": "두 번째 답변" },
    },
    200,
    "PUT",
  );
  const key = randomUUID(),
    body = { revision: 3 };
  const result = await f.call(
    "learner-1",
    `/subjective-responses/${r.id}/submit`,
    body,
    200,
    "POST",
    key,
  );
  assert.deepEqual(
    await f.call(
      "learner-1",
      `/subjective-responses/${r.id}/submit`,
      body,
      200,
      "POST",
      key,
    ),
    result,
  );
  for (const who of ["admin-1", "operator-1", "learner-1"]) {
    const v = await f.call(who, `/subjective-responses/${r.id}`);
    assert.equal(v.response.status, "submitted");
    assert.equal(v.response.answers["essay-2"], "두 번째 답변");
  }
  await f.call(
    "learner-1",
    `/subjective-responses/${r.id}/draft`,
    { revision: 4, answers: {} },
    409,
    "PUT",
  );
  assert.equal(f.store.snapshot().subjectiveResponses.length, 1);
  assert.ok(!JSON.stringify(f.store.snapshot().audits).includes("비공개 초안"));
});
test("미제출 주관식은 자동 평가·수료를 막지 않으며 수료가 먼저면 이후 초안 저장·제출을 막는다", async (t) => {
  const f = await fixture(t),
    r = await f.start();
  await f.call(
    "learner-1",
    `/subjective-responses/${r.id}/draft`,
    {
      revision: 1,
      answers: { "essay-1": "보존 답변", "essay-2": "보존 답변" },
    },
    200,
    "PUT",
  );
  const c = f.store.snapshot().courses.find((c) => c.id === "demo-course-2")!;
  for (const kind of c.assessmentKinds) {
    const a = await f.call("learner-1", `/enrollments/${enrollment}/attempts`, {
      kind,
    });
    const answers = Object.fromEntries(
      assessmentQuestions(c, kind).map((q) => [q.id, q.correct]),
    );
    const saved = await f.call(
      "learner-1",
      `/attempts/${a.id}/draft`,
      { revision: a.revision, answers },
      200,
      "PUT",
    );
    await f.call("learner-1", `/attempts/${a.id}/submit`, {
      revision: saved.revision,
    });
  }
  assert.ok(
    f.store.snapshot().completions.some((c) => c.enrollmentId === enrollment),
  );
  const v = await f.call("learner-1", `/subjective-responses/${r.id}`);
  assert.equal(v.status, "closed");
  assert.equal(v.response.answers["essay-1"], "보존 답변");
  await f.call(
    "learner-1",
    `/subjective-responses/${r.id}/submit`,
    { revision: 2 },
    409,
  );
  await f.call(
    "learner-1",
    `/subjective-responses/${r.id}/draft`,
    { revision: 2, answers: {} },
    409,
    "PUT",
  );
  await f.call("admin-1", `/subjective-responses/${r.id}`, undefined, 403);
});
test("주관식 미완성은 준비 상태를 바꾸지 않으며 Hold·타인·Auditor와 채점 API를 차단한다", async (t) => {
  const f = await fixture(t),
    c = f.store.snapshot().courses.find((c) => c.id === "demo-course-2")!,
    baseline = courseUseErrors(c);
  await f.change((s) => {
    s.courses.find(
      (c) => c.id === "demo-course-2",
    )!.subjectiveQuestions[0]!.prompt = "";
  });
  assert.deepEqual(
    courseUseErrors(f.store.snapshot().courses.find((x) => x.id === c.id)!),
    baseline,
  );
  await f.call(
    "learner-1",
    `/enrollments/${enrollment}/subjective-response`,
    {},
    409,
  );
  await f.call(
    "admin-1",
    `/enrollments/${enrollment}/subjective-response`,
    {},
    403,
  );
  await f.change((s) => {
    s.courses.find((x) => x.id === c.id)!.subjectiveQuestions[0]!.prompt =
      "문제";
    s.users.find((u) => u.id === "learner-1")!.certificationEligibility =
      "hold";
  });
  await f.call(
    "learner-1",
    `/enrollments/${enrollment}/subjective-response`,
    {},
    409,
  );
  await f.call("admin-1", "/attempts/not-existing/grading/finalize", {}, 410);
  const invalid = structuredClone(f.store.snapshot());
  invalid.courses.find((x) => x.id === c.id)!.qualificationType = "auditor";
  assert.throws(() => validateState(invalid, f.store.organizations.snapshot()));
  await f.call(
    "operator-1",
    "/system/common-courses",
    {
      title: "Auditor 주관식 거부",
      qualificationType: "auditor",
      subjectiveEnabled: true,
      subjectiveQuestions: [{ id: "q", prompt: "문제" }],
    },
    422,
  );
});
test("업무21→22는 기존 기록·공통 기준 해시를 보존하며 재이관과 JSON12/11 호환·초안 제외를 지원한다", () => {
  const state = seedState(true),
    org = seedOrganizations(),
    raw: any = structuredClone(state);
  raw.schemaVersion = 21;
  legacyPlanFixture(raw);
  delete raw.subjectiveResponses;
  for (const c of raw.courses) {
    delete c.subjectiveEnabled;
    delete c.subjectiveQuestions;
  }
  const before = structuredClone(raw),
    hashes = raw.courses.map(courseContentHash);
  const result = migrateSubjective(raw, org);
  assert.equal(result.state.schemaVersion, 28);
  assert.equal(result.state.revision, raw.revision + 7);
  assert.deepEqual(result.state.courses.map(courseContentHash), hashes);
  for (const key of Object.keys(before))
    if (
      ![
        "schemaVersion",
        "revision",
        "audits",
        "courses",
        "commonCourses",
      ].includes(key)
    )
      assert.deepEqual(
        historicalContent((result.state as any)[key]),
        historicalContent(before[key]),
        key,
      );
  assert.deepEqual(migrateSubjective(result.state, org).state, result.state);
  assert.deepEqual(raw, before);
  const file = exportMaster(result.state, org, new Date().toISOString());
  assert.equal(file.formatVersion, 15);
  assert.deepEqual(readMaster(file).payload, file.payload);
  assert.ok(!("subjectiveResponses" in file.payload));
  const old: any = structuredClone(file);
  old.formatVersion = 11;
  old.stateSchemaVersion = 21;
  delete old.counts.organizationQualificationRequirements;
  delete old.counts.organizationQualificationRequirements;
  delete old.counts.subjectiveQuestions;
  for (const c of old.payload.courses) {
    delete c.subjectiveEnabled;
    delete c.subjectiveQuestions;
  }
  old.sha256 = contentHash(old.payload);
  assert.equal(readMaster(old).formatVersion, 15);
  old.payload.courses[0].subjectiveEnabled = true;
  old.sha256 = contentHash(old.payload);
  assert.throws(() => readMaster(old));
  const forged = structuredClone(result.state);
  forged.courses[0]!.subjectiveQuestions = [
    { id: "q", prompt: "a" },
    { id: "q", prompt: "b" },
  ];
  assert.throws(() => validateState(forged, org));
});

test("공통 주관식 사본은 문항 ID·내용이 독립적이며 원본·다른 사본과 팀 수정 표시를 보존한다", async () => {
  const { copyCommonCourses, teamCourseModified, saveCommonCourse } =
    await import("../src/common-courses.ts");
  const s = seedState(true),
    c = s.courses[0]!;
  const original = saveCommonCourse(s, "operator-1", undefined, {
    title: "공통 주관식",
    qualificationType: "auditee",
    assessmentKinds: c.assessmentKinds,
    learningItems: c.learningItems,
    materials: c.materials,
    questions: c.questions,
    practicalQuestions: c.practicalQuestions,
    passScore: c.passScore,
    practicalPassScore: c.practicalPassScore,
    subjectiveEnabled: true,
    subjectiveQuestions: [{ id: "source-essay", prompt: "공통 문제" }],
  });
  const [a] = copyCommonCourses(s, [original.id], "org-photo"),
    [b] = copyCommonCourses(s, [original.id], "org-photo");
  assert.notEqual(a!.subjectiveQuestions[0]!.id, b!.subjectiveQuestions[0]!.id);
  assert.notEqual(a!.subjectiveQuestions[0]!.id, "source-essay");
  assert.equal(teamCourseModified(a!), false);
  a!.subjectiveQuestions[0]!.prompt = "팀 수정";
  assert.equal(teamCourseModified(a!), true);
  assert.equal(b!.subjectiveQuestions[0]!.prompt, "공통 문제");
  assert.equal(s.commonCourses[0]!.subjectiveQuestions[0]!.prompt, "공통 문제");
  a!.subjectiveQuestions[0]!.prompt = "공통 문제";
  assert.equal(teamCourseModified(a!), false);
});

test("주관식 저장 실패·동시 제출은 부분 기록과 중복을 만들지 않는다", async (t) => {
  const f = await fixture(t),
    r = await f.start(),
    body = { revision: 1, answers: { "essay-1": "답변1", "essay-2": "답변2" } },
    key = randomUUID();
  const before = f.store.snapshot(),
    disk = await readFile(f.file);
  f.store.beforeReplace = () => {
    throw Error("disk failure");
  };
  await f.call(
    "learner-1",
    `/subjective-responses/${r.id}/draft`,
    body,
    503,
    "PUT",
    key,
  );
  assert.deepEqual(f.store.snapshot(), before);
  assert.deepEqual(await readFile(f.file), disk);
  f.store.beforeReplace = undefined;
  await f.call(
    "learner-1",
    `/subjective-responses/${r.id}/draft`,
    body,
    200,
    "PUT",
    key,
  );
  const k = randomUUID();
  const results = await Promise.all([
    f.call(
      "learner-1",
      `/subjective-responses/${r.id}/submit`,
      { revision: 2 },
      200,
      "POST",
      k,
    ),
    f.call(
      "learner-1",
      `/subjective-responses/${r.id}/submit`,
      { revision: 2 },
      200,
      "POST",
      k,
    ),
  ]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(
    f.store.snapshot().audits.filter((a) => a.action === "subjective.submit")
      .length,
    1,
  );
});

test("주관식 명시 이관의 해시 충돌·파일 교체 실패는 세 원본을 보존하고 반복 실행은 무변경이다", async (t) => {
  const { writeFile } = await import("node:fs/promises");
  const dir = await mkdtemp(path.join(tmpdir(), "eks-subjective-migrate-")),
    file = path.join(dir, "runtime/state.json");
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new JsonStore(file);
  await store.initialize(seedState(true));
  const loaded = await new JsonStore(file).load();
  await loaded.close();
  const old: any = seedState(true);
  old.schemaVersion = 21;
  legacyPlanFixture(old);
  delete old.subjectiveResponses;
  for (const c of old.courses) {
    delete c.subjectiveEnabled;
    delete c.subjectiveQuestions;
  }
  await writeFile(file, JSON.stringify(old));
  const files = [file, store.organizations.file, store.maintenanceFile],
    before = await Promise.all(files.map((f) => readFile(f))),
    hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const expected = {
    revision: old.revision,
    stateHash: hash(before[0]!),
    organizationHash: hash(before[1]!),
  };
  await assert.rejects(new JsonStore(file).load(), /data:migrate-subjective/);
  await assert.rejects(
    new JsonStore(file).migratePolicies(
      { ...expected, stateHash: "0".repeat(64) },
      migrateSubjective,
    ),
  );
  const failed = new JsonStore(file);
  failed.beforeReplace = () => {
    throw Error("replace");
  };
  await assert.rejects(failed.migratePolicies(expected, migrateSubjective));
  assert.deepEqual(await Promise.all(files.map((f) => readFile(f))), before);
  await new JsonStore(file).migratePolicies(
    expected,
    migrateSubjective,
    "subjective",
  );
  const after = await Promise.all(files.map((f) => readFile(f)));
  await new JsonStore(file).migratePolicies(
    {
      ...expected,
      revision: JSON.parse(after[0]!.toString()).revision,
      stateHash: hash(after[0]!),
    },
    migrateSubjective,
    "subjective",
  );
  assert.deepEqual(await Promise.all(files.map((f) => readFile(f))), after);
  assert.deepEqual(after[1], before[1]);
});
