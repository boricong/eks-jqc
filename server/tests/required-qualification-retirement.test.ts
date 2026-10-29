import { migratePlanningSchedule } from "../src/planning-schedule-migration.ts";
import { loadPlanningFixture } from "./planning-migration-helper.ts";
import { legacyRequestFixture } from "./legacy-request-fixture.ts";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { organizationEntries } from "@eks/contracts";
import { seedState } from "../src/seed.ts";
import {
  seedOrganizations,
  validateOrganizations,
} from "../src/organizations.ts";
import { validateState } from "../src/integrity.ts";
import { JsonStore } from "../src/storage.ts";
import { buildApp } from "./release-test-app.ts";
import { migrateRequiredQualifications } from "../src/required-qualification-migration.ts";
import { exportMaster, readMaster, contentHash } from "./legacy-master-data.ts";

const at = "2026-10-26T03:00:00.000Z";
function oldPair() {
  const state: any = seedState(true),
    organizations: any = seedOrganizations();
  state.schemaVersion = 20;
  organizations.schemaVersion = 3;
  const q = state.qualifications.find(
    (q: any) => q.id === "demo-qualification",
  )!;
  organizations.roots.find(
    (o: any) => o.id === "org-photo",
  ).requiredQualifications = [q.entityId];
  const org = organizationEntries(organizations).find(
    (o) => o.id === "org-photo",
  )!;
  const target = {
    entityId: q.entityId,
    qualificationId: q.id,
    title: q.title,
    version: q.version,
  };
  const base = {
    qualificationType: "auditee",
    lv1OrganizationId: "org-photo",
    requestedBy: "admin-1",
    dueOn: "2030-12-31",
    message: "이전 요청",
    createdAt: at,
    revision: 4,
    organizationId: org.id,
    organizationPath: org.path,
    mode: "fixed",
    targets: [target],
    selections: [],
    source: "requested",
  };
  state.planningRequests.push({
    ...structuredClone(base),
    id: "old-open",
    learnerId: "learner-2",
  });
  const assignment = state.assignments.find(
    (a: any) => a.qualificationId === q.id,
  )!;
  state.planningRequests.push({
    ...structuredClone(base),
    id: "old-completed",
    learnerId: assignment.learnerId,
    completion: {
      date: at,
      reason: "planned",
      evidence: [{ entityId: q.entityId, assignmentId: assignment.id }],
    },
  });
  return { state, organizations, target };
}
async function fixture(
  t: TestContext,
  pair = migrateRequiredQualifications(
    ...(() => {
      const p = oldPair();
      return [p.state, p.organizations] as const;
    })(),
    at,
  ),
) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-no-org-requirements-")),
    file = path.join(dir, "runtime/state.json"),
    initial = new JsonStore(file);
  await initial.organizations.initialize(pair.organizations);
  await initial.initialize(pair.state);
  const store = await loadPlanningFixture(file),
    app = await buildApp(store, { clock: () => at }),
    cookies = new Map<string, string>();
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  async function session(id: string) {
    if (!cookies.has(id)) {
      const r = await app.inject({
        method: "POST",
        url: "/api/session",
        payload: { actorId: id },
      });
      cookies.set(id, `${r.cookies[0]!.name}=${r.cookies[0]!.value}`);
    }
    return cookies.get(id)!;
  }
  async function call(
    id: string,
    url: string,
    payload?: any,
    expected = 200,
    method: any = payload === undefined ? "GET" : "POST",
    key = randomUUID(),
  ) {
    const r = await app.inject({
      method,
      url: "/api" + url,
      headers: { cookie: await session(id), "idempotency-key": key },
      ...(payload === undefined ? {} : { payload }),
    });
    assert.equal(r.statusCode, expected, `${method} ${url}: ${r.body}`);
    return r.json();
  }
  return { dir, file, store, app, call, session };
}

test("20/3→21/4는 필수 설정·원래 요청을 감사에 보존하고 선택·완료 근거와 업무를 유지한다", () => {
  const old = oldPair(),
    before = structuredClone(old),
    result = migrateRequiredQualifications(old.state, old.organizations, at);
  assert.deepEqual(old, before, "미리보기는 입력을 변경하지 않음");
  assert.equal(result.state.schemaVersion, 28);
  assert.equal(result.organizations.schemaVersion, 4);
  assert.ok(
    organizationEntries(result.organizations).every(
      (o) => !Object.hasOwn(o, "requiredQualifications"),
    ),
  );
  const open = result.state.planningRequests.find((r) => r.id === "old-open")!;
  assert.equal(open.mode, "learner_choice");
  assert.equal(open.revision, 5);
  assert.deepEqual(open.selections, [old.target]);
  assert.equal(Object.hasOwn(open, "targets"), false);
  const completed = result.state.planningRequests.find(
    (r) => r.id === "old-completed",
  )!;
  assert.equal(completed.revision, 4);
  assert.deepEqual(
    completed.completion,
    old.state.planningRequests[1].completion,
  );
  assert.deepEqual(
    result.state.audits.find(
      (a) => a.action === "migration.planning-choice" && a.targetId === open.id,
    )!.details.before,
    old.state.planningRequests[0],
  );
  assert.ok(
    JSON.stringify(result.organizations.audits).includes(
      '"requiredQualifications"',
    ),
  );
  for (const key of [
    "users",
    "courses",
    "qualifications",
    "plans",
    "assignments",
    "enrollments",
    "attempts",
    "completions",
    "certifications",
    "requests",
    "catalogBatches",
  ] as const)
    assert.deepEqual(result.state[key], old.state[key], key);
  const again = migrateRequiredQualifications(
    result.state,
    result.organizations,
    at,
  );
  assert.equal(again.report.alreadyApplied, true);
  assert.deepEqual(again.state, result.state);
  assert.deepEqual(again.organizations, result.organizations);
  assert.throws(() => validateState(old.state, result.organizations));
  assert.throws(() => validateOrganizations(old.organizations));
  assert.throws(() =>
    migrateRequiredQualifications(old.state, result.organizations),
  );
  assert.throws(() =>
    migrateRequiredQualifications(result.state, old.organizations),
  );
});

test("이전 요청의 대상을 제외·재선택하며 최소1개 계획·초안 제외 제한·삭제 후 제외를 유지한다", async (t) => {
  const f = await fixture(t),
    id = "old-open",
    entity = f.store
      .snapshot()
      .qualifications.find((q) => q.id === "demo-qualification")!.entityId;
  const candidate = await f.call(
    "learner-2",
    `/planning-requests/${id}/candidates`,
  );
  assert.equal(Object.hasOwn(candidate.candidates[0], "required"), false);
  await f.call(
    "learner-2",
    `/planning-requests/${id}/selection`,
    { revision: 4, entityIds: [] },
    409,
    "PUT",
  );
  await f.call(
    "learner-2",
    `/planning-requests/${id}/selection`,
    { revision: 5, entityIds: [] },
    200,
    "PUT",
  );
  await f.call(
    "learner-2",
    `/planning-requests/${id}/complete`,
    { revision: 6, confirmNoAdditional: true },
    409,
  );
  const request = f.store.snapshot().planningRequests.find((r) => r.id === id)!;
  const started = await f.call("learner-2", "/plans", {
    requestId: id,
    requestRevision: request.revision,
    qualificationId: "demo-qualification",
  });
  const selected = f.store
    .snapshot()
    .planningRequests.find((r) => r.id === id)!;
  assert.equal(selected.selections[0]!.entityId, entity);
  await f.call(
    "learner-2",
    `/planning-requests/${id}/selection`,
    { revision: selected.revision, entityIds: [] },
    409,
    "PUT",
  );
  const plan = f.store.snapshot().plans.find((p) => p.id === started.id)!;
  await f.call(
    "learner-2",
    `/plans/${plan.id}`,
    { revision: plan.revision },
    200,
    "DELETE",
  );
  assert.deepEqual(
    f.store.snapshot().planningRequests.find((r) => r.id === id)!.selections,
    [],
  );
});

test("새 요청·개인·조직·현황 응답에는 필수 설정이 없으며 Auditee 요청과 Auditor 자체 학습 정책을 보존한다", async (t) => {
  const f = await fixture(t);
  for (const qualificationType of ["auditee"] as const) {
    const userId = "learner-2";
    const result = await legacyRequestFixture(f.store, "admin-1", {
      learnerIds: [userId],
      qualificationType,
      message: "선택형 요청",
      dueOn: "2030-12-31",
    });
    const request = f.store
      .snapshot()
      .planningRequests.find((r) => r.id === result.ids[0])!;
    assert.equal(Object.hasOwn(request, "targets"), false);
    assert.deepEqual(request.selections, []);
    assert.equal(request.mode, "learner_choice");
  }
  await f.call(
    "admin-1",
    "/planning-requests",
    {
      learnerIds: ["learner-2"],
      qualificationType: "auditor",
      message: "기존 Auditor 자체 학습 유지",
    },
    410,
  );
  const workspace = await f.call("learner-2", "/workspace");
  assert.equal(Object.hasOwn(workspace, "requiredQualifications"), false);
  const org = await f.call("admin-1", "/organization-settings");
  assert.equal(Object.hasOwn(org, "qualifications"), false);
  const dashboard = await f.call("admin-1", "/dashboard");
  assert.equal(Object.hasOwn(dashboard.summary, "requiredCoverage"), false);
  assert.ok(dashboard.charts.every((c: any) => !c.id.includes("coverage")));
});

test("종료 API는 인증·조직 범위 검사 후 본문 파싱·영수증 실행 없이410으로 종료한다", async (t) => {
  const f = await fixture(t),
    before = f.store.snapshot(),
    org = f.store.organizations.snapshot(),
    bytes = await readFile(f.file),
    orgBytes = await readFile(f.store.organizations.file);
  for (const endpoint of [
    "/api/organization-policies",
    "/api/organization-policies/org-photo",
    "/api/organization-policies/org-photo/administrators",
  ]) {
    const r = await f.app.inject({
      method: "PUT",
      url: endpoint,
      headers: {
        cookie: await f.session("admin-1"),
        "content-type": "application/json",
      },
      payload: "{broken-json",
    });
    assert.equal(r.statusCode, 410, r.body);
    assert.equal(r.json().code, "FEATURE_REMOVED");
  }
  await f.call("learner-2", "/me/required-qualifications", undefined, 410);
  await f.call("learner-2", "/organization-policies", undefined, 403);
  await f.call(
    "admin-1",
    "/organization-policies?lv1OrganizationId=org-etch",
    undefined,
    403,
  );
  assert.equal(
    (await f.app.inject({ method: "GET", url: "/api/organization-policies" }))
      .statusCode,
    401,
  );
  for (const query of [
    "required=all",
    "metric=requiredCoverage",
    "metric=requiredMissing",
    "metric=fullyRequiredPeople",
    "sort=coverage",
    "chartId=member-coverage",
    "chartId=qualification-coverage",
  ])
    await f.call("admin-1", `/dashboard?${query}`, undefined, 410);
  const body = {
    revision: org.revision,
    description: "기존 값",
    duties: "업무",
    requiredQualifications: [],
  };
  await f.call("admin-1", "/organization-settings/org-photo", body, 422, "PUT");
  await f.call(
    "admin-1",
    "/planning-requests",
    { learnerIds: ["learner-2"], message: "위조", targets: [] },
    422,
  );
  assert.deepEqual(f.store.snapshot(), before);
  assert.deepEqual(f.store.organizations.snapshot(), org);
  assert.deepEqual(await readFile(f.file), bytes);
  assert.deepEqual(await readFile(f.store.organizations.file), orgBytes);
});

test("JSON11 왕복·구형JSON10 변환은 필수 지정 복원을 막고 검증값과 제외 안내를 보존한다", async (t) => {
  const f = await fixture(t),
    file = exportMaster(
      f.store.snapshot(),
      f.store.organizations.snapshot(),
      at,
    );
  assert.equal(file.formatVersion, 15);
  assert.equal(file.stateSchemaVersion, 26);
  assert.equal(file.organizationSchemaVersion, 4);
  assert.deepEqual(readMaster(file).payload, file.payload);
  const old: any = structuredClone(file);
  old.formatVersion = 10;
  delete old.counts.organizationQualificationRequirements;
  delete old.counts.organizationQualificationRequirements;
  delete old.counts.subjectiveQuestions;
  old.stateSchemaVersion = 20;
  old.organizationSchemaVersion = 3;
  old.payload.organizations.roots[0].requiredQualifications = [
    old.payload.qualifications[0].entityId,
  ];
  old.sha256 = contentHash(old.payload);
  const restored = readMaster(old);
  assert.equal(
    Object.hasOwn(
      restored.payload.organizations.roots[0]!,
      "requiredQualifications",
    ),
    false,
  );
  const invalid = structuredClone(old);
  invalid.payload.organizations.roots[0].requiredQualifications.push(
    "tampered",
  );
  assert.throws(() => readMaster(invalid));
  const current: any = structuredClone(file);
  current.payload.organizations.roots[0].requiredQualifications = [];
  current.sha256 = contentHash(current.payload);
  assert.throws(() => readMaster(current));
});

test("명시 이관의 해시 충돌·파일 교체 실패·재시작·재실행은 세 원본을 보호한다", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-required-migration-")),
    file = path.join(dir, "runtime/state.json"),
    store = new JsonStore(file);
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  await store.initialize(seedState(true));
  const initialized = await loadPlanningFixture(file);
  await initialized.close();
  const old = oldPair();
  await writeFile(file, JSON.stringify(old.state));
  await writeFile(store.organizations.file, JSON.stringify(old.organizations));
  const stateBytes = await readFile(file),
    orgBytes = await readFile(store.organizations.file),
    maintenance = await readFile(store.maintenanceFile);
  const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex"),
    expected = {
      revision: old.state.revision,
      stateHash: hash(stateBytes),
      organizationHash: hash(orgBytes),
    };
  await assert.rejects(
    new JsonStore(file).migratePolicies(
      { ...expected, stateHash: "0".repeat(64) },
      migrateRequiredQualifications,
    ),
  );
  const failed = new JsonStore(file);
  failed.beforeReplace = () => {
    throw Error("replace failure");
  };
  await assert.rejects(
    failed.migratePolicies(expected, migrateRequiredQualifications),
  );
  assert.deepEqual(await readFile(file), stateBytes);
  assert.deepEqual(await readFile(store.organizations.file), orgBytes);
  assert.deepEqual(await readFile(store.maintenanceFile), maintenance);
  const result = await new JsonStore(file).migratePolicies(
    expected,
    migrateRequiredQualifications,
  );
  assert.equal((result as { schemaVersion: number }).schemaVersion, 28);
  const loaded = await loadPlanningFixture(file);
  assert.equal(loaded.snapshot().schemaVersion, 29);
  const after = loaded.snapshot();
  const organizations = loaded.organizations.snapshot();
  await loaded.close();
  const again = await new JsonStore(file).migratePolicies(
    {
      revision: after.revision,
      stateHash: hash(await readFile(file)),
      organizationHash: hash(await readFile(store.organizations.file)),
    },
    migratePlanningSchedule,
  );
  assert.equal((again as { alreadyApplied: boolean }).alreadyApplied, true);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), after);
  assert.deepEqual(
    JSON.parse(await readFile(store.organizations.file, "utf8")),
    organizations,
  );
});
