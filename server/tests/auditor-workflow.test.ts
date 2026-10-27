import { criteriaFingerprint } from "../src/releases.ts";
import { legacyPlanFixture } from "./legacy-plan-fixture.ts";
import { legacyRequestFixture } from "./legacy-request-fixture.ts";
import { executeWorkflow } from "../src/workflow.ts";
import { userView } from "../src/organizations.ts";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { seedState } from "../src/seed.ts";
import { seedOrganizations } from "../src/organizations.ts";
import { JsonStore } from "../src/storage.ts";
import { buildApp } from "./release-test-app.ts";
import { courseTypeEditing } from "../src/course-types.ts";
import { migrateCourseTypes } from "../src/course-type-migration.ts";
import { validateState } from "../src/integrity.ts";
import { exportMaster, readMaster, contentHash } from "./legacy-master-data.ts";
import { addQualification } from "./dashboard-fixtures.ts";
async function fixture(
  t: TestContext,
  prepare?: (s: ReturnType<typeof seedState>) => void,
) {
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
  prepare?.(seed);
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
    status: number | number[] = 200,
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
    assert(
      (Array.isArray(status) ? status : [status]).includes(r.statusCode),
      `${r.statusCode}: ${r.body}`,
    );
    return r.json();
  }
  return { store, app, call, file };
}

async function setupAuditor(t: TestContext) {
  const f = await fixture(t, (s) => {
    s.users.find((u) => u.id === "learner-2")!.roles = ["evaluator"];
    addQualification({ state: s, orgs: seedOrganizations() }, "auditor-check", {
      qualificationType: "auditor",
      title: "심사원 최소역량",
    });
  });
  const q = f.store
    .snapshot()
    .qualifications.find((q) => q.entityId === "auditor-check")!;
  assert(q);
  const r = await legacyRequestFixture(f.store, "admin-1", {
    qualificationType: "auditor",
    learnerIds: ["learner-2"],
    message: "이전 계획 보존 시험",
  });
  const requestId = r.ids[0],
    request = f.store
      .snapshot()
      .planningRequests.find((r) => r.id === requestId)!;
  return { ...f, q, requestId, request };
}
// Historical fixture construction bypasses retired authorization, not the live API.
async function legacyCommand(
  f: any,
  actor: string,
  action: string,
  target: string,
  body: any,
): Promise<any> {
  return f.store.transact(
    actor,
    randomUUID(),
    randomUUID(),
    () => {},
    (s: any) =>
      executeWorkflow(
        s,
        userView(
          s.users.find((u: any) => u.id === actor),
          f.store.organizations.snapshot(),
        ),
        action,
        target,
        body,
        f.store.organizations.snapshot(),
      ),
  );
}
async function startPlan(f: Awaited<ReturnType<typeof setupAuditor>>) {
  const { id } = await legacyCommand(f, "learner-2", "plan.create", "", {
    requestId: f.requestId,
    requestRevision: f.request.revision,
    qualificationId: f.q.id,
  });
  let p = f.store.snapshot().plans.find((p) => p.id === id)!;
  await legacyCommand(f, "learner-2", "plan.save", id, {
    revision: p.revision,
    endOn: "2028-12-01",
    startOn: "2027-01-01",
    goal: "",
  });
  p = f.store.snapshot().plans.find((p) => p.id === id)!;
  const a = await legacyCommand(f, "learner-2", "plan.complete", id, {
    revision: p.revision,
    criteriaToken: criteriaFingerprint(f.store.snapshot(), f.q),
  });
  return f.store
    .snapshot()
    .enrollments.filter((e) => e.assignmentId === a.assignmentId);
}

test("이전 Auditor 계획 보존·항목 확인·자동 수료 발급과 잠금", async (t) => {
  const f = await setupAuditor(t),
    es = await startPlan(f);
  for (const e of es) {
    const c = f.store.snapshot().courses.find((c) => c.id === e.courseId)!;
    let revision = 0;
    for (const item of c.learningItems.filter((i) => i.required)) {
      const key = randomUUID(),
        body = { revision, itemId: item.id, checked: true };
      const result = await f.call(
        "learner-2",
        `/enrollments/${e.id}/checklist`,
        body,
        200,
        "PUT",
        key,
      );
      assert.deepEqual(
        await f.call(
          "learner-2",
          `/enrollments/${e.id}/checklist`,
          body,
          200,
          "PUT",
          key,
        ),
        result,
      );
      revision = result.revision;
    }
    await f.call(
      "learner-2",
      `/enrollments/${e.id}/checklist`,
      { revision, itemId: c.learningItems[0]!.id, checked: false },
      409,
      "PUT",
    );
    await f.call(
      "learner-2",
      `/enrollments/${e.id}/attempts`,
      { kind: "objective" },
      403,
    );
  }
  const s = f.store.snapshot();
  assert.equal(
    s.certifications.filter((c) => c.qualificationId === f.q.id).length,
    1,
  );
  assert(
    s.completions
      .filter((c) => es.some((e) => e.id === c.enrollmentId))
      .every(
        (c) =>
          c.method === "self_confirmation" &&
          !c.evidence.length &&
          c.learningEvidence.length,
      ),
  );
  assert.equal(
    s.attempts.filter((a) => es.some((e) => e.id === a.enrollmentId)).length,
    0,
  );
  assert(
    s.notifications.some(
      (n) => n.title.startsWith("[Auditor]") && n.type === "certification",
    ),
  );
  const cert = s.certifications.find((c) => c.qualificationId === f.q.id)!;
  await f.call(
    "learner-2",
    `/certifications/${cert.id}/renewals`,
    { certificationRevision: cert.revision },
    409,
  );
  const user = s.users.find((u) => u.id === "learner-2")!;
  await f.call(
    "operator-1",
    `/system/users/${user.id}`,
    {
      name: user.name,
      organizationId: user.organizationId,
      roles: ["learner", "evaluator"],
      revision: user.revision,
    },
    200,
    "PATCH",
  );
  const renewal = await f.call(
    "learner-2",
    `/certifications/${cert.id}/renewals`,
    { certificationRevision: cert.revision },
    409,
  );
  assert.equal(renewal.code, "RENEWAL_UNAVAILABLE");
  const legacyHistory = await f.call(
    "learner-2",
    `/certifications/${cert.id}/history`,
    undefined,
    200,
    "GET",
  );
  assert.equal(legacyHistory.canRenew, false);
  await f.call(
    "learner-2",
    `/enrollments/${es[0]!.id}/attempts`,
    { kind: "objective" },
    409,
  );
  assert.equal(f.store.snapshot().renewals.length, 0);
  validateState(s, f.store.organizations.snapshot());
});
test("역할 해제 후 기존 Auditor 배정은 계속되고 새 계획 쓰기는 종료", async (t) => {
  const f = await setupAuditor(t);
  const user = f.store.snapshot().users.find((u) => u.id === "learner-2")!;
  await f.call(
    "operator-1",
    `/system/users/${user.id}`,
    {
      name: user.name,
      organizationId: user.organizationId,
      roles: ["learner"],
      revision: user.revision,
    },
    200,
    "PATCH",
  );
  await f.call(
    "admin-1",
    "/planning-requests",
    { qualificationType: "auditor", learnerIds: [user.id], message: "" },
    410,
  );
  await f.call(
    user.id,
    "/plans",
    {
      requestId: f.requestId,
      requestRevision: f.request.revision,
      qualificationId: "demo-qualification",
    },
    410,
  );
  const es = await startPlan(f);
  const e = es[0]!,
    c = f.store.snapshot().courses.find((c) => c.id === e.courseId)!;
  await f.call(
    user.id,
    `/enrollments/${e.id}/attempts`,
    { kind: "objective" },
    409,
  );
  await f.call(
    "learner-1",
    `/enrollments/${e.id}/checklist`,
    { revision: 0, itemId: c.learningItems[0]!.id, checked: true },
    403,
    "PUT",
  );
  await f.call(
    user.id,
    `/enrollments/${e.id}/checklist`,
    { revision: 0, itemId: "forged", checked: true },
    422,
    "PUT",
  );
  await f.call(
    user.id,
    `/enrollments/${e.id}/checklist`,
    { revision: 1, itemId: c.learningItems[0]!.id, checked: true },
    409,
    "PUT",
  );
  await f.call(
    user.id,
    `/enrollments/${e.id}/checklist`,
    { revision: 0, itemId: c.learningItems[0]!.id, checked: true },
    200,
    "PUT",
  );
});

test("체크 해제·선택 항목·최종 동시 확인과 파일 실패는 수료 근거를 중복하거나 유실하지 않는다", async (t) => {
  const f = await setupAuditor(t);
  await f.store.transact(
    "operator-1",
    randomUUID(),
    "check items fixture",
    () => {},
    (s) => {
      for (const id of f.q.courseIds) {
        const c = s.courses.find((c) => c.id === id)!;
        c.learningItems = [
          { id: id + "-1", title: "필수 하나", type: "mtc", required: true },
          { id: id + "-2", title: "필수 둘", type: "ojt", required: true },
          { id: id + "-3", title: "선택", type: "team", required: false },
        ];
      }
      return {};
    },
  );
  const es = await startPlan(f),
    e = es[0]!,
    url = `/enrollments/${e.id}/checklist`,
    c = f.store.snapshot().courses.find((c) => c.id === e.courseId)!;
  const first = { revision: 0, itemId: c.learningItems[0]!.id, checked: true };
  const before = await readFile(f.file);
  f.store.beforeReplace = () => {
    throw new Error("checklist disk failure");
  };
  const key = randomUUID();
  await f.call("learner-2", url, first, 503, "PUT", key);
  assert.deepEqual(await readFile(f.file), before);
  f.store.beforeReplace = undefined;
  await f.call("learner-2", url, first, 200, "PUT", key);
  await f.call(
    "learner-2",
    url,
    { ...first, revision: 1, checked: false },
    200,
    "PUT",
  );
  assert.equal(
    f.store.snapshot().completions.filter((c) => c.enrollmentId === e.id)
      .length,
    0,
  );
  await f.call("learner-2", url, { ...first, revision: 2 }, 200, "PUT");
  const results = await Promise.all([
    f.call(
      "learner-2",
      url,
      { revision: 3, itemId: c.learningItems[1]!.id, checked: true },
      [200, 409],
      "PUT",
    ),
    f.call(
      "learner-2",
      url,
      { revision: 3, itemId: c.learningItems[1]!.id, checked: true },
      [200, 409],
      "PUT",
    ),
  ]);
  assert.equal(
    results.filter((r) => r.code === "CHECKLIST_COMPLETED").length,
    1,
  );
  const done = f.store
    .snapshot()
    .completions.find((c) => c.enrollmentId === e.id)!;
  assert.equal(done.learningEvidence.length, 2);
  assert.equal(done.method, "self_confirmation");
  await f.call(
    "learner-2",
    url,
    { revision: 4, itemId: c.learningItems[2]!.id, checked: true },
    409,
    "PUT",
  );
  await f.app.close();
  const restarted = await new JsonStore(f.file).load();
  assert.deepEqual(
    restarted.snapshot().completions.find((c) => c.id === done.id),
    done,
  );
});
test("Hold·검증 제외·진행 전 요청은 확인 저장을 막고 관리자 유형 집계를 분리한다", async (t) => {
  const f = await setupAuditor(t),
    es = await startPlan(f),
    e = es[0]!,
    c = f.store.snapshot().courses.find((c) => c.id === e.courseId)!;
  const url = `/enrollments/${e.id}/checklist`,
    body = { revision: 0, itemId: c.learningItems[0]!.id, checked: true };
  await f.store.transact(
    "operator-1",
    randomUUID(),
    "hold fixture",
    () => {},
    (s) => {
      s.users.find((u) => u.id === "learner-2")!.certificationEligibility =
        "hold";
      return {};
    },
  );
  await f.call("learner-2", url, body, [409, 422], "PUT");
  await f.store.transact(
    "operator-1",
    randomUUID(),
    "excluded fixture",
    () => {},
    (s) => {
      s.users.find((u) => u.id === "learner-2")!.certificationEligibility =
        "eligible";
      s.assignments.find((a) => a.id === e.assignmentId)!.excludedReason =
        "fixture excluded";
      return {};
    },
  );
  await f.call("learner-2", url, body, [409, 422], "PUT");
  assert.equal(f.store.snapshot().learningChecklists.length, 0);
  const auditor = await f.call(
    "admin-1",
    "/dashboard?qualificationType=auditor",
  );
  const auditee = await f.call(
    "admin-1",
    "/dashboard?qualificationType=auditee",
  );
  assert.equal(auditor.summary.eligiblePeople, 1);
  assert(auditee.summary.eligiblePeople > 1);
  await f.call(
    "admin-1",
    "/dashboard?qualificationType=unknown",
    undefined,
    422,
  );
});
test("15→16 명시적 이관·파일 실패 복구·재실행·이전 파일과 Auditor 평가 필드 변조 차단", async (t) => {
  const { migrateAuditorWorkflow } =
    await import("../src/auditor-migration.ts");
  const f = await fixture(t),
    raw: any = f.store.snapshot();
  await f.app.close();
  raw.schemaVersion = 15;
  legacyPlanFixture(raw);
  delete raw.learningChecklists;
  for (const r of raw.planningRequests) delete r.qualificationType;
  for (const c of raw.completions) {
    delete c.method;
    delete c.learningEvidence;
  }
  await writeFile(f.file, JSON.stringify(raw, null, 2));
  const before = await readFile(f.file),
    org = await readFile(f.store.organizations.file),
    hash = (v: Buffer) => createHash("sha256").update(v).digest("hex");
  const preview = migrateAuditorWorkflow(raw, JSON.parse(org.toString()));
  assert.equal(preview.state.schemaVersion, 26);
  assert.equal(preview.state.revision, raw.revision + 11);
  assert.equal(raw.schemaVersion, 15);
  const disk = new JsonStore(f.file),
    expected = {
      revision: raw.revision,
      organizationRevision: JSON.parse(org.toString()).revision,
      stateHash: hash(before),
      organizationHash: hash(org),
    };
  disk.beforeReplace = () => {
    throw new Error("migration disk failure");
  };
  await assert.rejects(
    disk.migratePolicies(expected, migrateAuditorWorkflow, "auditor-workflow"),
    /migration disk failure/,
  );
  assert.deepEqual(await readFile(f.file), before);
  assert.deepEqual(await readFile(disk.organizations.file), org);
  disk.beforeReplace = undefined;
  await disk.migratePolicies(
    expected,
    migrateAuditorWorkflow,
    "auditor-workflow",
  );
  const after = await readFile(f.file);
  await disk.migratePolicies(
    {
      ...expected,
      revision: JSON.parse(after.toString()).revision,
      stateHash: hash(after),
    },
    migrateAuditorWorkflow,
    "auditor-workflow",
  );
  assert.deepEqual(await readFile(f.file), after);
  const fresh = await new JsonStore(f.file).load();
  const master = exportMaster(
    fresh.snapshot(),
    fresh.organizations.snapshot(),
    new Date().toISOString(),
  );
  assert.equal(master.formatVersion, 15);
  assert.deepEqual(readMaster(master).payload, master.payload);
  const legacy: any = structuredClone(master);
  delete legacy.payload.commonCourses;
  delete legacy.counts.commonCourses;
  legacy.formatVersion = 5;
  delete legacy.counts.organizationQualificationRequirements;
  delete legacy.counts.subjectiveQuestions;
  legacy.organizationSchemaVersion = 2;
  legacy.payload.organizations.qualificationPools = [];
  legacy.counts.poolEntries = 0;
  legacy.stateSchemaVersion = 15;
  legacy.sha256 = contentHash(legacy.payload);
  assert.deepEqual(readMaster(legacy).payload, master.payload);
  const g = await setupAuditor(t);
  const course = g.store
    .snapshot()
    .courses.find((c) => c.id === g.q.courseIds[0])!;
  await g.call(
    "admin-1",
    `/courses/${course.id}`,
    { ...course, questions: [] },
    422,
    "PUT",
  );
  const incomplete = await g.call("admin-1", "/courses", {
    title: "Auditor 초안",
    qualificationType: "auditor",
  });
  assert.deepEqual(
    g.store.snapshot().courses.find((c) => c.id === incomplete.id)!
      .assessmentKinds,
    [],
  );
});
