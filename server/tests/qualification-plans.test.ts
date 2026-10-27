import { historicalContent } from "./historical-content.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { setup } from "./auditor-test-fixture.ts";
import { legacyRequestFixture } from "./legacy-request-fixture.ts";
import { legacyPlanFixture } from "./legacy-plan-fixture.ts";
import { migrateQualificationPlans } from "../src/qualification-plan-migration.ts";
import { JsonStore } from "../src/storage.ts";
import { validateState } from "../src/integrity.ts";
import { exportMaster, readMaster } from "./legacy-master-data.ts";

async function start(f: Awaited<ReturnType<typeof setup>>) {
  const r = await legacyRequestFixture(f.store, "admin-1", {
    learnerIds: ["learner-2"],
    message: "",
  });
  return f.call("learner-2", "/plans", {
    requestId: r.ids[0],
    requestRevision: 1,
    qualificationId: "demo-qualification",
  });
}

test("자격 일정은 두 날짜·목표 하나이며 구형 입력/영수증·위조 이력·역전 확정을 거부한다", async (t) => {
  const f = await setup(t),
    { id } = await start(f);
  const current = () => f.store.snapshot().plans.find((p) => p.id === id)!;
  assert.equal(current().startOn, "2026-11-02");
  assert.equal(current().endOn, "2026-11-23");
  assert.equal(Object.hasOwn(current(), "schedules"), false);
  const old = { revision: 1, targetOn: "2026-12-01", schedules: [] },
    key = randomUUID();
  // Even a successful legacy receipt must not bypass the removal guard.
  await f.update((s) =>
    s.requests.push({
      actorId: "learner-2",
      key,
      fingerprint: createHash("sha256")
        .update(
          JSON.stringify({ method: "PUT", url: `/api/plans/${id}`, body: old }),
        )
        .digest("hex"),
      response: { id },
      date: "2026-10-26T01:00:00.000Z",
    }),
  );
  const before = f.store.snapshot();
  assert.equal(
    (await f.call("learner-2", `/plans/${id}`, old, 410, "PUT", key)).code,
    "FEATURE_REMOVED",
  );
  await f.call("learner-1", `/plans/${id}`, old, 403, "PUT");
  assert.deepEqual(f.store.snapshot(), before);
  await f.call(
    "learner-2",
    `/plans/${id}`,
    { revision: 1, startOn: "", endOn: "", goal: "", previousSchedule: {} },
    422,
    "PUT",
  );
  await f.call(
    "learner-2",
    `/plans/${id}`,
    { revision: 1, startOn: "", endOn: "", goal: "" },
    200,
    "PUT",
  );
  await f.call("learner-2", `/plans/${id}/complete`, { revision: 2 }, 422);
  await f.call(
    "learner-2",
    `/plans/${id}`,
    { revision: 2, startOn: "2027-02-02", endOn: "2027-02-01", goal: "연습" },
    200,
    "PUT",
  );
  await f.call("learner-2", `/plans/${id}/complete`, { revision: 3 }, 422);
  await f.call(
    "learner-2",
    `/plans/${id}`,
    { revision: 3, startOn: "2027-02-01", endOn: "2027-02-01", goal: "연습" },
    200,
    "PUT",
  );
  const finish = { revision: 4 },
    finishKey = randomUUID();
  const [a, b] = await Promise.all(
    [0, 1].map(() =>
      f.call(
        "learner-2",
        `/plans/${id}/complete`,
        finish,
        200,
        "POST",
        finishKey,
      ),
    ),
  );
  assert.deepEqual(a, b);
  const s = f.store.snapshot();
  assert.equal(s.assignments.filter((a) => a.planId === id).length, 1);
  assert.deepEqual(
    s.enrollments
      .filter((e) => e.assignmentId === a.assignmentId)
      .map((e) => e.courseId)
      .sort(),
    s.qualifications
      .find((q) => q.id === "demo-qualification")!
      .courseIds.slice()
      .sort(),
  );
});

test("24→25 날짜·긴 목표·원문 보존, JSON14 호환·재이관 및 불완전 참조 거부", async (t) => {
  const f = await setup(t);
  await start(f);
  const raw: any = f.store.snapshot();
  legacyPlanFixture(raw);
  raw.schemaVersion = 24;
  const p = raw.plans[0];
  p.targetOn = "";
  p.schedules[0].learningStart = "2026-01-01";
  p.schedules[0].learningEnd = "2026-02-01";
  p.schedules[0].assessmentOn = "2026-03-01";
  p.schedules[0].goal = "가".repeat(2000);
  p.schedules[1].learningStart = "2026-01-10";
  p.schedules[1].learningEnd = "2026-04-01";
  p.schedules[1].assessmentOn = "";
  p.schedules[1].goal = "나".repeat(2000);
  const before = structuredClone(raw),
    org = f.store.organizations.snapshot();
  const result = migrateQualificationPlans(
    raw,
    org,
    "2026-10-27T00:00:00.000Z",
  );
  const next = result.state.plans[0]!;
  assert.equal(next.startOn, "2026-01-01");
  assert.equal(next.endOn, "2026-04-01");
  assert.equal(next.goal, "");
  assert.equal(next.previousSchedule!.goalNeedsReview, true);
  assert.deepEqual(next.previousSchedule!.schedules, p.schedules);
  assert.equal(next.revision, p.revision + 1);
  assert.deepEqual(raw, before);
  for (const k of Object.keys(raw))
    if (!["schemaVersion", "revision", "audits", "plans"].includes(k))
      assert.deepEqual(
        historicalContent((result.state as any)[k]),
        historicalContent(raw[k]),
        k,
      );
  assert.deepEqual(
    migrateQualificationPlans(result.state, org).state,
    result.state,
  );
  assert.throws(() =>
    validateState(
      { ...result.state, plans: [{ ...next, schedules: [] }] },
      org,
    ),
  );
  const bad = structuredClone(raw);
  bad.plans[0].schedules[0].courseId = "missing";
  assert.throws(() => migrateQualificationPlans(bad, org));
  p.targetOn = "2026-12-31";
  p.schedules.forEach((v: any) => (v.goal = ""));
  p.schedules[1].goal = "단일 목표";
  const single = migrateQualificationPlans(raw, org).state.plans[0]!;
  assert.equal(single.endOn, "2026-12-31");
  assert.equal(single.goal, "단일 목표");
  p.schedules.forEach((v: any) => {
    v.learningStart = "";
    v.learningEnd = "";
    v.assessmentOn = "";
  });
  p.targetOn = "";
  const empty = migrateQualificationPlans(raw, org).state.plans[0]!;
  assert.equal(empty.startOn, "");
  assert.equal(empty.endOn, "");
  assert.ok(empty.scheduleDefaultsAppliedAt);
  const json = exportMaster(result.state, org, "2026-10-27T00:00:00.000Z");
  assert.equal(json.formatVersion, 15);
  assert.equal(json.stateSchemaVersion, 26);
  assert.equal(Object.hasOwn(json.payload, "plans"), false);
  assert.deepEqual(
    readMaster({ ...json, formatVersion: 14, stateSchemaVersion: 24 }).payload,
    json.payload,
  );
});

test("명시 이관은 실행 중 자동 적용하지 않으며 해시·실패·세 파일 원자성과 재실행을 보호한다", async (t) => {
  const f = await setup(t);
  await start(f);
  const raw: any = f.store.snapshot(),
    org = f.store.organizations.snapshot();
  legacyPlanFixture(raw);
  raw.schemaVersion = 24;
  const file = f.store.file;
  await f.app.close();
  await writeFile(file, JSON.stringify(raw));
  const store = new JsonStore(file),
    files = [file, store.organizations.file, store.maintenanceFile];
  const before = await Promise.all(files.map((v) => readFile(v))),
    hash = (v: Buffer) => createHash("sha256").update(v).digest("hex");
  const expected = {
    revision: raw.revision,
    stateHash: hash(before[0]!),
    organizationHash: hash(before[1]!),
  };
  await assert.rejects(
    new JsonStore(file).load(),
    /data:migrate-qualification-plans/,
  );
  await assert.rejects(
    store.migratePolicies(
      { ...expected, stateHash: "0".repeat(64) },
      migrateQualificationPlans,
    ),
  );
  store.beforeReplace = () => {
    throw Error("failed replacement");
  };
  await assert.rejects(
    store.migratePolicies(expected, migrateQualificationPlans),
  );
  assert.deepEqual(await Promise.all(files.map((v) => readFile(v))), before);
  store.beforeReplace = undefined;
  await store.migratePolicies(
    expected,
    migrateQualificationPlans,
    "qualification-plans",
  );
  const after = await Promise.all(files.map((v) => readFile(v)));
  assert.deepEqual(after[1], before[1]);
  await store.migratePolicies(
    {
      ...expected,
      revision: JSON.parse(after[0]!.toString()).revision,
      stateHash: hash(after[0]!),
    },
    migrateQualificationPlans,
    "qualification-plans",
  );
  assert.deepEqual(await Promise.all(files.map((v) => readFile(v))), after);
  assert.deepEqual(
    JSON.parse(after[0]!.toString()).plans[0].previousSchedule.schedules,
    raw.plans[0].schedules,
  );
});
