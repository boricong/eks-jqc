import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import {
  currentTeamQualifications,
  qualificationUseErrors,
} from "@eks/contracts";
import { seedState } from "../src/seed.ts";
import { JsonStore } from "../src/storage.ts";
import { buildApp } from "../src/app.ts";
import { migrateAutomaticCriteria } from "../src/automatic-criteria-migration.ts";
import { exportMaster, readMaster, contentHash } from "../src/master-data.ts";

async function fixture(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-automatic-criteria-"));
  const file = path.join(dir, "runtime/state.json");
  await new JsonStore(file).initialize(seedState(true));
  const store = await new JsonStore(file).load();
  const app = await buildApp(store);
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
  return { dir, file, store, app, call };
}

test("설명 생략 생성·편집은 준비를 막지 않고 수동 적용 없이 최신 버전으로 계획을 시작한다", async (t) => {
  const f = await fixture(t);
  const base = await f.call("operator-1", "/system/qualification-templates", {
    title: "설명 없는 기준",
    englishName: "",
  });
  const imported = await f.call("admin-1", "/qualification-templates/import", {
    templateIds: [base.id],
  });
  let q = f.store
    .snapshot()
    .qualifications.find((q) => q.id === imported.imported[0])!;
  const configured = await f.call(
    "admin-1",
    "/qualifications/" + q.id,
    {
      ...q,
      description: undefined,
      courseIds: ["demo-course-1"],
      validity: { type: "unlimited", months: null, reminderDays: [] },
    },
    200,
    "PUT",
  );
  q = f.store.snapshot().qualifications.find((q) => q.id === configured.id)!;
  assert.equal(q.description, "");
  assert.deepEqual(qualificationUseErrors(q, f.store.snapshot().courses), []);
  const revision = f.store.organizations.snapshot().revision;
  await f.call(
    "admin-1",
    "/organization-policies/org-photo",
    {
      revision,
      description: "",
      duties: "",
      requiredQualifications: [q.entityId],
    },
    200,
    "PUT",
  );
  const request = await f.call("admin-1", "/planning-requests", {
    learnerIds: ["learner-2"],
    message: "",
  });
  const r = f.store
    .snapshot()
    .planningRequests.find((r) => r.id === request.ids[0])!;
  const start = await f.call("learner-2", "/plans", {
    requestId: r.id,
    requestRevision: r.revision,
    qualificationId: q.id,
  });
  assert(f.store.snapshot().plans.some((p) => p.id === start.id));
  const before = f.store.snapshot();
  await f.call(
    "admin-1",
    "/organization-policies/org-photo/qualification-pool",
    { revision, qualificationIds: [] },
    410,
    "PUT",
  );
  await f.call(
    "learner-2",
    "/organization-policies/org-photo/qualification-pool",
    { revision, qualificationIds: [] },
    403,
    "PUT",
  );
  assert.deepEqual(f.store.snapshot(), before);
  const revised = await f.call(
    "admin-1",
    "/qualifications/" + q.id,
    { ...q, versionMode: "new", courseIds: [] },
    200,
    "PUT",
  );
  const candidates = await f.call(
    "learner-2",
    `/planning-requests/${r.id}/candidates`,
  );
  const row = candidates.candidates.find((c: any) => c.entityId === q.entityId);
  assert.equal(row.qualificationId, revised.id);
  assert.equal(row.canStart, false);
  assert(
    f.store
      .snapshot()
      .plans.some((p) => p.id === start.id && p.qualificationId === q.id),
  );
});

test("마지막 삭제의 두 파일 실패·재시도·중간 재시작은 필수 지정과 원본을 함께 보존한다", async (t) => {
  const f = await fixture(t),
    q = f.store
      .snapshot()
      .qualifications.find((q) => q.id === "demo-qualification")!;
  await f.store.organizations.transact(
    "operator-1",
    randomUUID(),
    "required",
    () => {},
    (doc) => {
      doc.roots[0]!.requiredQualifications = [q.entityId];
      return {};
    },
  );
  const impact = await f.call(
    "admin-1",
    `/qualifications/${q.id}/deletion-impact`,
  );
  const before = f.store.snapshot(),
    org = f.store.organizations.snapshot();
  const bytes = await readFile(f.file),
    orgBytes = await readFile(f.store.organizations.file);
  f.store.beforeReplace = () => {
    throw Error("pair failure");
  };
  const key = randomUUID(),
    body = { ...impact, reason: "동시 보존 시험" };
  await f.call("admin-1", "/qualifications/" + q.id, body, 503, "DELETE", key);
  assert.deepEqual(await readFile(f.file), bytes);
  assert.deepEqual(await readFile(f.store.organizations.file), orgBytes);
  f.store.beforeReplace = undefined;
  await f.app.close();
  // Simulate abrupt termination after the organization replacement and before state commit.
  await writeFile(
    f.store.transactionMarker,
    JSON.stringify({ schemaVersion: 1, state: before, organizations: org }),
  );
  const partial = structuredClone(org);
  partial.roots[0]!.requiredQualifications = [];
  partial.revision++;
  await writeFile(f.store.organizations.file, JSON.stringify(partial));
  const recovered = await new JsonStore(f.file).load();
  assert.deepEqual(recovered.snapshot(), before);
  assert.deepEqual(
    recovered.organizations.snapshot(),
    JSON.parse(JSON.stringify(org)),
  );
  await recovered.close();
});

test("Auditor 기준은 설명 없이 생성하며 마지막 삭제 후 같은 계보의 다음 버전을 작성한다", async (t) => {
  const f = await fixture(t);
  const created = await f.call("admin-1", "/auditor-program/qualifications", {
    revision: 0,
    level: "general",
    title: "일반 심사원",
  });
  const ref = f.store.snapshot().auditorPrograms[0]!.general!;
  const impact = await f.call(
    "admin-1",
    `/qualifications/${created.id}/deletion-impact`,
  );
  assert.equal(impact.canDelete, true);
  await f.call(
    "admin-1",
    `/qualifications/${created.id}`,
    { ...impact, reason: "기준 재작성" },
    200,
    "DELETE",
  );
  let view = await f.call("admin-1", "/auditor-program");
  assert.equal(view.general.qualification, null);
  assert.equal(view.readiness.ready, false);
  const recreated = await f.call("admin-1", "/auditor-program/qualifications", {
    revision: view.program.revision,
    level: "general",
    title: "일반 심사원",
  });
  const q = f.store
    .snapshot()
    .qualifications.find((q) => q.id === recreated.id)!;
  assert.equal(q.entityId, ref.entityId);
  assert.equal(q.templateId, ref.templateId);
  assert.equal(q.version, 2);
  assert.equal(q.description, "");
  view = await f.call("admin-1", "/auditor-program");
  await f.call(
    "admin-1",
    "/auditor-program",
    {
      revision: view.program.revision,
      generalQualificationId: created.id,
      notice: { title: "", body: "", links: [] },
    },
    410,
    "PUT",
  );
});

test("17/2→18/3 명시 이관은 원문·팀 적용 이력·JSON7 호환과 실패 복구·재실행을 보존한다", async (t) => {
  const f = await fixture(t);
  const auditor = await f.call("admin-1", "/auditor-program/qualifications", {
    revision: 0,
    level: "general",
    title: "이관할 일반 Auditor",
  });
  const raw: any = f.store.snapshot(),
    org: any = f.store.organizations.snapshot();
  const lineage = structuredClone(raw.auditorPrograms[0].general);
  raw.auditorPrograms[0].general = {
    templateId: lineage.templateId,
    qualificationId: auditor.id,
  };
  raw.schemaVersion = 17;
  org.schemaVersion = 2;
  org.qualificationPools = currentTeamQualifications(raw);
  await f.app.close();
  await writeFile(f.file, JSON.stringify(raw));
  await writeFile(f.store.organizations.file, JSON.stringify(org));
  const disk = new JsonStore(f.file),
    hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const stateBytes = await readFile(f.file),
    orgBytes = await readFile(disk.organizations.file),
    maintenance = await readFile(disk.maintenanceFile);
  const expected = {
    revision: raw.revision,
    stateHash: hash(stateBytes),
    organizationHash: hash(orgBytes),
  };
  await assert.rejects(new JsonStore(f.file).load());
  disk.beforeReplace = () => {
    throw Error("migration failure");
  };
  await assert.rejects(
    disk.migratePolicies(
      expected,
      migrateAutomaticCriteria,
      "automatic-criteria",
    ),
  );
  assert.deepEqual(await readFile(f.file), stateBytes);
  assert.deepEqual(await readFile(disk.organizations.file), orgBytes);
  assert.deepEqual(await readFile(disk.maintenanceFile), maintenance);
  disk.beforeReplace = undefined;
  await disk.migratePolicies(
    expected,
    migrateAutomaticCriteria,
    "automatic-criteria",
  );
  const migrated = await new JsonStore(f.file).load();
  assert.equal(migrated.snapshot().schemaVersion, 19);
  assert.equal(migrated.organizations.snapshot().schemaVersion, 3);
  assert.deepEqual(migrated.snapshot().auditorPrograms[0]!.general, lineage);
  assert.deepEqual(migrated.snapshot().assignments, raw.assignments);
  assert.deepEqual(
    migrated.organizations.snapshot().audits.at(-1)!.before,
    org.qualificationPools,
  );
  const master: any = exportMaster(
    migrated.snapshot(),
    migrated.organizations.snapshot(),
    new Date().toISOString(),
  );
  assert.equal(master.formatVersion, 9);
  assert(!("qualificationPools" in master.payload.organizations));
  master.formatVersion = 7;
  master.stateSchemaVersion = 17;
  master.organizationSchemaVersion = 2;
  master.payload.organizations.qualificationPools = org.qualificationPools;
  master.counts.poolEntries = org.qualificationPools.length;
  master.payload.auditorPrograms[0].general = raw.auditorPrograms[0].general;
  master.sha256 = contentHash(master.payload);
  assert.equal(readMaster(master).formatVersion, 9);
  assert.deepEqual(
    readMaster(master).payload.auditorPrograms![0]!.general,
    lineage,
  );
  const state = migrated.snapshot(),
    organizations = migrated.organizations.snapshot();
  await migrated.close();
  assert.deepEqual(migrateAutomaticCriteria(state, organizations).state, state);
  assert.deepEqual(
    migrateAutomaticCriteria(state, organizations).organizations,
    organizations,
  );
});
