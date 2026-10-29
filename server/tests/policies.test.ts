import { loadPlanningFixture } from "./planning-migration-helper.ts";
import { historicalContent } from "./historical-content.ts";
import { releaseFixture } from "./release-fixture.ts";
import { legacyPlanFixture } from "./legacy-plan-fixture.ts";
import { legacyRequestFixture } from "./legacy-request-fixture.ts";
import {
  linkFixtureTemplates,
  registerFixtureQualification,
} from "./template-helpers.ts";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  mkdir,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { organizationEntries, type Kind } from "@eks/contracts";
import { seedState } from "../src/seed.ts";
import {
  seedOrganizations,
  validateOrganizations,
  nodeFor,
} from "../src/organizations.ts";
import { JsonStore } from "../src/storage.ts";
import { buildApp } from "./release-test-app.ts";
import { migratePolicies } from "../src/policy-migration.ts";
import { validateState } from "../src/integrity.ts";

const root = "org-photo",
  q1 = "demo-qualification",
  q2 = "recipe-management";
async function fixture(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-policy-")),
    file = path.join(dir, "runtime", "state.json");
  const seed = seedState(true);
  seed.qualifications.push({
    ...structuredClone(seed.qualifications.find((q) => q.id === q1)!),
    id: q2,
    entityId: q2,
    title: "추가 필수 자격",
  });
  await new JsonStore(file).initialize(linkFixtureTemplates(seed));
  const store = await loadPlanningFixture(file);
  let at = "2026-10-21T03:00:00Z";
  const app = await buildApp(store, { clock: () => at }),
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
    method: any = body === undefined ? "GET" : "POST",
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
      method,
      url: "/api" + url,
      headers: { cookie: cookies.get(actor)!, "idempotency-key": key },
      ...(body === undefined ? {} : { payload: body }),
    });
    assert.equal(r.statusCode, status, `${actor} ${url}: ${r.body}`);
    return r.json();
  }
  const revision = () => store.organizations.snapshot().revision;
  const pool = (ids: string[], status = 200, actor = "admin-1") =>
    call(
      actor,
      `/organization-policies/${root}/qualification-pool`,
      { revision: revision(), qualificationIds: ids },
      status === 403 ? 403 : 410,
      "PUT",
    );
  const required = (org: string, ids: string[] | null, status = 200) =>
    call(
      "admin-1",
      `/organization-settings/${org}`,
      {
        revision: revision(),
        description: "장비 운영",
        duties: "기준 확인·진단",
      },
      status,
      "PUT",
    );
  const entities = (ids: string[]) =>
    ids.map(
      (id) =>
        store.snapshot().qualifications.find((q) => q.id === id)!.entityId,
    );
  const setup = async (ids = [q1], org = root) => {
    await pool(ids);
    await required(org, entities(ids));
  };
  const invite = async (learner = "learner-2", status = 200) =>
    (
      await (status === 200
        ? legacyRequestFixture(store, "admin-1", {
            learnerIds: [learner],
            message: "기존 선택형 요청",
          })
        : call(
            "admin-1",
            "/planning-requests",
            {
              learnerIds: [learner],
              message: "",
              stateRevision: store.snapshot().revision,
              organizationRevision: store.organizations.snapshot().revision,
            },
            status,
          ))
    ).ids?.[0];
  const plan = async (requestId: string, q = q1, learner = "learner-2") => {
    const { id } = await call(learner, "/plans", {
      requestRevision: store
        .snapshot()
        .planningRequests.find((r) => r.id === requestId)!.revision,
      requestId,
      qualificationId: q,
    });
    const p = store.snapshot().plans.find((p) => p.id === id)!;
    await call(
      learner,
      `/plans/${id}`,
      {
        revision: p.revision,
        endOn: "2027-01-01",
        startOn: "2026-10-28",
        goal: "독립적으로 판단",
      },
      200,
      "PUT",
    );
    return store.snapshot().plans.find((p) => p.id === id)!;
  };
  const complete = (id: string, learner = "learner-2", status = 200) =>
    call(
      learner,
      `/plans/${id}/complete`,
      { revision: store.snapshot().plans.find((p) => p.id === id)!.revision },
      status,
    );
  async function finish(enrollment: string, kind: Kind, learner = "learner-2") {
    const c = store
      .snapshot()
      .courses.find(
        (c) =>
          c.id ===
          store.snapshot().enrollments.find((e) => e.id === enrollment)!
            .courseId,
      )!;
    const a = await call(learner, `/enrollments/${enrollment}/attempts`, {
      kind,
    });
    await call(
      learner,
      `/attempts/${a.id}/draft`,
      {
        revision: a.revision,
        answers: Object.fromEntries(
          (kind === "objective" ? c.questions : c.practicalQuestions).map(
            (q) => [q.id, q.correct],
          ),
        ),
      },
      200,
      "PUT",
    );
    const key = randomUUID(),
      payload = { revision: a.revision + 1 };
    const r = await call(
      learner,
      `/attempts/${a.id}/submit`,
      payload,
      200,
      "POST",
      key,
    );
    assert.deepEqual(
      await call(
        learner,
        `/attempts/${a.id}/submit`,
        payload,
        200,
        "POST",
        key,
      ),
      r,
    );
  }
  return {
    dir,
    file,
    store,
    call,
    revision,
    pool,
    required,
    entities,
    setup,
    invite,
    plan,
    complete,
    finish,
    clock: (v: string) => {
      at = v;
    },
  };
}

test("Lv5·Lv10·100단계 조직의 생성·소속·경로·직속 및 순환 방지", async (t) => {
  const f = await fixture(t);
  let parent = "org-photo-pyeongtaek-1";
  for (let level = 5; level <= 10; level++)
    parent = (
      await f.call("operator-1", "/system/organizations", {
        revision: f.revision(),
        parentId: parent,
        name: `깊은 조직 ${level}`,
      })
    ).id;
  const u = await f.call("operator-1", "/system/users", {
    name: "깊은 소속",
    organizationId: parent,
    roles: ["learner"],
  });
  const view = await f.call(u.id, "/session");
  assert.equal(view.actor.organizationPath.length, 10);
  await f.call(
    "operator-1",
    `/system/organizations/${parent}`,
    { revision: f.revision(), parentId: parent },
    422,
    "PATCH",
  );
  await f.call(
    "operator-1",
    "/system/organizations/org-photo-fmg",
    { revision: f.revision(), parentId: "org-etch" },
    422,
    "PATCH",
  );
  const doc = f.store.organizations.snapshot();
  let node = nodeFor(doc.roots, parent)!;
  for (let level = 11; level <= 100; level++) {
    const child = {
      id: `deep-${level}`,
      name: `하위 ${level}`,
      active: true,
      children: [],
    };
    node.children.push(child);
    node = child;
  }
  assert.equal(
    organizationEntries(validateOrganizations(doc)).at(-1)?.level,
    4,
  ); // root order unchanged
  assert.equal(
    organizationEntries(validateOrganizations(doc)).find(
      (e) => e.id === "deep-100",
    )!.path.length,
    100,
  );
  node.children.push(doc.roots[0]!);
  assert.throws(() => validateOrganizations(doc), /순환/);
});

test("운영자는 소속을 유지하고 선택 Lv1 정책을 관리하며 재시도 대상 변경은 차단한다", async (t) => {
  const f = await fixture(t),
    before = f.store.snapshot().users.find((u) => u.id === "operator-1"),
    key = randomUUID(),
    body = {
      revision: f.revision(),
      description: "Etch 조직 기준",
      duties: "설비 운영",
    };
  await f.call("operator-1", "/organization-settings", undefined, 403);
  const scope = "?lv1OrganizationId=org-etch";
  await f.call(
    "operator-1",
    "/organization-settings/org-etch",
    body,
    403,
    "PUT",
  );
  const result = await f.call(
    "operator-1",
    "/organization-settings/org-etch" + scope,
    body,
    200,
    "PUT",
    key,
  );
  assert.deepEqual(
    await f.call(
      "operator-1",
      "/organization-settings/org-etch" + scope,
      body,
      200,
      "PUT",
      key,
    ),
    result,
  );
  await f.call(
    "operator-1",
    "/organization-settings/org-photo?lv1OrganizationId=org-photo",
    body,
    409,
    "PUT",
    key,
  );
  const view = await f.call("operator-1", "/organization-settings" + scope);
  assert.ok(view.entries.every((e: any) => e.lv1OrganizationId === "org-etch"));
  assert.equal(view.entries[0].description, body.description);
  assert.deepEqual(
    f.store.snapshot().users.find((u) => u.id === "operator-1"),
    before,
  );
  const master = f.store.organizations.snapshot();
  assert.equal(master.audits.at(-1)?.actorId, "operator-1");
  assert.equal(master.audits.at(-1)?.targetId, "org-etch");
  assert.equal(master.requests.at(-1)?.lv1OrganizationId, "org-etch");
});

test("적용 버전·소속 변경은 초안 확정을 막고 입력과 요청 스냅샷을 보존", async (t) => {
  const f = await fixture(t);
  await f.setup();
  const request = await f.invite(),
    p = await f.plan(request),
    before = structuredClone({
      startOn: p.startOn,
      endOn: p.endOn,
      goal: p.goal,
    });
  const v = await f.call(
    "admin-1",
    ...releaseFixture(f.store.snapshot(), "qualifications", q1),
    200,
    "PUT",
  );
  const draft = f.store.snapshot().qualifications.find((q) => q.id === v.id)!;
  await f.call("admin-1", `/qualifications/${v.id}`, draft, undefined, "PUT");
  await f.pool([v.id]);
  await f.complete(p.id, "learner-2", 409);
  assert.deepEqual(
    ((p) => ({ startOn: p.startOn, endOn: p.endOn, goal: p.goal }))(
      f.store.snapshot().plans.find((x) => x.id === p.id)!,
    ),
    before,
  );
  await f.call(
    "learner-2",
    `/plans/${p.id}`,
    { revision: p.revision },
    200,
    "DELETE",
  );
  const newer = await f.plan(request, v.id);
  assert.equal(newer.qualificationId, v.id);
  assert.equal(
    f.store.snapshot().planningRequests.find((r) => r.id === request)!
      .selections[0]!.version,
    2,
  );
  await f.call(
    "operator-1",
    "/system/users/learner-2",
    {
      name: "정하린",
      roles: ["learner"],
      revision: 1,
      organizationId: "org-photo-pyeongtaek-1",
    },
    200,
    "PATCH",
  );
  await f.required("org-photo-pyeongtaek-1", f.entities([v.id]));
  await f.complete(newer.id, "learner-2", 409);
  assert.equal(
    f.store.snapshot().planningRequests.find((r) => r.id === request)!
      .organizationId,
    root,
  );
});

test("학습 기록 없이 두 평가·수료·인증, 유효 구버전 인증 충족·만료 후 이력 보존", async (t) => {
  const f = await fixture(t);
  await f.setup();
  const request = await f.invite(),
    p = await f.plan(request),
    a = await f.complete(p.id);
  const enrollments = f.store
    .snapshot()
    .enrollments.filter((e) => e.assignmentId === a.assignmentId);
  await f.call(
    "learner-2",
    `/enrollments/${enrollments[0]!.id}/learning`,
    { revision: 0 },
    410,
    "PUT",
  );
  for (const e of enrollments) {
    const c = f.store.snapshot().courses.find((c) => c.id === e.courseId)!;
    for (const kind of c.assessmentKinds) await f.finish(e.id, kind);
  }
  assert.equal(f.store.snapshot().learningRecords.length, 0);
  const cert = f.store
    .snapshot()
    .certifications.find((c) => c.assignmentId === a.assignmentId)!;
  assert.ok(cert);
  const v = await f.call(
    "admin-1",
    ...releaseFixture(f.store.snapshot(), "qualifications", q1),
    200,
    "PUT",
  );
  await f.call(
    "admin-1",
    `/qualifications/${v.id}`,
    f.store.snapshot().qualifications.find((q) => q.id === v.id),
    undefined,
    "PUT",
  );
  await f.pool([v.id]);

  const summary = (await f.call("admin-1", "/workspace")).requestProgress.find(
    (r: any) => r.id === request,
  );
  assert.equal(summary.planned, 1);
  assert.equal(summary.valid, 1);
  assert.deepEqual(
    f.store.snapshot().certifications.find((c) => c.id === cert.id),
    cert,
  );
  await f.call(
    "learner-2",
    "/plans",
    {
      requestRevision: f.store
        .snapshot()
        .planningRequests.find((r) => r.id === request)!.revision,
      requestId: request,
      qualificationId: v.id,
    },
    409,
  );
  // Replace only policy for an expiry test, preserving original assessment evidence.
  await f.store.transact(
    "operator-1",
    randomUUID(),
    "test-expiry",
    () => {},
    (s) => {
      const c = s.certifications.find((c) => c.id === cert.id)!;
      c.validity = { type: "months", months: 1, reminderDays: [7] };
      c.expiresOn = "2026-11-21";
      c.periods![0]!.validity = structuredClone(c.validity);
      c.periods![0]!.expiresOn = c.expiresOn;
      return {};
    },
  );
  f.clock("2026-11-22T01:00:00Z");

  assert.equal(
    f.store
      .snapshot()
      .certifications.filter((c) => c.assignmentId === a.assignmentId).length,
    1,
  );
});

test("운영 종료는 새 계획을 막고 설정과 확정 진행·복구 참조를 보존", async (t) => {
  const f = await fixture(t);
  await f.setup();
  const p = await f.plan(await f.invite());
  await f.complete(p.id);
  const c = f.store.snapshot().qualifications.find((q) => q.id === q1)!
    .courseIds[0]!;
  const usage = await f.call("admin-1", `/courses/${c}/usage`);
  await f.call("admin-1", `/courses/${c}/retirement`, {
    ...usage,
    reason: "운영 종료 시험",
  });
  await f
    .call("operator-1", "/system/users", {
      name: "새 대상",
      organizationId: root,
      roles: ["learner"],
    })
    .then((u) => f.invite(u.id));
  assert.ok(f.store.snapshot().qualifications.some((q) => q.id === q1));
  const wrong = f.store.snapshot();
  wrong.qualifications = wrong.qualifications.filter((q) => q.id !== q1);
  assert.throws(() => validateState(wrong, f.store.organizations.snapshot()));
  assert.doesNotThrow(() =>
    validateState(f.store.snapshot(), f.store.organizations.snapshot()),
  );
});

const hash = (b: Buffer | string) =>
  createHash("sha256").update(b).digest("hex");
test("6/1→8/2 백업 쌍·기존 진행 보존·실패 복구·재실행 무변경", async (t) => {
  const f = await fixture(t);
  await f.setup();
  const p = await f.plan(await f.invite());
  await f.complete(p.id);
  const raw: any = f.store.snapshot(),
    org: any = f.store.organizations.snapshot();
  raw.schemaVersion = 6;
  legacyPlanFixture(raw);
  org.schemaVersion = 1;
  delete org.qualificationPools;
  for (const e of organizationEntries(org)) {
    const n: any = nodeFor(org.roots, e.id);
    delete n.description;
    delete n.duties;
  }
  raw.plans.forEach((p: any) => {
    p.workflowVersion = "personal-certification-v2";
    delete p.organizationId;
    delete p.policyRevision;
  });
  raw.planningRequests.forEach((r: any) => {
    delete r.organizationId;
    delete r.organizationPath;
    delete r.selections;
    delete r.source;
  });
  const e = raw.enrollments.find(
      (e: any) => e.assignmentId === raw.plans[0].assignmentId,
    ),
    c = raw.courses.find((c: any) => c.id === e.courseId);
  raw.learningRecords.push({
    id: "history",
    enrollmentId: e.id,
    itemId: c.learningItems[0].id,
    learnerId: "learner-2",
    revision: 1,
    performedOn: "2026-10-21",
    content: "이관 전 기록",
    evidenceUrl: "",
    createdAt: "2026-10-21T03:00:00Z",
    updatedAt: "2026-10-21T03:00:00Z",
  });
  const directory = await mkdtemp(path.join(tmpdir(), "eks-policy-migrate-")),
    file = path.join(directory, "runtime", "state.json"),
    orgFile = path.join(directory, "master", "organizations.json");
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.dirname(file), { recursive: true });
  await mkdir(path.dirname(orgFile), { recursive: true });
  const b = JSON.stringify(raw),
    o = JSON.stringify(org);
  await writeFile(file, b);
  await writeFile(orgFile, o);
  const expected = {
    revision: raw.revision,
    stateHash: hash(b),
    organizationHash: hash(o),
  };
  const failing = new JsonStore(file);
  failing.beforeReplace = () => {
    throw Error("middle failure");
  };
  await assert.rejects(
    failing.migratePolicies(expected, migratePolicies),
    /middle failure/,
  );
  assert.equal(await readFile(file, "utf8"), b);
  assert.equal(await readFile(orgFile, "utf8"), o);
  const result: any = await new JsonStore(file).migratePolicies(
    expected,
    migratePolicies,
  );
  assert.equal(await readFile(result.stateBackup, "utf8"), b);
  assert.equal(await readFile(result.organizationBackup, "utf8"), o);
  const loaded = await loadPlanningFixture(file);
  const migrated = loaded.snapshot(),
    master = loaded.organizations.snapshot();
  await loaded.close();
  assert.equal(migrated.schemaVersion, 29);
  assert.equal(master.schemaVersion, 4);
  for (const key of [
    "users",
    "courses",
    "qualifications",
    "assignments",
    "enrollments",
    "learningRecords",
    "attempts",
    "completions",
    "certifications",
  ] as const)
    assert.deepEqual(
      migrated[key].map((r: any) => {
        const copy = { ...r };
        delete copy.frozenCriteria;
        delete copy.certificationEligibility;
        delete copy.lifecycleStatus;
        delete copy.renewalLeadMonths;
        delete copy.renewalNoticeDaysBefore;
        delete copy.acquisitionCycleId;
        return copy;
      }),
      raw[key].map((r: any) => {
        const copy = { ...r };
        delete copy.frozenCriteria;
        delete copy.certificationEligibility;
        delete copy.lifecycleStatus;
        delete copy.renewalLeadMonths;
        delete copy.renewalNoticeDaysBefore;
        delete copy.acquisitionCycleId;
        return copy;
      }),
    );
  assert.equal(migrated.plans[0]!.workflowVersion, "personal-certification-v6");
  assert.equal(
    migrated.plans[0]!.previousSchedule!.workflowVersion,
    "personal-certification-v2",
  );
  assert.deepEqual(
    migrated.plans[0]!.previousSchedule!.schedules,
    raw.plans[0].schedules,
  );
  assert.equal(migrated.planningRequests[0]!.source, "migration");
  assert.equal("qualificationPools" in master, false);
  const after = await readFile(file),
    orgAfter = await readFile(orgFile),
    backups = await readdir(path.join(directory, "backups"));
  await new JsonStore(file).migratePolicies(
    {
      revision: migrated.revision,
      stateHash: hash(after),
      organizationHash: hash(orgAfter),
    },
    migratePolicies,
  );
  assert.deepEqual(await readFile(file), after);
  assert.deepEqual(await readFile(orgFile), orgAfter);
  assert.deepEqual(await readdir(path.join(directory, "backups")), backups);
  await writeFile(`${file}.policy-migration.json`, "{}");
  await assert.rejects(new JsonStore(file).load(), /이관이 중단/);
});

test("정책 이관 백업 실패·변경된 해시·부분 이관은 원본을 교체하지 않는다", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-policy-fail-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const raw: any = seedState(true),
    org: any = seedOrganizations();
  raw.schemaVersion = 6;
  legacyPlanFixture(raw);
  org.schemaVersion = 1;
  delete org.qualificationPools;
  const file = path.join(dir, "runtime", "state.json"),
    master = path.join(dir, "master", "organizations.json");
  await mkdir(path.dirname(file), { recursive: true });
  await mkdir(path.dirname(master), { recursive: true });
  const b = JSON.stringify(raw),
    o = JSON.stringify(org);
  await writeFile(file, b);
  await writeFile(master, o);
  const store = new JsonStore(file);
  const expected = {
    revision: raw.revision,
    stateHash: hash(b),
    organizationHash: hash(o),
  };
  await assert.rejects(
    store.migratePolicies(
      { ...expected, stateHash: "changed" },
      migratePolicies,
    ),
    /미리보기/,
  );
  await mkdir(path.dirname(store.backupDir), { recursive: true });
  await writeFile(store.backupDir, "backup denied");
  await assert.rejects(store.migratePolicies(expected, migratePolicies));
  assert.equal(await readFile(file, "utf8"), b);
  assert.equal(await readFile(master, "utf8"), o);
  assert.throws(
    () => migratePolicies(raw, { ...org, schemaVersion: 2 }),
    /파일 쌍/,
  );
});
