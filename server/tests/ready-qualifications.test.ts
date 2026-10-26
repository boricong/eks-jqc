import { legacyRequestFixture } from "./legacy-request-fixture.ts";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { qualificationUseErrors } from "@eks/contracts";
import { JsonStore } from "../src/storage.ts";
import { seedState } from "../src/seed.ts";
import { buildApp } from "../src/app.ts";
import {
  exportMaster,
  readMaster,
  contentHash,
  masterCandidate,
} from "../src/master-data.ts";
import { migrateReadyQualifications } from "../src/ready-qualification-migration.ts";
import { validateState } from "../src/integrity.ts";
import { currentQualification } from "../src/qualification-templates.ts";

async function fixture(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-ready-"));
  const file = path.join(dir, "runtime/state.json");
  await new JsonStore(file).initialize(seedState(true));
  const store = await new JsonStore(file).load(),
    app = await buildApp(store);
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const cookies = new Map<string, string>();
  async function call(
    url: string,
    body?: any,
    method = body === undefined ? "GET" : "POST",
    status: number | number[] = 200,
    actor = "admin-1",
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
    assert.ok(
      (Array.isArray(status) ? status : [status]).includes(r.statusCode),
      r.body,
    );
    return r.json();
  }
  async function register() {
    const base = await call(
      "/system/qualification-templates",
      {
        title: "Ready 시험 자격 " + randomUUID(),
        englishName: "",
        description: "",
      },
      "POST",
      200,
      "operator-1",
    );
    const result = await call("/qualification-templates/import", {
      templateIds: [base.id],
    });
    return { base, id: result.imported[0] as string };
  }
  const q = (id: string) =>
    store.snapshot().qualifications.find((q) => q.id === id)!;
  return { store, app, file, call, register, q };
}

test("Ready 등록·중복·무변경·공통 정보 수정은 버전 없이 유지하고 업무 대상·상태 우회를 차단한다", async (t) => {
  const f = await fixture(t),
    { base, id } = await f.register();
  assert.equal(f.q(id).version, null);
  assert.equal(f.q(id).lifecycleStatus, "Ready");
  const duplicate = await f.call("/qualification-templates/import", {
    templateIds: [base.id],
  });
  assert.equal(duplicate.existing[0], id);
  assert.equal(
    f.store.snapshot().qualifications.filter((q) => q.templateId === base.id)
      .length,
    1,
  );
  const before = f.q(id);
  const unchanged = await f.call(
    `/qualifications/${id}`,
    { ...before, version: 99, lifecycleStatus: "Active", versionMode: "new" },
    "PUT",
  );
  assert.equal(unchanged.unchanged, true);
  assert.deepEqual(f.q(id), before);
  await f.call(
    `/system/qualification-templates/${base.id}`,
    {
      revision: base.revision,
      title: "공통 명칭 수정",
      englishName: "",
      description: "설명만 수정",
    },
    "PUT",
    200,
    "operator-1",
  );
  const current = currentQualification(f.store.snapshot(), f.q(id));
  await f.call(`/qualifications/${id}`, current, "PUT");
  assert.equal(f.q(id).version, null);
  assert.equal(f.q(id).lifecycleStatus, "Ready");
  const metadataOnly = await f.call(
    `/qualifications/${id}`,
    { ...current, catalogCode: "READY-METADATA", versionMode: "new" },
    "PUT",
  );
  assert.equal(metadataOnly.version, null);
  assert.equal(metadataOnly.newVersion, false);
  assert.equal(f.q(id).lifecycleStatus, "Ready");
  assert.ok(
    qualificationUseErrors(current, f.store.snapshot().courses).some((e) =>
      e.includes("Ready"),
    ),
  );
  const policies = await f.call("/organization-settings");
  assert.equal(Object.hasOwn(policies, "qualifications"), false);
  await f.call(
    "/organization-settings/org-photo",
    {
      revision: f.store.organizations.snapshot().revision,
      description: "",
      duties: "",
    },
    "PUT",
    200,
  );
  const request = await legacyRequestFixture(f.store, "admin-1", {
    learnerIds: ["learner-2"],
    message: "",
  });
  const candidates = await f.call(
    `/planning-requests/${request.ids[0]}/candidates`,
    undefined,
    "GET",
    200,
    "learner-2",
  );
  assert.ok(!candidates.candidates.some((q: any) => q.qualificationId === id));
  const impact = await f.call(`/qualifications/${id}/lifecycle-impact`);
  await f.call(
    `/qualifications/${id}/lifecycle`,
    {
      status: "Active",
      reason: "우회",
      revision: current.revision,
      stateRevision: impact.revision,
      organizationRevision: impact.organizationRevision,
    },
    "POST",
    409,
  );
  await f.call(
    `/qualifications/${id}/versions`,
    { revision: current.revision },
    "POST",
    409,
  );
});

test("미완성 첫 저장은 같은 ID v1이며 동시 저장·응답 재시도·입력 위조와 이후 v2 규칙을 보호한다", async (t) => {
  const f = await fixture(t),
    { id } = await f.register(),
    ready = f.q(id);
  const body = {
    ...ready,
    courseIds: ["demo-course-1"],
    versionMode: "new",
    version: 25,
    lifecycleStatus: "Ready",
  };
  const preview = await f.call(`/qualifications/${id}/save-preview`, body);
  assert.equal(preview.initialConfiguration, true);
  assert.equal(preview.candidate.version, 1);
  assert.equal(preview.candidate.lifecycleStatus, "Active");
  assert.equal(preview.newVersion, false);
  assert.equal(preview.versionPolicy.requiresNewVersion, false);
  assert.ok(preview.readiness.length);
  const key = randomUUID();
  const saved = await f.call(
    `/qualifications/${id}`,
    body,
    "PUT",
    200,
    "admin-1",
    key,
  );
  assert.equal(saved.id, id);
  assert.equal(saved.version, 1);
  assert.equal(f.q(id).revision, ready.revision + 1);
  assert.deepEqual(
    await f.call(`/qualifications/${id}`, body, "PUT", 200, "admin-1", key),
    saved,
  );
  await f.call(`/qualifications/${id}`, body, "PUT", 409);
  assert.equal(
    f.store
      .snapshot()
      .qualifications.filter((q) => q.entityId === ready.entityId).length,
    1,
  );
  const v1 = f.q(id),
    next = await f.call(
      `/qualifications/${id}`,
      { ...v1, renewalLeadMonths: 4, versionMode: "new" },
      "PUT",
    );
  assert.equal(next.version, 2);
  assert.notEqual(next.id, id);
  assert.deepEqual(f.q(id), v1);
  const legacy = f.store
    .snapshot()
    .qualifications.find((q) => q.id === "demo-qualification")!;
  const forged = await f.call(
    `/qualifications/${legacy.id}`,
    { ...legacy, version: null, lifecycleStatus: "Ready" },
    "PUT",
  );
  assert.equal(forged.unchanged, true);
  assert.equal(f.q(legacy.id).version, 1);
  const second = await f.register(),
    source = f.q(second.id);
  const concurrent = await Promise.all(
    [1, 2].map(() =>
      f.call(
        `/qualifications/${source.id}`,
        { ...source, renewalLeadMonths: 4 },
        "PUT",
        [200, 409],
      ),
    ),
  );
  assert.equal(concurrent.filter((r) => r.id === source.id).length, 1);
  assert.equal(
    concurrent.filter((r) => r.code === "REVISION_CONFLICT").length,
    1,
  );
  assert.equal(f.q(source.id).version, 1);
  assert.equal(f.q(source.id).revision, source.revision + 1);
  validateState(f.store.snapshot(), f.store.organizations.snapshot());
});

test("개별 무변경 저장은 Ready를 유지하며 삭제 재등록과 최초 기준 저장은 번호를 한 번만 부여한다", async (t) => {
  const f = await fixture(t),
    { id, base } = await f.register();
  const unchanged = await f.call(`/qualifications/${id}`, f.q(id), "PUT");
  assert.equal(unchanged.unchanged, true);
  assert.equal(f.q(id).version, null);
  for (let n = 0; n < 2; n++) {
    const current = f.store
      .snapshot()
      .qualifications.find((q) => q.templateId === base.id && !q.deletedAt)!;
    const impact = await f.call(
      `/qualifications/${current.id}/deletion-impact`,
    );
    await f.call(
      `/qualifications/${current.id}`,
      { ...impact, reason: "Ready 재등록" },
      "DELETE",
    );
    await f.call("/qualification-templates/import", { templateIds: [base.id] });
  }
  const current = f.store
    .snapshot()
    .qualifications.find((q) => q.templateId === base.id && !q.deletedAt)!;
  assert.equal(current.entityId, f.q(id).entityId);
  assert.equal(current.version, null);
  const preview = await f.call(`/qualifications/${current.id}/save-preview`, {
    ...current,
    renewalLeadMonths: 4,
  });
  assert.equal(preview.initialConfiguration, true);
  assert.equal(preview.candidate.id, current.id);
  await f.call(
    `/qualifications/${current.id}`,
    { ...current, renewalLeadMonths: 4 },
    "PUT",
  );
  assert.equal(f.q(current.id).version, 1);
  const third = await f.register();
  await f.call(
    `/qualifications/${third.id}`,
    {
      ...f.q(third.id),
      validity: { type: "unlimited", months: null, reminderDays: [] },
    },
    "PUT",
  );
  assert.equal(f.q(third.id).version, 1);
  assert.equal(f.q(third.id).lifecycleStatus, "Active");
  const file = exportMaster(
    f.store.snapshot(),
    f.store.organizations.snapshot(),
    new Date().toISOString(),
  );
  assert.equal(file.formatVersion, 14);
  assert.deepEqual(readMaster(file).payload, file.payload);
  const old: any = structuredClone(file);
  delete old.payload.commonCourses;
  delete old.counts.commonCourses;
  old.formatVersion = 8;
  delete old.counts.organizationQualificationRequirements;
  delete old.counts.organizationQualificationRequirements;
  delete old.counts.subjectiveQuestions;
  old.stateSchemaVersion = 18;
  old.sha256 = contentHash(old.payload);
  assert.throws(() => readMaster(old), /Ready/);
  validateState(f.store.snapshot(), f.store.organizations.snapshot());
});

test("Ready JSON9·기준 초기화·재시작과 버전/계보 무결성은 최초 설정을 유지한다", async (t) => {
  const f = await fixture(t),
    { id } = await f.register();
  const file = exportMaster(
    f.store.snapshot(),
    f.store.organizations.snapshot(),
    new Date().toISOString(),
  );
  const restored = masterCandidate(readMaster(file).payload, 0, 0);
  assert.deepEqual(
    restored.state.qualifications.find((q) => q.id === id),
    f.q(id),
  );
  assert.equal(restored.state.assignments.length, 0);
  assert.equal(restored.state.notifications.length, 0);
  for (const version of [0, 1]) {
    const bad = structuredClone(restored.state);
    bad.qualifications.find((q) => q.id === id)!.version = version;
    assert.throws(() => validateState(bad, restored.organizations));
  }
  const wrongStatus = structuredClone(restored.state);
  wrongStatus.qualifications.find((q) => q.id === id)!.lifecycleStatus =
    "Active";
  assert.throws(
    () => validateState(wrongStatus, restored.organizations),
    /버전·상태/,
  );
  const duplicate = structuredClone(restored.state);
  duplicate.qualifications.push({ ...f.q(id), id: "duplicate-ready" });
  assert.throws(
    () => validateState(duplicate, restored.organizations),
    /Ready|현재 등록|기준 계보/,
  );
  await f.app.close();
  const reopened = await new JsonStore(f.file).load();
  assert.equal(
    reopened.snapshot().qualifications.find((q) => q.id === id)!.version,
    null,
  );
  await reopened.close();
});

test("18→19 명시 이관은 기존 번호·내용과 세 파일을 보존하며 실패 복구·재실행을 보호한다", async (t) => {
  const f = await fixture(t);
  const raw: any = structuredClone(seedState(true));
  raw.schemaVersion = 18;
  raw.requests.push({
    actorId: "operator-1",
    key: randomUUID(),
    fingerprint: "preserved-delete",
    response: { id: "deleted-reference" },
    date: new Date().toISOString(),
    preserveBackup: true,
    backupPurpose: "qualification-delete",
  });
  const org = f.store.organizations.snapshot(),
    migrated = migrateReadyQualifications(raw, org);
  assert.equal(migrated.state.schemaVersion, 24);
  assert.equal(migrated.state.revision, raw.revision + 6);
  for (const field of [
    "qualifications",
    "courses",
    "assignments",
    "certifications",
    "plans",
    "notifications",
    "users",
    "requests",
  ] as const)
    assert.deepEqual(migrated.state[field], raw[field]);
  assert.deepEqual(
    migrateReadyQualifications(migrated.state, org).state,
    migrated.state,
  );
  const invalid = structuredClone(raw);
  invalid.qualifications[0].version = null;
  assert.throws(() => migrateReadyQualifications(invalid, org), /버전/);
  await f.app.close();
  const { writeFile } = await import("node:fs/promises");
  await writeFile(f.file, JSON.stringify(raw));
  const originalBytes = await readFile(f.file);
  await assert.rejects(new JsonStore(f.file).load());
  assert.deepEqual(await readFile(f.file), originalBytes);
  const disk = new JsonStore(f.file),
    before = await readFile(f.file),
    orgBytes = await readFile(disk.organizations.file),
    maintenance = await readFile(disk.maintenanceFile);
  const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const expected = {
    revision: raw.revision,
    stateHash: hash(before),
    organizationHash: hash(orgBytes),
  };
  disk.beforeReplace = () => {
    throw new Error("Ready migration failure");
  };
  await assert.rejects(
    disk.migratePolicies(
      expected,
      migrateReadyQualifications,
      "ready-qualifications",
    ),
    /Ready migration failure/,
  );
  assert.deepEqual(await readFile(f.file), before);
  assert.deepEqual(await readFile(disk.organizations.file), orgBytes);
  assert.deepEqual(await readFile(disk.maintenanceFile), maintenance);
  disk.beforeReplace = undefined;
  const report: any = await disk.migratePolicies(
    expected,
    migrateReadyQualifications,
    "ready-qualifications",
  );
  assert.deepEqual(await readFile(report.stateBackup), before);
  assert.deepEqual(await readFile(report.maintenanceBackup), maintenance);
  const after = await readFile(f.file);
  await disk.migratePolicies(
    { ...expected, revision: raw.revision + 6, stateHash: hash(after) },
    migrateReadyQualifications,
    "ready-qualifications",
  );
  assert.deepEqual(await readFile(f.file), after);
  assert.deepEqual(await readFile(disk.organizations.file), orgBytes);
});
