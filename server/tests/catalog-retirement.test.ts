import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { seedState } from "../src/seed.ts";
import { JsonStore } from "../src/storage.ts";
import { buildApp } from "./release-test-app.ts";
import { validateState } from "../src/integrity.ts";
import { exportMaster, readMaster } from "./legacy-master-data.ts";
async function fixture(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-retired-catalog-")),
    file = path.join(dir, "runtime/state.json"),
    seed = seedState(true);
  seed.catalogBatches.push({
    id: "historic-batch",
    lv1OrganizationId: "org-photo",
    actorId: "admin-1",
    createdAt: "2026-10-26T00:00:00.000Z",
    contentHash: "historic-hash",
    qualificationIds: ["demo-qualification"],
    courseIds: ["demo-course-1"],
    status: "saved",
    revisions: { "demo-qualification": 1 },
  });
  seed.requests.push({
    actorId: "admin-1",
    key: "historic-import",
    fingerprint: "historic-body",
    response: { id: "historic-batch" },
    date: "2026-10-26T00:00:00.000Z",
    action: "catalog.batch.save",
    lv1OrganizationId: "org-photo",
    preserveBackup: true,
    backupPurpose: "catalog-import",
  });
  await new JsonStore(file).initialize(seed);
  const store = await new JsonStore(file).load(),
    app = await buildApp(store),
    cookies = new Map<string, string>();
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  async function session(actor: string) {
    if (!cookies.has(actor)) {
      const r = await app.inject({
        method: "POST",
        url: "/api/session",
        payload: { actorId: actor },
      });
      cookies.set(actor, `${r.cookies[0]!.name}=${r.cookies[0]!.value}`);
    }
    return cookies.get(actor)!;
  }
  return { file, store, app, session };
}
const endpoints = [
  ["GET", "workbook-template"],
  ["POST", "workbook-export"],
  ["POST", "workbook-preview"],
  ["POST", "batches/validate"],
  ["POST", "batches"],
  ["GET", "batches"],
  ["POST", "batches/historic-batch/publish"],
] as const;
test("엑셀·일괄 API는 종료 응답을 반환하고 JSON/XLSX/잘못된 본문도 해석하거나 저장하지 않는다", async (t) => {
  const f = await fixture(t),
    cookie = await f.session("admin-1"),
    before = f.store.snapshot(),
    bytes = await readFile(f.file),
    org = await readFile(f.store.organizations.file),
    maintenance = await readFile(f.store.maintenanceFile);
  for (const [method, endpoint] of endpoints) {
    const r = await f.app.inject({
      method,
      url: "/api/catalog/" + endpoint,
      headers: { cookie, "idempotency-key": "historic-import" },
      ...(method === "POST"
        ? {
            payload: {
              workbook: { format: "eks-catalog-v13" },
              qualificationIds: ["demo-qualification"],
            },
          }
        : {}),
    });
    assert.equal(r.statusCode, 410, r.body);
    assert.equal(r.json().code, "FEATURE_REMOVED");
    assert.equal(r.json().replacementPath, "/admin/qualifications");
  }
  for (const [type, body] of [
    [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      Buffer.from("invalid XLSX"),
    ],
    ["application/json", "{broken-json"],
    ["application/unknown", Buffer.from("unknown body")],
  ] as const) {
    const r = await f.app.inject({
      method: "POST",
      url: "/api/catalog/workbook-preview",
      headers: { cookie, "content-type": type },
      payload: body,
    });
    assert.equal(r.statusCode, 410, r.body);
  }
  assert.deepEqual(f.store.snapshot(), before);
  assert.deepEqual(await readFile(f.file), bytes);
  assert.deepEqual(await readFile(f.store.organizations.file), org);
  assert.deepEqual(await readFile(f.store.maintenanceFile), maintenance);
});
test("종료된 API도 인증·관리 권한·팀 범위를 검사한다", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.app.inject({ method: "GET", url: "/api/catalog/batches" }))
      .statusCode,
    401,
  );
  for (const actor of ["learner-1", "learner-2"]) {
    const r = await f.app.inject({
      method: "GET",
      url: "/api/catalog/batches",
      headers: { cookie: await f.session(actor) },
    });
    assert.equal(r.statusCode, 403, r.body);
  }
  for (const [actor, url, status] of [
    ["admin-1", "/api/catalog/batches?lv1OrganizationId=org-etch", 403],
    ["operator-1", "/api/catalog/batches", 403],
    ["operator-1", "/api/catalog/batches?lv1OrganizationId=org-etch", 410],
  ] as const) {
    const r = await f.app.inject({
      method: "GET",
      url,
      headers: { cookie: await f.session(actor) },
    });
    assert.equal(r.statusCode, status, r.body);
  }
});
test("과거 일괄 이력·영수증은 업무20에서 보존되며 개별 편집과 JSON10 이전은 계속 동작한다", async (t) => {
  const f = await fixture(t),
    before = f.store.snapshot(),
    cookie = await f.session("admin-1"),
    course = before.courses.find((c) => c.id === "demo-course-1")!;
  const saved = await f.app.inject({
    method: "PUT",
    url: `/api/courses/${course.id}`,
    headers: { cookie, "idempotency-key": randomUUID() },
    payload: { ...course, title: "개별 편집 유지" },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().newVersion, true);
  const after = f.store.snapshot();
  assert.deepEqual(after.catalogBatches, before.catalogBatches);
  assert.deepEqual(
    after.requests.find((r) => r.key === "historic-import"),
    before.requests.find((r) => r.key === "historic-import"),
  );
  assert.equal(
    after.courses.find((c) => c.id === course.id)!.title,
    course.title,
  );
  assert.equal(
    after.courses.find((c) => c.id === saved.json().id)!.title,
    "개별 편집 유지",
  );
  const loaded = validateState(
    JSON.parse(await readFile(f.file, "utf8")),
    f.store.organizations.snapshot(),
  );
  assert.deepEqual(loaded.catalogBatches, before.catalogBatches);
  assert.equal(loaded.schemaVersion, 30);
  const master = exportMaster(
    after,
    f.store.organizations.snapshot(),
    new Date().toISOString(),
  );
  assert.equal(master.formatVersion, 15);
  assert.deepEqual(readMaster(master).payload, master.payload);
});
