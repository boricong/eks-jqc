import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { seedState } from "../src/seed.ts";
import { seedOrganizations, userView } from "../src/organizations.ts";
import { migrateUnifiedStatus } from "../src/unified-status-migration.ts";
import { validateState } from "../src/integrity.ts";
import { setup } from "./auditor-test-fixture.ts";
import { setWorkStatus } from "./work-status-fixture.ts";
import { JsonStore } from "../src/storage.ts";

test("Hold만 있는 사용자는 active, 기존 deactive 기간과 인증 근거는 보존하며 재이관은 무변경", () => {
  const old = seedState(true),
    org = seedOrganizations();
  old.schemaVersion = 31;
  old.users[0]!.certificationEligibility = "hold";
  setWorkStatus(old.users[1]!, "deactive");
  old.users[1]!.certificationEligibility = "hold";
  const original = structuredClone(old);
  const migrated = migrateUnifiedStatus(old, org, "2026-11-02T01:00:00.000Z");
  assert.equal(migrated.state.schemaVersion, 32);
  assert.deepEqual(migrated.report.activatedUsers, [old.users[0]!.id]);
  assert.equal(migrated.state.users[0]!.workStatus, "active");
  assert.equal(migrated.state.users[0]!.revision, old.users[0]!.revision + 1);
  assert.deepEqual(
    migrated.state.users[1]!.workDeactivation,
    old.users[1]!.workDeactivation,
  );
  for (const key of Object.keys(old) as (keyof typeof old)[]) {
    if (["users", "schemaVersion", "revision", "audits"].includes(key))
      continue;
    assert.deepEqual(migrated.state[key], old[key], key);
  }
  assert.deepEqual(old, original);
  assert.deepEqual(migrated.organizations, org);
  assert.deepEqual(
    migrateUnifiedStatus(migrated.state, org).state,
    migrated.state,
  );
  assert.equal(
    Object.hasOwn(userView(old.users[0]!, org), "certificationEligibility"),
    false,
  );
  const invalid = structuredClone(migrated.state);
  invalid.users[0]!.certificationEligibility = "hold";
  assert.throws(() => validateState(invalid, org), /폐지된 취득 대상자/);
});

test("폐지 API는 권한 확인 후410이며 과거 요청 키도 재실행하지 않는다", async (t) => {
  const f = await setup(t);
  const before = f.store.snapshot();
  for (const method of ["GET", "PUT"]) {
    const url =
      method === "GET"
        ? "/certification-targets"
        : "/certification-targets/eligibility";
    const body =
      method === "GET"
        ? undefined
        : { userIds: ["learner-1"], eligibility: "hold" };
    await f.call("learner-1", url, body, 403, method);
    for (let i = 0; i < 2; i++) {
      const value = await f.call(
        "admin-1",
        url,
        body,
        410,
        method,
        "00000000-0000-4000-8000-000000000001",
      );
      assert.equal(value.code, "FEATURE_REMOVED");
    }
  }
  assert.deepEqual(f.store.snapshot(), before);
  const system = await f.call("operator-1", "/system/users");
  const empty = system.find((u: any) => u.id === "learner-2");
  assert.equal(empty.workStatus, "active");
  assert.equal(empty.workStatusInfo.canDeactivate, false);
  assert.match(empty.workStatusInfo.blockedReason, /유효한 자격 인증이 없어/);
  assert.equal(Object.hasOwn(empty, "certificationEligibility"), false);
});

test("통합 이관은 해시 충돌·저장 실패를 복구하고 재시작 후 같은 근거를 보존한다", async (t) => {
  const f = await setup(t);
  const old = f.store.snapshot();
  old.schemaVersion = 31;
  await f.app.close();
  old.users[0]!.certificationEligibility = "hold";
  const { writeFile } = await import("node:fs/promises");
  await writeFile(f.file, JSON.stringify(old));
  const store = new JsonStore(f.file),
    bytes = await readFile(f.file),
    org = await readFile(store.organizations.file);
  const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const expected = {
    revision: old.revision,
    stateHash: hash(bytes),
    organizationHash: hash(org),
  };
  await assert.rejects(
    store.migratePolicies(
      { ...expected, stateHash: "invalid" },
      migrateUnifiedStatus,
    ),
  );
  store.beforeReplace = async () => {
    throw Error("test write failure");
  };
  await assert.rejects(store.migratePolicies(expected, migrateUnifiedStatus));
  assert.deepEqual(await readFile(f.file), bytes);
  assert.deepEqual(await readFile(store.organizations.file), org);
  store.beforeReplace = undefined;
  await store.migratePolicies(expected, migrateUnifiedStatus);
  const reopened = await new JsonStore(f.file).load();
  assert.equal(reopened.snapshot().users[0]!.workStatus, "active");
  assert.equal(
    reopened.snapshot().users[0]!.certificationEligibility,
    undefined,
  );
  assert.deepEqual(reopened.snapshot().certifications, old.certifications);
});
