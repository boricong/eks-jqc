import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  assessmentQuestions,
  courseUseErrors,
  qualificationUseErrors,
  organizationEntries,
  CourseContentSchema,
  TestDataReceiptSchema,
} from "@eks/contracts";
import { seedState } from "../src/seed.ts";
import { seedOrganizations } from "../src/organizations.ts";
import { JsonStore } from "../src/storage.ts";
import { buildApp } from "../src/app.ts";
import {
  resetTestData,
  loadTestData,
  testDataCounts,
  testDataStatus,
} from "../src/test-data.ts";
import { TEST_DATA_TEMPLATES } from "../src/test-data-templates.ts";
import { validateState } from "../src/integrity.ts";
import { criteriaFingerprint } from "../src/releases.ts";
import { saveCommonCourse } from "../src/common-courses.ts";

async function fixture(t: TestContext, legacy = false) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-test-data-")),
    file = path.join(dir, "runtime/state.json");
  await new JsonStore(file).initialize(seedState(true));
  let initial = await new JsonStore(file).load();
  await initial.close();
  if (legacy) {
    const metadataFile = `${file}.maintenance.json`,
      metadata = JSON.parse(await readFile(metadataFile, "utf8"));
    metadata.testEnvironment = {
      original: seedState(true),
      owned: ["legacy-private-business-snapshot"],
    };
    await writeFile(metadataFile, JSON.stringify(metadata));
  }
  let now = "2026-10-27T01:00:00.000Z",
    store = await new JsonStore(file).load(),
    app = await buildApp(store, { clock: () => now });
  const cookies = new Map<string, string>();
  async function login(who = "operator-1") {
    const r = await app.inject({
      method: "POST",
      url: "/api/session",
      payload: { actorId: who },
    });
    assert.equal(r.statusCode, 200, r.body);
    const cookie = `${r.cookies[0]!.name}=${r.cookies[0]!.value}`;
    cookies.set(who, cookie);
    return cookie;
  }
  async function call(
    who: string,
    url: string,
    body?: any,
    status = 200,
    method = body === undefined ? "GET" : "POST",
    key = randomUUID(),
  ) {
    if (!cookies.has(who)) await login(who);
    const r = await app.inject({
      method: method as any,
      url: `/api${url}`,
      headers: {
        cookie: cookies.get(who)!,
        "idempotency-key": key,
        "x-eks-release-contract": "2",
      },
      ...(body === undefined ? {} : { payload: body }),
    });
    assert.equal(r.statusCode, status, `${who} ${url}: ${r.body}`);
    return r.json();
  }
  async function apply(action: "load" | "reset") {
    const p = await call("operator-1", "/system/test-data/preview", { action });
    const body = {
        action,
        previewId: p.previewId,
        confirmation: action === "load" ? "테스트 로드" : "전체 초기화",
      },
      key = randomUUID();
    const result = await call(
      "operator-1",
      "/system/test-data/apply",
      body,
      200,
      "POST",
      key,
    );
    cookies.clear();
    return { body, key, result };
  }
  const bytes = () =>
    Promise.all(
      [file, store.organizations.file, store.maintenanceFile].map((p) =>
        readFile(p),
      ),
    );
  const change = (fn: (s: ReturnType<typeof seedState>) => void) =>
    store.transact(
      "operator-1",
      randomUUID(),
      "fixture-change",
      () => {},
      (s) => {
        fn(s);
        return {};
      },
    );
  async function restart() {
    await app.close();
    store = await new JsonStore(file).load();
    app = await buildApp(store, { clock: () => now });
    cookies.clear();
  }
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  return {
    dir,
    file,
    call,
    login,
    cookies,
    apply,
    bytes,
    change,
    restart,
    setClock: (value: string) => {
      now = value;
    },
    get store() {
      return store;
    },
    get app() {
      return app;
    },
  };
}

async function registerTestQualification(
  f: Awaited<ReturnType<typeof fixture>>,
  type: "auditee" | "auditor",
) {
  let template = f.store
    .snapshot()
    .qualificationTemplates.find(
      (t) => t.qualificationType === type && t.scope !== "team",
    )!;
  assert(template);
  if (type === "auditor")
    await f.call(
      "admin-1",
      "/qualification-templates/import",
      {
        templateIds: [template.id],
        templateRevisions: { [template.id]: template.revision },
      },
      409,
    );
  const common = f.store
    .snapshot()
    .commonCourses.find((c) => c.qualificationType === type)!;
  template = await f.call(
    "operator-1",
    `/system/qualification-templates/${template.id}`,
    {
      revision: template.revision,
      review: {
        stateRevision: f.store.snapshot().revision,
        organizationRevision: f.store.organizations.snapshot().revision,
      },
      title: template.title,
      englishName: template.englishName,
      description: template.description,
      qualificationType: type,
      ...(type === "auditor" ? { auditorLevel: "general" } : {}),
      defaultCommonCourseIds: [common.id],
      commonCourseRevisions: { [common.id]: common.revision },
    },
    200,
    "PUT",
  );
  const result = await f.call("admin-1", "/qualification-templates/import", {
    qualificationType: type,
    templateIds: [template.id],
    templateRevisions: { [template.id]: template.revision },
    commonCourseRevisions: { [common.id]: common.revision },
  });
  const registered = f.store
    .snapshot()
    .qualifications.find((q) => q.id === result.imported[0])!;
  assert.equal(
    registered.lifecycleStatus,
    type === "auditee" ? "Ready" : "Hold",
  );
  assert.equal(registered.version, type === "auditee" ? null : 1);
  assert.equal(registered.commonCourseEntityIds.length, 1);
  assert.equal(registered.courseIds.length, 1);
  const specialized = f.store
    .snapshot()
    .courses.find(
      (c) =>
        c.lv1OrganizationId === "org-photo" &&
        c.qualificationType === type &&
        c.category === "specialized",
    )!;
  const saved = await f.call(
    "admin-1",
    `/qualifications/${registered.id}`,
    {
      ...registered,
      courseIds: [...registered.courseIds, specialized.id],
      validity: { type: "months", months: 12, reminderDays: [30, 7] },
      confirmInitialConfiguration: true,
    },
    200,
    "PUT",
  );
  let q = f.store.snapshot().qualifications.find((q) => q.id === saved.id)!;
  if (type === "auditor") {
    assert.equal(q.lifecycleStatus, "Hold");
    await f.call("admin-1", `/qualifications/${q.id}/lifecycle`, {
      revision: q.revision,
      stateRevision: f.store.snapshot().revision,
      organizationRevision: f.store.organizations.snapshot().revision,
      status: "Active",
      reason: "등록부터 운영 전환 시험",
    });
    q = f.store.snapshot().qualifications.find((x) => x.id === q.id)!;
  }
  assert.equal(q.lifecycleStatus, "Active");
  assert.deepEqual(qualificationUseErrors(q, f.store.snapshot().courses), []);
  return q;
}

async function designateTestNeed(
  f: Awaited<ReturnType<typeof fixture>>,
  entityId: string,
) {
  const view = await f.call(
    "admin-1",
    "/organization-qualification-requirements",
  );
  await f.call(
    "admin-1",
    "/organization-qualification-requirements",
    {
      contractVersion: 2,
      stateRevision: view.stateRevision,
      organizationRevision: view.organizationRevision,
      changes: [
        {
          organizationId: "org-photo",
          entityIds: [entityId],
          exclusions: [],
          removalReasons: [],
        },
      ],
    },
    200,
    "PUT",
  );
}

test("내장 19개 원본·유형·팀 범위·3/3/1 문항·학습 7종과 준비 부족을 생성하고 팀 자격·공통 사본·필요자격은 비운다", () => {
  const original = seedState(true),
    org = seedOrganizations(),
    empty = resetTestData(original, org),
    loaded = loadTestData(
      empty.state,
      empty.organizations,
      "operator-1",
      "2026-10-27T01:00:00.000Z",
    ),
    s = loaded.state;
  assert.deepEqual(s.users, original.users);
  assert.equal(TEST_DATA_TEMPLATES.length, 19);
  assert.equal(s.qualificationTemplates.length, 19);
  assert.equal(s.commonCourses.length, 5);
  assert.equal(
    s.commonCourses.filter((c) => c.qualificationType === "auditee").length,
    3,
  );
  assert.equal(s.commonCourseReleases.length, 5);
  const teams = organizationEntries(org).filter(
    (n) => n.level === 1 && n.effectiveActive,
  );
  assert.equal(
    s.courses.filter((c) => c.category === "specialized").length,
    teams.length * 10,
  );
  for (const team of teams) {
    assert.equal(
      s.courses.filter(
        (c) =>
          c.lv1OrganizationId === team.id &&
          c.category === "specialized" &&
          c.qualificationType === "auditee",
      ).length,
      6,
    );
  }
  assert.equal(s.qualifications.length, 0);
  assert.equal(s.courses.filter((c) => c.category === "common").length, 0);
  assert.equal(s.organizationQualificationRequirements.length, 0);
  assert(
    s.qualificationTemplates.every(
      (t) => t.defaultCommonCourseIds.length === 0,
    ),
  );
  assert.equal(s.auditorPrograms.length, teams.length);
  for (const key of [
    "planningRequests",
    "plans",
    "assignments",
    "enrollments",
    "attempts",
    "subjectiveResponses",
    "completions",
    "certifications",
    "renewals",
    "renewalBatches",
  ] as const)
    assert.equal(s[key].length, 0, key);
  const status = testDataStatus(s, loaded.organizations);
  assert.equal(status.recipe.version, 3);
  assert.equal(status.recipe.qualifications, 0);
  assert.equal(status.recipe.commonCopies, 0);
  assert.deepEqual(status.qualifications, []);
  for (const c of [...s.commonCourses, ...s.courses]) {
    assert.deepEqual(courseUseErrors(c), []);
    assert.deepEqual(
      c.learningItems.map((i) => i.type),
      ["mtc", "team", "ojt"],
    );
    assert.deepEqual(
      c.materials.map((i) => i.type),
      ["text", "edm", "confluence", "url"],
    );
    assert(c.learningItems.some((i) => i.required));
    for (const questions of [c.questions, c.practicalQuestions]) {
      assert.equal(questions.length, c.qualificationType === "auditee" ? 3 : 0);
      assert(
        questions.every(
          (q) =>
            q.correct === 0 &&
            q.choices.length === 4 &&
            q.prompt.endsWith(`(정답: ${q.correct + 1}번)`),
        ),
      );
      if (c.qualificationType === "auditee") {
        assert.deepEqual(
          questions.map((q) => q.points),
          [34, 33, 33],
        );
        assert.equal(
          questions.reduce((total, q) => total + q.points, 0),
          100,
        );
      }
    }
    assert.equal(c.passScore, c.qualificationType === "auditee" ? 100 : null);
    assert.equal(
      c.practicalPassScore,
      c.qualificationType === "auditee" ? 100 : null,
    );
    assert.equal(
      c.subjectiveQuestions.length,
      c.qualificationType === "auditee" ? 1 : 0,
    );
    assert.deepEqual(c.releaseVersion, { major: 1, minor: 0 });
  }
  assert(
    testDataStatus(s, loaded.organizations).warnings.some((w) =>
      w.includes("메인 Auditor"),
    ),
  );
  s.qualificationTemplates[0]!.title = "시험 중 변경";
  const reempty = resetTestData(s, loaded.organizations),
    again = loadTestData(
      reempty.state,
      reempty.organizations,
      "operator-1",
      "2026-10-27T02:00:00.000Z",
    );
  assert.equal(
    again.state.qualificationTemplates[0]!.title,
    TEST_DATA_TEMPLATES[0]!.title,
  );
  assert.throws(() =>
    loadTestData(
      s,
      loaded.organizations,
      "operator-1",
      "2026-10-27T02:00:00.000Z",
    ),
  );
});

test("전체 초기화는 계정 전체 필드·조직 구조만 보존하고 과거 업무 스냅샷까지 제거한다", async (t) => {
  const f = await fixture(t, true),
    users = f.store.snapshot().users,
    roots = f.store.organizations.snapshot().roots;
  const before = await f.bytes(),
    reset = await f.apply("reset"),
    s = f.store.snapshot(),
    o = f.store.organizations.snapshot();
  assert.deepEqual(s.users, users);
  const structure = (nodes: typeof roots): unknown =>
    nodes.map(({ id, name, active, children }) => ({
      id,
      name,
      active,
      children: structure(children),
    }));
  assert.deepEqual(structure(o.roots), structure(roots));
  assert(
    Object.values(testDataCounts(s, o, f.store.hasLegacyTestSnapshot)).every(
      (n) => n === 0,
    ),
  );
  assert.equal(f.store.hasLegacyTestSnapshot, false);
  validateState(s, o);
  const backups = reset.result.backups;
  assert.deepEqual(
    await Promise.all(
      [backups.state, backups.organizations, backups.maintenance].map((p) =>
        readFile(p),
      ),
    ),
    before,
  );
  assert.equal(
    (await f.call("operator-1", "/system/test-data")).canReset,
    false,
  );
  await f.call(
    "operator-1",
    "/system/test-data/preview",
    { action: "reset" },
    409,
  );
  const loaded = await f.apply("load");
  await f.call(
    "operator-1",
    "/system/test-data/preview",
    { action: "load" },
    409,
  );
  // A lost reset response retried after a subsequent load returns its original receipt.
  const afterLoad = await f.bytes();
  assert.deepEqual(
    await f.call(
      "operator-1",
      "/system/test-data/apply",
      reset.body,
      200,
      "POST",
      reset.key,
    ),
    reset.result,
  );
  assert.deepEqual(await f.bytes(), afterLoad);
  await f.restart();
  assert.deepEqual(
    (await f.call("operator-1", `/system/test-data?operationKey=${loaded.key}`))
      .operation,
    loaded.result,
  );
  assert.deepEqual(
    await f.call(
      "operator-1",
      "/system/test-data/apply",
      loaded.body,
      200,
      "POST",
      loaded.key,
    ),
    loaded.result,
  );
});

test("구성1·2 영수증은 재시작·재시도 후 보존하고 새 로드는 구성3으로 생성한다", async (t) => {
  const f = await fixture(t),
    reset = await f.apply("reset");
  assert.equal(reset.result.recipeVersion, 3);
  for (const version of [1, 2]) {
    await f.app.close();
    const metadata = JSON.parse(
      await readFile(f.store.maintenanceFile, "utf8"),
    );
    metadata.testDataOperations[0].recipeVersion = version;
    await writeFile(f.store.maintenanceFile, JSON.stringify(metadata));
    await f.restart();
    const before = await f.bytes();
    const status = await f.call(
      "operator-1",
      `/system/test-data?operationKey=${reset.key}`,
    );
    assert.equal(status.operation.recipeVersion, version);
    assert.equal(status.recipe.version, 3);
    assert.deepEqual(
      await f.call(
        "operator-1",
        "/system/test-data/apply",
        reset.body,
        200,
        "POST",
        reset.key,
      ),
      status.operation,
    );
    assert.deepEqual(await f.bytes(), before);
  }
  const preview = await f.call("operator-1", "/system/test-data/preview", {
    action: "load",
  });
  assert.equal(preview.recipe.qualifications, 0);
  assert.equal(preview.recipe.commonCopies, 0);
  assert.equal(preview.after.qualifications, 0);
  assert.equal(preview.after.organizationQualificationRequirements, 0);
  const loaded = await f.apply("load");
  assert.equal(loaded.result.recipeVersion, 3);
  assert.equal(loaded.result.after.qualifications, 0);
  assert.equal(
    TestDataReceiptSchema.safeParse({ ...reset.result, recipeVersion: 4 })
      .success,
    false,
  );
});

test("운영자 권한·정확한 문구·취소·15분 만료·데이터/조직 충돌은 파일 변경 없이 보류한다", async (t) => {
  const f = await fixture(t),
    before = await f.bytes();
  assert.equal(
    (await f.app.inject({ method: "GET", url: "/api/system/test-data" }))
      .statusCode,
    401,
  );
  for (const who of ["learner-1", "admin-1"]) {
    await f.call(who, "/system/test-data", undefined, 403);
    await f.call(who, "/system/test-data/preview", { action: "reset" }, 403);
  }
  await f.call(
    "operator-1",
    "/system/test-data/preview",
    { action: "load" },
    409,
  );
  const p = await f.call("operator-1", "/system/test-data/preview", {
      action: "reset",
    }),
    body = {
      action: "reset",
      previewId: p.previewId,
      confirmation: "전체 초기화",
    };
  assert.deepEqual(await f.bytes(), before);
  await f.call(
    "operator-1",
    "/system/test-data/apply",
    { ...body, confirmation: "초기화" },
    422,
  );
  f.setClock("2026-10-27T01:15:00.000Z");
  await f.call("operator-1", "/system/test-data/apply", body, 409);
  assert.deepEqual(await f.bytes(), before);
  f.setClock("2026-10-27T01:16:00.000Z");
  const p2 = await f.call("operator-1", "/system/test-data/preview", {
    action: "reset",
  });
  await f.change((s) => {
    s.users.find((u) => u.id === "learner-1")!.name += " 변경";
  });
  const changed = await f.bytes();
  await f.call(
    "operator-1",
    "/system/test-data/apply",
    { ...body, previewId: p2.previewId },
    409,
  );
  assert.deepEqual(await f.bytes(), changed);
  const p3 = await f.call("operator-1", "/system/test-data/preview", {
    action: "reset",
  });
  await f.store.organizations.transact(
    "operator-1",
    randomUUID(),
    "org-change",
    () => {},
    (d) => {
      d.roots[0]!.description = "확인 이후 변경";
      return {};
    },
  );
  const changedOrg = await f.bytes();
  await f.call(
    "operator-1",
    "/system/test-data/apply",
    { ...body, previewId: p3.previewId },
    409,
  );
  assert.deepEqual(await f.bytes(), changedOrg);
});

test("각 파일 저장 실패는 세 파일의 원래 바이트를 복구하고 요청 키를 소비하지 않는다", async (t) => {
  const f = await fixture(t);
  for (const target of ["organization", "state", "maintenance"]) {
    const before = await f.bytes(),
      generation = f.store.generation;
    const p = await f.call("operator-1", "/system/test-data/preview", {
        action: "reset",
      }),
      body = {
        action: "reset",
        previewId: p.previewId,
        confirmation: "전체 초기화",
      },
      key = randomUUID();
    const fail = () => {
      throw new Error("injected replacement failure");
    };
    if (target === "organization") f.store.organizations.beforeReplace = fail;
    else if (target === "state") f.store.beforeReplace = fail;
    else f.store.beforeMaintenanceReplace = fail;
    await f.call(
      "operator-1",
      "/system/test-data/apply",
      body,
      503,
      "POST",
      key,
    );
    assert.deepEqual(await f.bytes(), before);
    assert.equal(f.store.generation, generation);
    f.store.organizations.beforeReplace = undefined;
    f.store.beforeReplace = undefined;
    f.store.beforeMaintenanceReplace = undefined;
    assert.equal(f.store.testDataOperation(key, "operator-1"), null);
  }
  await f.apply("reset");
  await f.apply("load");
});

test("세대 변경은 모든 접속 세션·이전 세대 쓰기를 차단하며 폐지 API는 계속410이다", async (t) => {
  const f = await fixture(t),
    oldCookie = await f.login("admin-1"),
    oldGeneration = f.store.generation;
  const reset = await f.apply("reset");
  const stale = await f.app.inject({
    method: "GET",
    url: "/api/workspace",
    headers: { cookie: oldCookie },
  });
  assert.equal(stale.statusCode, 401);
  const cookie = await f.login();
  const wrongGeneration = await f.app.inject({
    method: "POST",
    url: "/api/system/test-data/apply",
    headers: {
      cookie,
      "x-eks-data-generation": oldGeneration,
      "x-eks-release-contract": "2",
      "idempotency-key": reset.key,
    },
    payload: reset.body,
  });
  assert.equal(wrongGeneration.statusCode, 409);
  const before = await f.bytes();
  for (const url of ["/testing/load", "/system/master-data/import"])
    await f.call("operator-1", url, { file: "ignored", key: reset.key }, 410);
  assert.deepEqual(await f.bytes(), before);
});

test("교체 중 대기한 업무 쓰기는 새 세대에 반영되지 않으며 중단 표식은 세 파일을 함께 복구한다", async (t) => {
  const f = await fixture(t),
    before = await f.bytes();
  let reached!: () => void, resume!: () => void;
  const atWrite = new Promise<void>((r) => {
      reached = r;
    }),
    gate = new Promise<void>((r) => {
      resume = r;
    });
  f.store.beforeReplace = async () => {
    reached();
    await gate;
  };
  const operation = f.apply("reset");
  await atWrite;
  const staleWrite = f
    .change((s) => {
      s.notices = [];
    })
    .then(
      () => false,
      (e: any) => e.code,
    );
  resume();
  await operation;
  assert.equal(await staleWrite, "DATASET_CHANGED");
  f.store.beforeReplace = undefined;
  const metadataBefore = JSON.parse(before[2]!.toString()),
    receipt = JSON.parse((await readFile(f.store.maintenanceFile)).toString())
      .testDataOperations[0];
  await f.app.close();
  // A process may stop after any one of the durable replacement writes.
  await writeFile(
    f.store.replacementMarker,
    JSON.stringify({
      backups: receipt.backups,
      maintenanceBefore: metadataBefore,
      receipt,
    }),
  );
  await assert.rejects(new JsonStore(f.file).load(), /교체|recover-master/);
  const recovery = new JsonStore(f.file);
  const result = await recovery.recoverMasterReplacement();
  assert.equal(result.generation, metadataBefore.generation);
  assert.deepEqual(await f.bytes(), before);
  await f.restart();
  assert.deepEqual(f.store.snapshot().users, seedState(true).users);
});

test("Auditor 풀 등급 보완·수동 등록·Active 전환 후 지정·본인 확인으로 인증한다", async (t) => {
  const f = await fixture(t);
  await f.apply("reset");
  await f.apply("load");
  const q = await registerTestQualification(f, "auditor");
  const u = f.store.snapshot().users.find((u) => u.id === "learner-2")!;
  await f.call(
    "operator-1",
    `/system/users/${u.id}`,
    {
      revision: u.revision,
      name: u.name,
      organizationId: u.organizationId,
      roles: [...u.roles, "evaluator"],
    },
    200,
    "PATCH",
  );
  const s = f.store.snapshot();
  const start = await f.call("learner-2", "/me/auditor/starts", {
    qualificationId: q.id,
    qualificationRevision: q.revision,
    templateRevision: q.templateRevision,
  });
  for (const e of f.store
    .snapshot()
    .enrollments.filter((e) => e.assignmentId === start.assignmentId)) {
    const c = s.courses.find((c) => c.id === e.courseId)!;
    for (const item of c.learningItems.filter((i) => i.required)) {
      const revision =
        f.store
          .snapshot()
          .learningChecklists.find((l) => l.enrollmentId === e.id)?.revision ||
        0;
      await f.call(
        "learner-2",
        `/enrollments/${e.id}/checklist`,
        { revision, itemId: item.id, checked: true },
        200,
        "PUT",
      );
    }
  }
  assert.equal(f.store.snapshot().certifications.length, 1);
  assert(
    f.store
      .snapshot()
      .completions.every((c) => c.method === "self_confirmation"),
  );
  assert.equal(f.store.snapshot().attempts.length, 0);
  const missing = s.qualificationTemplates.find(
    (t) => t.scope === "team" && t.qualificationType === "auditor",
  )!;
  await f.call(
    "admin-1",
    "/qualification-templates/import",
    {
      templateIds: [missing.id],
      templateRevisions: { [missing.id]: missing.revision },
    },
    409,
  );
  const accounts = f.store.snapshot().users;
  await f.apply("reset");
  assert.deepEqual(f.store.snapshot().users, accounts);
});

test("로드 후 Auditee 풀 등록·공통 기본 사본·팀 기준·필요 조직 지정부터 실제 인증까지 진행된다", async (t) => {
  const f = await fixture(t);
  await f.apply("reset");
  await f.apply("load");
  const q = await registerTestQualification(f, "auditee");
  await designateTestNeed(f, q.entityId);
  const requestPreview = await f.call("admin-1", "/planning-requests/preview", {
    learnerIds: ["learner-2"],
  });
  const request = await f.call("admin-1", "/planning-requests", {
    learnerIds: ["learner-2"],
    message: "내장 기준 시험",
    stateRevision: requestPreview.stateRevision,
    organizationRevision: requestPreview.organizationRevision,
    replaceRequestIds: [],
  });
  const plan = await f.call("learner-2", "/plans", {
    requestId: request.ids[0],
    requestRevision: 1,
    qualificationId: q.id,
  });
  await f.call(
    "learner-2",
    `/plans/${plan.id}`,
    {
      revision: 1,
      startOn: "2026-10-27",
      endOn: "2026-11-27",
      goal: "내장 시험 완료",
    },
    200,
    "PUT",
  );
  const done = await f.call("learner-2", `/plans/${plan.id}/complete`, {
    revision: 2,
    criteriaToken: criteriaFingerprint(f.store.snapshot(), q),
  });
  const enrollments = f.store
    .snapshot()
    .enrollments.filter((e) => e.assignmentId === done.assignmentId);
  assert.equal(enrollments.length, 2);
  for (const enrollment of enrollments) {
    const c = f.store
      .snapshot()
      .courses.find((c) => c.id === enrollment.courseId)!;
    const response = await f.call(
      "learner-2",
      `/enrollments/${enrollment.id}/subjective-response`,
      {},
    );
    await f.call(
      "learner-2",
      `/subjective-responses/${response.id}/draft`,
      {
        revision: 1,
        answers: {
          [c.subjectiveQuestions[0]!.id]:
            "표준 확인과 이상 보고 절차를 따릅니다.",
        },
      },
      200,
      "PUT",
    );
    await f.call("learner-2", `/subjective-responses/${response.id}/submit`, {
      revision: 2,
    });
    for (const kind of c.assessmentKinds) {
      const wrong = await f.call(
        "learner-2",
        `/enrollments/${enrollment.id}/attempts`,
        { kind },
      );
      await f.call(
        "learner-2",
        `/attempts/${wrong.id}/draft`,
        {
          revision: 1,
          answers: Object.fromEntries(
            assessmentQuestions(c, kind).map((q, i) => [q.id, i === 0 ? 1 : 0]),
          ),
        },
        200,
        "PUT",
      );
      const failed = await f.call("learner-2", `/attempts/${wrong.id}/submit`, {
        revision: 2,
      });
      assert.equal(failed.result, "failed");
      const graded = f.store
        .snapshot()
        .attempts.find((a) => a.id === wrong.id)!;
      assert.equal(graded.earned, 66);
      assert.equal(graded.total, 100);
      const a = await f.call(
        "learner-2",
        `/enrollments/${enrollment.id}/attempts`,
        { kind },
      );
      await f.call(
        "learner-2",
        `/attempts/${a.id}/draft`,
        {
          revision: 1,
          answers: Object.fromEntries(
            assessmentQuestions(c, kind).map((q) => [q.id, 0]),
          ),
        },
        200,
        "PUT",
      );
      const passed = await f.call("learner-2", `/attempts/${a.id}/submit`, {
        revision: 2,
      });
      assert.equal(passed.result, "passed");
      const gradedPass = f.store
        .snapshot()
        .attempts.find((v) => v.id === a.id)!;
      assert.equal(gradedPass.earned, 100);
      assert.equal(gradedPass.total, 100);
    }
  }
  const s = f.store.snapshot();
  assert.equal(s.completions.length, 2);
  assert.equal(s.certifications.length, 1);
  assert.equal(
    s.subjectiveResponses.filter((r) => r.status === "submitted").length,
    2,
  );
  assert.deepEqual(s.certifications[0]!.frozenCriteria?.qualificationVersion, {
    major: 1,
    minor: 0,
  });
  const print = await f.call(
    "learner-2",
    `/assignments/${done.assignmentId}/certification`,
  );
  assert.deepEqual(
    print.certification.frozenCriteria,
    s.certifications[0]!.frozenCriteria,
  );
  const common = s.commonCourses.find(
    (c) =>
      c.id ===
      s.courses.find((c) => c.id === q.courseIds[0])!.commonCourseSource!.id,
  )!;
  await f.change((state) => {
    saveCommonCourse(state, "operator-1", common.id, {
      ...CourseContentSchema.parse(common),
      revision: common.revision,
      title: common.title + " 개정",
    });
  });
  assert(f.store.snapshot().qualifications.length > s.qualifications.length);
  assert(f.store.snapshot().courses.length > s.courses.length);
  assert.deepEqual(
    f.store.snapshot().certifications[0]!.frozenCriteria,
    s.certifications[0]!.frozenCriteria,
  );
  f.setClock("2027-08-01T01:00:00.000Z");
  await f.call(
    "learner-2",
    `/certifications/${s.certifications[0]!.id}/renewals`,
    { certificationRevision: s.certifications[0]!.revision || 1 },
    410,
  );
  assert.equal(f.store.snapshot().renewals.length, 0);
  const users = s.users;
  await f.apply("reset");
  assert.deepEqual(f.store.snapshot().users, users);
  assert(
    Object.values(
      testDataCounts(f.store.snapshot(), f.store.organizations.snapshot()),
    ).every((n) => n === 0),
  );
});
