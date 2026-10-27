import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { seedState } from "../src/seed.ts";
import { JsonStore } from "../src/storage.ts";
import { buildApp } from "../src/app.ts";

async function fixture(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-testing-retired-"));
  const file = path.join(dir, "runtime/state.json"),
    oldKey = randomUUID(),
    seed = seedState(true);
  seed.requests.push({
    actorId: "operator-1",
    key: oldKey,
    fingerprint: "legacy-reset",
    action: "progress.reset",
    date: new Date().toISOString(),
    response: { id: "old-result", revision: 1 },
  });
  await new JsonStore(file).initialize(seed);
  let store = await new JsonStore(file).load(),
    app = await buildApp(store);
  async function login(actorId = "operator-1") {
    const r = await app.inject({
      method: "POST",
      url: "/api/session",
      payload: { actorId },
    });
    assert.equal(r.statusCode, 200, r.body);
    return r.cookies[0]!.name + "=" + r.cookies[0]!.value;
  }
  async function bytes() {
    return Promise.all(
      [file, store.organizations.file, store.maintenanceFile].map((p) =>
        readFile(p),
      ),
    );
  }
  async function restart() {
    await app.close();
    store = await new JsonStore(file).load();
    app = await buildApp(store);
  }
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  return {
    dir,
    file,
    oldKey,
    login,
    bytes,
    restart,
    get store() {
      return store;
    },
    get app() {
      return app;
    },
  };
}

test("폐지 API는 인증·운영자 확인 후 본문 해석과 기존 요청 재실행 전에410으로 종료한다", async (t) => {
  const f = await fixture(t),
    before = await f.bytes(),
    state = f.store.snapshot();
  const paths = [
    "/testing",
    "/testing/environment",
    "/testing/environment/preview",
    "/testing/environment/apply",
    "/testing/progress?scope=all",
    "/testing/progress/reset",
    "/testing/master-reset/preview",
    "/testing/master-reset",
    "/system/master-data",
    "/system/master-data/export",
    "/system/master-data/import-preview",
    "/system/master-data/import",
    `/system/master-data/operations/${f.oldKey}`,
  ];
  const cookie = await f.login();
  for (const url of paths)
    for (const method of [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ] as const) {
      const r = await f.app.inject({
        method,
        url: "/api" + url,
        headers: {
          cookie,
          "idempotency-key": f.oldKey,
          "content-type": "application/json",
        },
        ...(method === "GET" || method === "OPTIONS"
          ? {}
          : { payload: "{invalid JSON" }),
      });
      assert.equal(r.statusCode, 410, r.body);
      assert.equal(r.json().code, "FEATURE_REMOVED");
    }
  for (const actorId of ["admin-1", "learner-1"]) {
    const other = await f.login(actorId);
    const r = await f.app.inject({
      method: "POST",
      url: "/api/testing/environment/apply",
      headers: { cookie: other, "content-type": "application/json" },
      payload: "bad",
    });
    assert.equal(r.statusCode, 403, r.body);
  }
  const anonymous = await f.app.inject({
    method: "POST",
    url: "/api/system/master-data/import",
    headers: { "content-type": "application/json" },
    payload: "bad",
  });
  assert.equal(anonymous.statusCode, 401);
  const oversized = await f.app.inject({
    method: "POST",
    url: "/api/system/master-data/import-preview",
    headers: { cookie, "content-type": "application/json" },
    payload: " ".repeat(3 * 1024 * 1024) + "{}",
  });
  assert.equal(oversized.statusCode, 410);
  assert.deepEqual(f.store.snapshot(), state);
  assert.deepEqual(await f.bytes(), before);
  const ws = await f.app.inject({
    method: "GET",
    url: "/api/workspace",
    headers: { cookie },
  });
  assert.equal(ws.statusCode, 200);
  assert.equal(Object.hasOwn(ws.json(), "testEnvironment"), false);
});

test("과거 관리 영수증·테스트 소유 정보는 읽기 호환으로 보존하고 새 동작을 만들지 않는다", async (t) => {
  const f = await fixture(t);
  await f.app.close();
  const metadata = JSON.parse(await readFile(f.store.maintenanceFile, "utf8"));
  metadata.testEnvironment = {
    legacy: true,
    state: { users: ["preserved-reference"] },
    catalog: { courseEntityIds: ["unavailable"] },
  };
  metadata.receipts.push({
    operationId: randomUUID(),
    key: f.oldKey,
    fingerprint: "a".repeat(64),
    actorId: "operator-1",
    kind: "test-load",
    completedAt: new Date().toISOString(),
    generation: metadata.generation,
    previousGeneration: metadata.generation,
    stateRevision: 0,
    organizationRevision: 0,
    preserved: { users: 1 },
    deleted: { plans: 0 },
    backups: { state: "historical-state", organizations: "historical-org" },
  });
  await writeFile(
    f.store.maintenanceFile,
    JSON.stringify(metadata, null, 2) + "\n",
  );
  const before = await f.bytes();
  await f.restart();
  const cookie = await f.login(),
    r = await f.app.inject({
      method: "GET",
      url: `/api/system/master-data/operations/${f.oldKey}`,
      headers: { cookie },
    });
  assert.equal(r.statusCode, 410);
  assert.deepEqual(await f.bytes(), before);
  assert.equal(f.store.snapshot().users.length, seedState(true).users.length);
});

test("이전 테스트 교체의 중단 표식은 CLI 복구로 원본 쌍과 관리 정보를 보존한다", async (t) => {
  const f = await fixture(t),
    before = await f.bytes(),
    metadata = JSON.parse(before[2]!.toString());
  const suffix = randomUUID(),
    backups = {
      state: path.join(
        f.store.backupDir,
        `before-test-delete-0-${suffix}.json`,
      ),
      organizations: path.join(
        f.store.organizations.backupDir,
        `before-test-delete-0-${suffix}.json`,
      ),
    };
  await f.app.close();
  await mkdir(f.store.backupDir, { recursive: true });
  await mkdir(f.store.organizations.backupDir, { recursive: true });
  await writeFile(backups.state, before[0]!);
  await writeFile(backups.organizations, before[1]!);
  await writeFile(
    f.store.replacementMarker,
    JSON.stringify({ backups, maintenanceBefore: metadata }),
  );
  await assert.rejects(new JsonStore(f.file).load(), /교체가 중단/);
  await new JsonStore(f.file).recoverMasterReplacement();
  await f.restart();
  assert.deepEqual(await f.bytes(), before);
});

test("손상된 관리 정보는 자동 재생성하지 않으며 Photo 생성 명령은 파일을 열지 않는다", async (t) => {
  const f = await fixture(t),
    bytes = await f.bytes();
  await f.app.close();
  await writeFile(
    f.store.maintenanceFile,
    JSON.stringify({ schemaVersion: 1, generation: "broken", receipts: [] }),
  );
  await assert.rejects(new JsonStore(f.file).load());
  assert.match(await readFile(f.store.maintenanceFile, "utf8"), /broken/);
  await writeFile(f.store.maintenanceFile, bytes[2]!);
  await f.restart();
  await assert.rejects(
    promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "server/src/cli.ts", "setup-photo", "--apply"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          EKS_DATA_FILE: path.join(f.dir, "never-created/state.json"),
          EKS_ORGANIZATIONS_FILE: path.join(
            f.dir,
            "never-created/organizations.json",
          ),
        },
      },
    ),
    (e: any) => e.code === 1 && /명령을 사용하세요/.test(e.stderr),
  );
  await assert.rejects(readFile(path.join(f.dir, "never-created/state.json")), {
    code: "ENOENT",
  });
});
