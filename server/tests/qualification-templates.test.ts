import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { seedState } from "../src/seed.ts";
import { seedOrganizations } from "../src/organizations.ts";
import { JsonStore } from "../src/storage.ts";
import { buildApp } from "../src/app.ts";
import { migrateTemplates } from "../src/template-migration.ts";
import { currentQualification } from "../src/qualification-templates.ts";
import { exportCatalog, prepareCatalog } from "../src/catalog.ts";
import { exportMaster, readMaster } from "../src/master-data.ts";
async function fixture(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-template-")),
    file = path.join(dir, "runtime/state.json"),
    seed = seedState(true);
  seed.users.push({
    id: "detail",
    name: "세부 관리자",
    organizationId: "org-photo",
    roles: ["learner"],
    revision: 1,
    organizationAdministration: {
      organizationId: "org-photo",
      grantedBy: "admin-1",
      grantedAt: "2026-10-23T00:00:00.000Z",
    },
  });
  await new JsonStore(file).initialize(seed);
  const store = await new JsonStore(file).load(),
    app = await buildApp(store),
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
      cookies.set(actor, `${r.cookies[0]!.name}=${r.cookies[0]!.value}`);
    }
    const r = await app.inject({
      method: method as any,
      url: "/api" + url,
      headers: { cookie: cookies.get(actor)!, "idempotency-key": key },
      ...(body === undefined ? {} : { payload: body }),
    });
    assert.equal(r.statusCode, status, r.body);
    return r.json();
  }
  return { store, app, call, file };
}
test("기본자격 생성 권한·팀 등록 중복·공통 필드 위조와 Excel 신규 우회를 차단한다", async (t) => {
  const { store, call } = await fixture(t),
    body = {
      title: "공통 검증 자격",
      englishName: "Shared",
      description: "독립 수행 확인",
    };
  for (const actor of ["admin-1", "detail", "learner-1"])
    await call(actor, "/system/qualification-templates", body, 403);
  const base = await call(
    "operator-1",
    "/system/qualification-templates",
    body,
  );
  for (const actor of ["admin-1", "operator-1"])
    await call(actor, "/qualifications?lv1OrganizationId=org-photo", {}, 403);
  await call(
    "detail",
    "/qualification-templates/import",
    { templateIds: [base.id] },
    403,
  );
  const [a, b] = await Promise.all([
    call("admin-1", "/qualification-templates/import", {
      templateIds: [base.id],
    }),
    call("admin-1", "/qualification-templates/import", {
      templateIds: [base.id],
    }),
  ]);
  assert.equal(a.imported.length + b.imported.length, 1);
  const q = store
    .snapshot()
    .qualifications.find((q) => q.templateId === base.id)!;
  await call(
    "admin-1",
    `/qualifications/${q.id}`,
    { ...q, title: "위조" },
    422,
    "PUT",
  );
  await call(
    "admin-1",
    `/qualifications/${q.id}`,
    { ...q, templateId: "eqp-backup" },
    422,
    "PUT",
  );
  const etch = await call(
    "operator-1",
    "/qualification-templates/import?lv1OrganizationId=org-etch",
    { templateIds: [base.id] },
  );
  await call(
    "admin-1",
    `/qualifications/${etch.imported[0]}`,
    { ...q },
    403,
    "PUT",
  );
  const w = exportCatalog(store.snapshot(), "org-photo", [q.id]);
  w.sheets[0]!.mode = "new";
  assert.ok(
    prepareCatalog(store.snapshot(), w, "org-photo").issues.some(
      (i) => i.column === "mode",
    ),
  );
  const exportFile = exportMaster(
    store.snapshot(),
    store.organizations.snapshot(),
    new Date().toISOString(),
  );
  assert.deepEqual(
    readMaster(exportFile).payload.qualificationTemplates,
    store.snapshot().qualificationTemplates,
  );
});
test("팀 적용·소속 필수 조회·공통 정보 자동 반영과 확정 배정의 당시 정보는 분리된다", async (t) => {
  const { store, call } = await fixture(t),
    base = await call("operator-1", "/system/qualification-templates", {
      title: "이전 이름",
      englishName: "Before",
      description: "이전 설명",
    });
  const registered = await call("admin-1", "/qualification-templates/import", {
    templateIds: [base.id],
  });
  let q = store
    .snapshot()
    .qualifications.find((q) => q.id === registered.imported[0])!;
  await call(
    "admin-1",
    `/organization-policies/org-photo/qualification-pool`,
    {
      revision: store.organizations.snapshot().revision,
      qualificationIds: [q.id],
    },
    422,
    "PUT",
  );
  await call(
    "admin-1",
    `/qualifications/${q.id}`,
    {
      ...q,
      validity: { type: "unlimited", months: null, reminderDays: [] },
      courseIds: ["demo-course-1"],
    },
    200,
    "PUT",
  );
  q = store.snapshot().qualifications.find((x) => x.id === q.id)!;
  await call(
    "admin-1",
    "/organization-policies/org-photo/qualification-pool",
    {
      revision: store.organizations.snapshot().revision,
      qualificationIds: [q.id],
    },
    200,
    "PUT",
  );
  await call(
    "detail",
    "/organization-policies/org-photo",
    {
      revision: store.organizations.snapshot().revision,
      description: "",
      duties: "",
      requiredQualifications: [q.entityId],
    },
    200,
    "PUT",
  );
  const req = await call("admin-1", "/planning-requests", {
    learnerIds: ["learner-2"],
    message: "",
  });
  const p = await call("learner-2", "/plans", {
    requestRevision: store
      .snapshot()
      .planningRequests.find((r) => r.id === req.ids[0])!.revision,
    requestId: req.ids[0],
    qualificationId: q.id,
  });
  const plan = store.snapshot().plans.find((x) => x.id === p.id)!;
  await call(
    "learner-2",
    `/plans/${p.id}`,
    {
      ...plan,
      targetOn: "2027-12-31",
      schedules: plan.schedules.map((x) => ({ ...x, goal: "독립 수행" })),
    },
    200,
    "PUT",
  );
  const completed = await call("learner-2", `/plans/${p.id}/complete`, {
    revision: 2,
  });
  const before = store
    .snapshot()
    .assignments.find((a) => a.id === completed.assignmentId)!;
  await call(
    "operator-1",
    `/system/qualification-templates/${base.id}`,
    {
      ...{ title: "최신 이름", englishName: "After", description: "최신 설명" },
      revision: 1,
    },
    200,
    "PUT",
  );
  assert.equal(
    (await call("learner-2", "/workspace")).requiredQualifications.items[0]
      .title,
    "최신 이름",
  );
  assert.deepEqual(
    store.snapshot().assignments.find((a) => a.id === before.id),
    before,
  );
  assert.equal(before.qualificationMetadata!.title, "이전 이름");
  const e = store
    .snapshot()
    .enrollments.find((e) => e.assignmentId === before.id)!;
  const course = store.snapshot().courses.find((c) => c.id === e.courseId)!;
  for (const kind of course.assessmentKinds) {
    await call("learner-2", `/enrollments/${e.id}/attempts`, { kind });
    const questions =
      kind === "objective" ? course.questions : course.practicalQuestions;
    const active = store
      .snapshot()
      .attempts.find((a) => a.enrollmentId === e.id && a.kind === kind)!;
    await call(
      "learner-2",
      `/attempts/${active.id}/draft`,
      {
        revision: active.revision,
        answers: Object.fromEntries(questions.map((q) => [q.id, q.correct])),
      },
      200,
      "PUT",
    );
    await call("learner-2", `/attempts/${active.id}/submit`, {
      revision: active.revision + 1,
    });
  }
  const cert = store
    .snapshot()
    .certifications.find((c) => c.assignmentId === before.id)!;
  assert.equal(cert.snapshot!.title, "이전 이름");
  await call("admin-1", `/qualifications/${q.id}`, q, 409, "PUT");
  await call(
    "admin-1",
    "/organization-policies/org-photo/qualification-pool",
    { revision: store.organizations.snapshot().revision, qualificationIds: [] },
    409,
    "PUT",
  );
});
test("11→12 이관은 원문·진행·조직을 보존하고 미연결은 중단하며 반복 적용은 무변경이다", () => {
  const raw: any = structuredClone(seedState(true)),
    org = seedOrganizations();
  raw.schemaVersion = 11;
  const legacyTemplates = raw.qualificationTemplates;
  delete raw.qualificationTemplates;
  // Explicit fixture mapping, not title-based inference.
  const mapping = {
    templates: legacyTemplates.filter((t: any) => t.id.startsWith("fixture-")),
  };
  const next = migrateTemplates(raw, org, undefined, mapping);
  assert.equal(next.state.schemaVersion, 13);
  assert.deepEqual(next.state.qualifications, raw.qualifications);
  assert.deepEqual(next.organizations, org);
  assert.deepEqual(migrateTemplates(next.state, org).state, next.state);
  const broken = structuredClone(raw);
  delete broken.qualifications[0].templateId;
  assert.throws(() => migrateTemplates(broken, org), /연결 정보/);
  assert.equal(
    next.state.qualificationTemplates.find((t) => t.id === "eqp-backup")!
      .description,
    "",
  );
});

test("공통 정보 충돌·저장 실패는 원본을 보존하고 팀 설정은 서로 독립적이다", async (t) => {
  const { store, call, file } = await fixture(t),
    base = await call("operator-1", "/system/qualification-templates", {
      title: "독립 기준",
      englishName: "Independent",
      description: "원래 설명",
    });
  const a = await call("admin-1", "/qualification-templates/import", {
    templateIds: [base.id],
  });
  const b = await call(
    "operator-1",
    "/qualification-templates/import?lv1OrganizationId=org-etch",
    { templateIds: [base.id] },
  );
  let teamB = store
    .snapshot()
    .qualifications.find((q) => q.id === b.imported[0])!;
  const createdCourse = await call(
    "operator-1",
    "/courses?lv1OrganizationId=org-etch",
    {},
  );
  const sourceCourse = store
    .snapshot()
    .courses.find((c) => c.id === "demo-course-1")!;
  await call(
    "operator-1",
    `/courses/${createdCourse.id}?lv1OrganizationId=org-etch`,
    { ...sourceCourse, title: "Etch 팀 독립 기준", revision: 1 },
    200,
    "PUT",
  );
  await call(
    "operator-1",
    `/qualifications/${teamB.id}?lv1OrganizationId=org-etch`,
    {
      ...teamB,
      courseIds: [createdCourse.id],
      validity: { type: "months", months: 12, reminderDays: [] },
    },
    200,
    "PUT",
  );
  teamB = store.snapshot().qualifications.find((q) => q.id === teamB.id)!;
  let teamA = store
    .snapshot()
    .qualifications.find((q) => q.id === a.imported[0])!;
  await call("detail", `/qualifications/${teamA.id}`, teamA, 403, "PUT");
  await call(
    "admin-1",
    `/qualifications/${teamA.id}`,
    {
      ...teamA,
      courseIds: ["demo-course-1"],
      validity: { type: "unlimited", months: null, reminderDays: [] },
    },
    200,
    "PUT",
  );
  assert.deepEqual(
    store.snapshot().qualifications.find((q) => q.id === teamB.id),
    teamB,
  );
  const original = await readFile(file, "utf8"),
    key = randomUUID();
  store.beforeReplace = () => {
    throw new Error("simulated save failure");
  };
  const update = {
    revision: 1,
    title: "변경 이름",
    englishName: "Changed",
    description: "공통 설명",
  };
  await call(
    "operator-1",
    `/system/qualification-templates/${base.id}`,
    update,
    503,
    "PUT",
    key,
  );
  assert.equal(await readFile(file, "utf8"), original);
  store.beforeReplace = undefined;
  await call(
    "operator-1",
    `/system/qualification-templates/${base.id}`,
    update,
    200,
    "PUT",
    key,
  );
  await call(
    "operator-1",
    `/system/qualification-templates/${base.id}`,
    update,
    200,
    "PUT",
    key,
  );
  await call(
    "operator-1",
    `/system/qualification-templates/${base.id}`,
    { ...update, title: "늦은 변경" },
    409,
    "PUT",
  );
  assert.equal(
    store.snapshot().qualificationTemplates.find((t) => t.id === base.id)!
      .revision,
    2,
  );
  teamA = store.snapshot().qualifications.find((q) => q.id === teamA.id)!;
  assert.equal(
    currentQualification(store.snapshot(), teamA).title,
    "변경 이름",
  );
  assert.equal(
    currentQualification(store.snapshot(), teamB).title,
    "변경 이름",
  );
  assert.equal(teamA.courseIds.length, 1);
  assert.equal(teamB.courseIds.length, 1);
  assert.notDeepEqual(teamA.courseIds, teamB.courseIds);
  assert.equal(teamA.validity.type, "unlimited");
  assert.equal(teamB.validity.months, 12);
  const w = exportCatalog(store.snapshot(), "org-photo", [teamA.id]);
  w.sheets[0]!.description = "팀에서 위조";
  assert.ok(
    prepareCatalog(store.snapshot(), w, "org-photo").issues.some(
      (i) => i.column === "description",
    ),
  );
});

test("삭제된 팀 자격 재등록은 같은 계보의 다음 버전이며 Excel 구형 파일도 등록된 자격만 수정한다", async (t) => {
  const { store, call } = await fixture(t),
    base = await call("operator-1", "/system/qualification-templates", {
      title: "재등록",
      englishName: "Reregister",
      description: "설명",
    });
  const registration = await call(
    "admin-1",
    "/qualification-templates/import",
    { templateIds: [base.id] },
  );
  const old = store
    .snapshot()
    .qualifications.find((q) => q.id === registration.imported[0])!;
  const impact = await call(
    "admin-1",
    `/qualifications/${old.id}/deletion-impact`,
  );
  await call(
    "admin-1",
    `/qualifications/${old.id}`,
    { ...impact, reason: "재등록 시험" },
    200,
    "DELETE",
  );
  assert.equal(
    (await call("admin-1", "/qualification-templates")).find(
      (t: any) => t.id === base.id,
    ).imported,
    false,
  );
  const second = await call("admin-1", "/qualification-templates/import", {
    templateIds: [base.id],
  });
  const q = store
    .snapshot()
    .qualifications.find((q) => q.id === second.imported[0])!;
  assert.equal(q.entityId, old.entityId);
  assert.equal(q.version, 2);
  assert.equal(q.parentId, old.id);
  assert.ok(
    store.snapshot().qualifications.find((q) => q.id === old.id)!.deletedAt,
  );
  const w = exportCatalog(store.snapshot(), "org-photo", [q.id]);
  w.format = "eks-catalog-v6";
  delete w.sheets[0]!.templateId;
  delete w.sheets[0]!.templateRevision;
  w.sheets[0]!.renewalLeadMonths = 4;
  assert.ok(
    !prepareCatalog(store.snapshot(), w, "org-photo").issues.some(
      (i) => i.severity === "structure",
    ),
  );
  w.sheets[0]!.sourceId = "missing";
  assert.ok(
    prepareCatalog(store.snapshot(), w, "org-photo").issues.some(
      (i) => i.column === "sourceId",
    ),
  );
});

test("기본자격 이관은 백업·원본 해시·실패 복구·재실행을 보호하고 구형 서버 이전 파일을 검사한다", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-template-migrate-")),
    file = path.join(dir, "runtime/state.json");
  t.after(() => rm(dir, { recursive: true, force: true }));
  const initial = seedState(false);
  await new JsonStore(file).initialize(initial);
  const store = new JsonStore(file),
    org = JSON.parse(await readFile(store.organizations.file, "utf8"));
  const raw: any = structuredClone(initial);
  raw.schemaVersion = 11;
  delete raw.qualificationTemplates;
  const original = JSON.stringify(raw),
    orgBytes = await readFile(store.organizations.file, "utf8");
  await writeFile(file, original);
  const hash = (text: string) =>
    createHash("sha256").update(text).digest("hex");
  const expected = {
    revision: raw.revision,
    stateHash: hash(original),
    organizationHash: hash(orgBytes),
  };
  await assert.rejects(
    store.migratePolicies(
      { ...expected, stateHash: "0".repeat(64) },
      migrateTemplates,
    ),
    /미리보기/,
  );
  store.beforeReplace = () => {
    throw new Error("migration interrupted");
  };
  await assert.rejects(
    store.migratePolicies(
      expected,
      migrateTemplates,
      "qualification-templates",
    ),
    /migration interrupted/,
  );
  assert.equal(await readFile(file, "utf8"), original);
  assert.equal(await readFile(store.organizations.file, "utf8"), orgBytes);
  store.beforeReplace = undefined;
  const result: any = await store.migratePolicies(
    expected,
    migrateTemplates,
    "qualification-templates",
  );
  assert.equal(await readFile(result.stateBackup, "utf8"), original);
  const migrated = await readFile(file, "utf8");
  await store.migratePolicies(
    { ...expected, revision: raw.revision + 2, stateHash: hash(migrated) },
    migrateTemplates,
  );
  assert.equal(await readFile(file, "utf8"), migrated);
  const legacy: any = exportMaster(initial, org, new Date().toISOString());
  legacy.formatVersion = 2;
  legacy.stateSchemaVersion = 11;
  delete legacy.payload.qualificationTemplates;
  delete legacy.counts.qualificationTemplates;
  const { contentHash } = await import("../src/master-data.ts");
  legacy.sha256 = contentHash(legacy.payload);
  assert.equal(readMaster(legacy).payload.qualificationTemplates.length, 15);
  legacy.payload.qualifications = [
    {
      ...seedState(true).qualifications[0],
      templateId: "eqp-backup",
      courseIds: [],
    },
  ];
  delete legacy.payload.qualifications[0].templateRevision;
  legacy.counts.qualifications = 1;
  legacy.sha256 = contentHash(legacy.payload);
  const imported = readMaster(legacy);
  assert.equal(imported.payload.qualifications[0]!.templateId, "eqp-backup");
  assert.equal(imported.payload.qualificationTemplates[0]!.description, "");
  delete legacy.payload.qualifications[0].templateId;
  legacy.sha256 = contentHash(legacy.payload);
  assert.throws(() => readMaster(legacy), /연결 정보/);
});
