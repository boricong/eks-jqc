import { configureTestPolicies } from "./policy-helpers.ts";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  readdir,
  mkdir,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import {
  defaultPlanningDueOn,
  courseErrors,
  type State,
  assessmentQuestions,
  CourseSchema,
} from "@eks/contracts";
import { seedState } from "../src/seed.ts";
import { seedOrganizations } from "../src/organizations.ts";
import { JsonStore } from "../src/storage.ts";
import { buildApp } from "../src/app.ts";
import {
  transitionAssessments,
  convertCourseFields,
} from "../src/assessment-transition.ts";
import { preparePhotoSetup } from "../src/photo-setup.ts";
import { exportCatalog, prepareCatalog } from "../src/catalog.ts";
import {
  writeCatalogWorkbook,
  readCatalogWorkbook,
} from "../src/catalog-workbook.ts";
import { writeCatalogWorkbook as writeLegacy } from "../src/catalog-workbook-legacy.ts";
import { migrateState } from "../src/migration.ts";
const org = seedOrganizations(),
  hash = (v: Buffer | string) => createHash("sha256").update(v).digest("hex");
function legacy() {
  const original = seedState(true);
  original.qualifications.push({
    ...original.qualifications.find((q) => q.id === "demo-qualification")!,
    id: "bad-backup",
    entityId: "bad-backup",
    title: "설비 Backup 검증 자격",
    templateId: "eqp-backup",
    courseIds: ["recipe-create"],
  });
  const s: any = preparePhotoSetup(
    original,
    org,
    "operator-1",
    "2026-10-21T00:00:00Z",
  ).state;
  s.schemaVersion = 5;
  s.revision = 140;
  for (const c of s.courses) {
    c.material = c.materials[0]?.content || "";
    c.materialUrl = "";
    delete c.materials;
    c.practicalItems = [
      {
        id: "legacy-" + c.id,
        title: "관찰",
        criterion: "관찰 기록",
        mandatory: true,
      },
    ];
    delete c.practicalQuestions;
    delete c.practicalPassScore;
    c.subjectiveQuestions = [];
    c.subjectivePassScore = 100;
    c.assessmentKinds = ["objective", "subjective", "practical"];
    c.questions.forEach((q: any) => (q.category = "case"));
  }
  s.users.find((u: any) => u.id === "ft-1").roles = ["ft"];
  s.users.find((u: any) => u.id === "ft-2").roles = ["ft"];
  s.users.find((u: any) => u.id === "admin-1").roles = ["admin", "ft"];
  s.plans = [{ id: "deleted-progress" }];
  s.requests = [
    {
      actorId: "admin-1",
      key: "criterion",
      fingerprint: "x",
      response: { id: s.courses[0].id },
      date: "2026-10-21T00:00:00Z",
      action: "catalog.create",
    },
    {
      actorId: "learner-1",
      key: "progress",
      fingerprint: "y",
      response: { id: "old" },
      date: "2026-10-21T00:00:00Z",
      action: "plan.create",
    },
  ];
  return s;
}
async function fixture(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-six-")),
    file = path.join(dir, "runtime", "state.json");
  await new JsonStore(file).initialize(seedState(true));
  const store = await new JsonStore(file).load();
  await configureTestPolicies(store);
  let at = "2026-10-21T14:59:59Z";
  const app = await buildApp(store, { clock: () => at });
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const cookies = new Map<string, string>();
  const call = async (
    actor: string,
    url: string,
    body?: any,
    status = 200,
    method?: any,
    key = randomUUID(),
  ) => {
    if (!cookies.has(actor)) {
      const l = await app.inject({
        method: "POST",
        url: "/api/session",
        payload: { actorId: actor },
      });
      cookies.set(actor, `${l.cookies[0]!.name}=${l.cookies[0]!.value}`);
    }
    const r = await app.inject({
      method: method || (body === undefined ? "GET" : "POST"),
      url: "/api" + url,
      headers: { cookie: cookies.get(actor)!, "idempotency-key": key },
      ...(body === undefined ? {} : { payload: body }),
    });
    assert.equal(r.statusCode, status, r.body);
    return r.json();
  };
  return { dir, file, store, call, clock: (v: string) => (at = v) };
}
test("전환은 계정 ID·소속과 15자격·75과정 연결을 보존하고 450문항으로 재구성한다", () => {
  const raw = legacy(),
    before = structuredClone(raw),
    { state: s, report } = transitionAssessments(raw, org);
  assert.deepEqual(raw, before);
  assert.equal(report.backupCreated, false);
  assert.equal(s.schemaVersion, 6);
  assert.equal(s.courses.length, 75);
  assert.equal(
    s.courses.reduce(
      (n, c) => n + c.questions.length + c.practicalQuestions.length,
      0,
    ),
    450,
  );
  assert.deepEqual(s.qualifications, before.qualifications);
  for (const u of s.users) {
    assert.equal(
      u.organizationId,
      before.users.find((x: any) => x.id === u.id).organizationId,
    );
    assert.ok(!u.roles.some((r) => String(r) === "ft"));
  }
  assert.deepEqual(s.users.find((u) => u.id === "ft-1")!.roles, ["learner"]);
  assert.deepEqual(s.users.find((u) => u.id === "admin-1")!.roles, ["admin"]);
  assert.equal(s.plans.length, 0);
  assert.deepEqual(
    s.requests.map((r) => r.key),
    ["criterion"],
  );
  assert.deepEqual(transitionAssessments(s, org).state, s);
});
test("Photo 정답 표기와 실제 정답·배점이 일치하고 지식 내용은 분류만 제거된다", () => {
  const raw = legacy(),
    s = transitionAssessments(raw, org).state;
  for (const c of s.courses) {
    assert.deepEqual(
      c.questions,
      raw.courses
        .find((v: any) => v.id === c.id)
        .questions.map(({ category, ...q }: any) => q),
    );
    for (const q of c.practicalQuestions) {
      const m = /\[테스트 정답: (\d+)번 (.+)\]$/.exec(q.prompt)!;
      assert.ok(q.scenario.startsWith("가상 사례"));
      assert.equal(Number(m[1]) - 1, q.correct);
      assert.equal(m[2], q.choices[q.correct!]);
    }
    assert.deepEqual(courseErrors(c), []);
  }
});
test("변환 전 참조 오류·예상 외 실기·일괄 개정안은 원본을 변경하지 않고 중단한다", () => {
  for (const damage of [
    (s: any) => s.qualifications[0].courseIds.push("missing"),
    (s: any) => (s.courses[0].id = "unexpected"),
    (s: any) => s.catalogBatches.push({ id: "pending" }),
  ]) {
    const s = legacy();
    damage(s);
    const before = structuredClone(s);
    assert.throws(() => transitionAssessments(s, org));
    assert.deepEqual(s, before);
  }
});
test("명시적 전환만 허용하며 정상 시작과 일반 이관은 구형 데이터를 초기화하지 않는다", async (t) => {
  const f = await fixture(t);
  assert.throws(() => migrateState(legacy(), org), /명시적/);
  assert.deepEqual(migrateState(f.store.snapshot(), org), f.store.snapshot());
});
test("종료된 무백업 전환은 원본·조직·백업을 변경하지 않고 거부한다", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-six-migration-")),
    file = path.join(dir, "runtime", "state.json"),
    orgFile = path.join(dir, "master", "organizations.json");
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.dirname(file), { recursive: true });
  await mkdir(path.dirname(orgFile), { recursive: true });
  const raw = legacy(),
    bytes = JSON.stringify(raw),
    orgBytes = JSON.stringify(org);
  await writeFile(file, bytes);
  await writeFile(orgFile, orgBytes);
  await assert.rejects(
    new JsonStore(file).transitionWithoutBackup(
      139,
      hash(bytes),
      transitionAssessments,
    ),
  );
  assert.equal(await readFile(file, "utf8"), bytes);
  await assert.rejects(
    new JsonStore(file).transitionWithoutBackup(
      140,
      hash(bytes),
      transitionAssessments,
    ),
    /일회성 예외가 종료/,
  );
  assert.equal(await readFile(file, "utf8"), bytes);
  assert.equal(await readFile(orgFile, "utf8"), orgBytes);
  await assert.rejects(readdir(path.join(dir, "backups")), { code: "ENOENT" });
});
test("전환 후 새 진행은 전환 명령 재실행에 의해 삭제되지 않는다", () => {
  const s = transitionAssessments(legacy(), org).state;
  s.planningRequests.push({
    id: "new",
    learnerId: "learner-1",
    lv1OrganizationId: "org-photo",
    requestedBy: "admin-1",
    dueOn: "2026-11-18",
    message: "",
    createdAt: "2026-10-21T00:00:00Z",
    revision: 1,
  });
  assert.equal(transitionAssessments(s, org).state.planningRequests.length, 1);
});
test("폐지된 FT 역할·FT 변경·주관식 확정·구형 필드를 직접 호출해도 처리하지 않는다", async (t) => {
  const f = await fixture(t);
  await f.call(
    "operator-1",
    "/system/users",
    { name: "obsolete", organizationId: "org-photo", roles: ["ft"] },
    422,
  );
  await f.call(
    "admin-1",
    "/assignments/assignment-1/ft",
    { revision: 1, ftId: "ft-1" },
    410,
  );
  await f.call(
    "learner-1",
    "/attempts/attempt-1/grading/finalize",
    { revision: 1 },
    410,
  );
  await f.call(
    "learner-1",
    "/enrollments/assignment-1:demo-course-2/attempts",
    { kind: "subjective" },
    422,
  );
  await f.call(
    "admin-1",
    "/planning-requests",
    { learnerIds: ["learner-2"], ftId: null, dueOn: "2026-11-18", message: "" },
    422,
  );
});
test("두 평가의 정답은 학습자에게 숨기고 관리자에게만 제공한다", async (t) => {
  const f = await fixture(t),
    view = await f.call("learner-1", "/workspace"),
    admin = await f.call("admin-1", "/workspace");
  for (const c of view.courses)
    for (const q of [...c.questions, ...c.practicalQuestions])
      assert.ok(!("correct" in q));
  assert.ok(
    admin.courses[0].practicalQuestions.every((q: any) => "correct" in q),
  );
  assert.equal((await f.call("ft-1", "/session")).actor.roles[0], "learner");
});
test("자기 응시만 저장하며 관리자·이전 FT도 다른 학습자 대신 제출할 수 없다", async (t) => {
  const f = await fixture(t),
    a = await f.call(
      "learner-1",
      "/enrollments/assignment-1:demo-course-2/attempts",
      { kind: "objective" },
    );
  for (const actor of ["ft-1", "admin-1", "operator-1", "learner-2"]) {
    await f.call(
      actor,
      `/attempts/${a.id}/draft`,
      { revision: 1, answers: {} },
      403,
      "PUT",
    );
    await f.call(actor, `/attempts/${a.id}/submit`, { revision: 1 }, 403);
  }
  await f.call(
    "learner-1",
    `/attempts/${a.id}/draft`,
    { revision: 1, answers: {}, verdicts: {} },
    422,
    "PUT",
  );
});
test("새 문항 정답·합격 기준은 미정이며 상황 설명 없이는 사용 등록되지 않는다", async (t) => {
  const f = await fixture(t),
    created = await f.call("admin-1", "/courses", {}),
    draft = f.store.snapshot().courses.find((c) => c.id === created.id)!;
  assert.equal(draft.passScore, null);
  assert.equal(draft.practicalPassScore, null);
  const c = {
    ...draft,
    title: "상황",
    assessmentKinds: ["objective", "practical"],
    passScore: 100,
    questions: [
      {
        id: "k",
        prompt: "기준 확인",
        choices: ["확인", "생략"],
        correct: 0,
        points: 1,
      },
    ],
    learningItems: [{ id: "l", type: "ojt", title: "연습", required: true }],
    practicalPassScore: 70,
    practicalQuestions: [
      {
        id: "p",
        scenario: "",
        prompt: "대응",
        choices: ["확인", "생략"],
        correct: 0,
        points: 1,
      },
    ],
  };
  const saved = await f.call("admin-1", `/courses/${c.id}`, c, 200, "PUT");
  assert.ok(saved.readiness.some((m: string) => m.includes("상황")));
  c.revision = saved.revision;
  c.practicalQuestions[0]!.scenario = "가상 이상 발생";
  await f.call("admin-1", `/courses/${c.id}`, c, undefined, "PUT");
});
test("유형별 합격 기준을 독립 적용하고 통과한 유형의 추가 응시는 막는다", async (t) => {
  const f = await fixture(t),
    e = "assignment-1:demo-course-2";
  for (const kind of ["objective", "practical"] as const) {
    const a = await f.call("learner-1", `/enrollments/${e}/attempts`, { kind }),
      c = f.store.snapshot().courses.find((c) => c.id === "demo-course-2")!,
      qs = assessmentQuestions(c, kind);
    const answers = Object.fromEntries(
      qs.map((q, i) => [
        q.id,
        kind === "practical" && i === 0
          ? (q.correct! + 1) % q.choices.length
          : q.correct,
      ]),
    );
    await f.call(
      "learner-1",
      `/attempts/${a.id}/draft`,
      { revision: 1, answers },
      200,
      "PUT",
    );
    const r = await f.call("learner-1", `/attempts/${a.id}/submit`, {
      revision: 2,
    });
    assert.equal(r.result, kind === "objective" ? "passed" : "failed");
  }
  await f.call(
    "learner-1",
    `/enrollments/${e}/attempts`,
    { kind: "objective" },
    409,
  );
  assert.equal(
    (
      await f.call("learner-1", `/enrollments/${e}/attempts`, {
        kind: "practical",
      })
    ).revision,
    1,
  );
});
test("계획 작성 기한은 요청 시 KST +28일이며 수동값·빈 값·재시도를 구분한다", async (t) => {
  const f = await fixture(t),
    body = { learnerIds: ["learner-2"], message: "" };
  assert.equal(
    (await f.call("admin-1", "/workspace")).serverDate,
    "2026-10-21",
  );
  f.clock("2026-10-21T15:00:00Z");
  const key = randomUUID(),
    r = await f.call("admin-1", "/planning-requests", body, 200, "POST", key);
  assert.equal(f.store.snapshot().planningRequests.at(-1)!.dueOn, "2026-11-19");
  f.clock("2026-10-22T15:00:00Z");
  assert.deepEqual(
    await f.call("admin-1", "/planning-requests", body, 200, "POST", key),
    r,
  );
  await f.call("admin-1", "/planning-requests", {
    ...body,
    dueOn: "2026-12-31",
  });
  assert.equal(f.store.snapshot().planningRequests.at(-1)!.dueOn, "2026-12-31");
  await f.call("admin-1", "/planning-requests", { ...body, dueOn: "" }, 422);
});
test("계획 요청 기본일은 월말·연말·윤년과 KST 자정에서 정확하다", () => {
  for (const [at, date] of [
    ["2026-12-20T12:00:00Z", "2027-01-17"],
    ["2028-02-01T00:00:00Z", "2028-02-29"],
    ["2026-10-21T14:59:59Z", "2026-11-18"],
    ["2026-10-21T15:00:00Z", "2026-11-19"],
  ])
    assert.equal(defaultPlanningDueOn(at!), date);
});
test("기존 본문과 URL은 별도 자료로 변환하고 링크 종류를 추정하지 않는다", () => {
  const c = convertCourseFields({
    id: "c",
    assessmentKinds: ["objective"],
    questions: [],
    material: "한글 본문",
    materialUrl: "https://confluence.example/wiki",
  });
  assert.deepEqual(
    c.materials.map((m: any) => m.type),
    ["text", "url"],
  );
  assert.equal(c.materials[0].content, "한글 본문");
});
test("자료 4유형·순서·추가 선택지 50개는 Excel v3 왕복에서 보존된다", async () => {
  const s = seedState(true),
    c = s.courses[0]!;
  c.materials = ["text", "edm", "confluence", "url"].map((type, i) => ({
    id: "m" + i,
    type: type as any,
    title: "자료" + i,
    content: type === "text" ? "한글\n본문" : "",
    url: type === "text" ? "" : `https://example.com/${i}`,
    description: "설명",
  }));
  c.practicalQuestions[0]!.choices = Array.from(
    { length: 50 },
    (_, i) => "대응" + i,
  );
  c.practicalQuestions[0]!.correct = 49;
  const w = exportCatalog(s, "org-photo", ["demo-qualification"]),
    p = await readCatalogWorkbook(await writeCatalogWorkbook(w));
  assert.deepEqual(p.issues, []);
  assert.equal(p.workbook.sheets[0]!.tables.practical[0]!.choice50, "대응49");
  assert.ok(
    prepareCatalog(s, p.workbook, "org-photo").changes.every(
      (c) => c.kind === "unchanged",
    ),
  );
});
test("자료 필수값과 HTTP(S)만 허용하며 정답 없는 문항은 사용 등록을 막는다", () => {
  const c = seedState(true).courses[0]!;
  c.materials = [
    {
      id: "m",
      type: "edm",
      title: "EDM",
      content: "",
      url: "javascript:alert(1)",
      description: "",
    },
  ];
  assert.ok(!CourseSchema.safeParse(c).success);
  c.materials[0]!.url = "";
  assert.ok(courseErrors(c).length);
  c.materials = [];
  c.practicalQuestions[0]!.correct = null;
  assert.ok(courseErrors(c).some((e) => e.includes("정답")));
});
for (const version of [1, 2] as const)
  test(`구형 Excel v${version}은 주관식·관찰식 실기를 오류 위치와 함께 보존 검토하고 저장 차단`, async () => {
    const s = seedState(true),
      w: any = exportCatalog(s, "org-photo", ["demo-qualification"]);
    w.format = "eks-catalog-v1";
    for (const q of w.sheets) {
      q.tables.subjective = [];
      delete q.tables.materials;
      for (const c of q.tables.courses) {
        c.subjectivePassScore = null;
        c.material = "본문";
        c.materialUrl = "https://example.com";
        c.instruction = "관찰";
        delete c.practicalPassScore;
      }
      q.tables.objective.forEach((r: any) => (r.category = "written"));
      q.tables.practical = [
        {
          courseCode: q.tables.courses[0].code,
          code: "P",
          order: 1,
          title: "관찰 항목",
          criterion: "근거",
          mandatory: true,
        },
      ];
    }
    const p = await readCatalogWorkbook(await writeLegacy(w, [], version));
    assert.ok(p.issues.some((i) => i.cell && i.message.includes("관찰식")));
    assert.ok(p.workbook.sheets[0]!.legacyUnsupported);
    assert.ok(
      prepareCatalog(s, p.workbook, "org-photo").issues.some(
        (i) => i.severity === "structure",
      ),
    );
  });
