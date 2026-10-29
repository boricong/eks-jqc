import { loadPlanningFixture } from "./planning-migration-helper.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  addCalendarMonths,
  planningWindow,
  type PlanningSchedule,
} from "@eks/contracts";
import { setup } from "./auditor-test-fixture.ts";
import { legacyRequestFixture } from "./legacy-request-fixture.ts";
import { linkFixtureTemplates } from "./template-helpers.ts";
import { appendQualification } from "../src/releases.ts";
import { migratePlanningSchedule } from "../src/planning-schedule-migration.ts";
import { JsonStore } from "../src/storage.ts";

async function fixture(t: Parameters<typeof setup>[0]) {
  const f = await setup(t);
  await f.update((s) => {
    const base = s.qualifications.find((q) => q.id === "demo-qualification")!;
    s.qualifications.push({
      ...structuredClone(base),
      id: "second",
      entityId: "second",
      title: "두 번째 자격",
      planningDeadlineMonths: 1,
    });
    linkFixtureTemplates(s);
  });
  const { ids } = await legacyRequestFixture(f.store, "admin-1", {
    learnerIds: ["learner-2"],
    message: "전체 일정",
  });
  const id = ids[0]!,
    path = `/planning-requests/${id}/schedule`;
  await f.update((s) => {
    const r = s.planningRequests.find((r) => r.id === id)!;
    r.mode = "fixed";
    r.selections = s.qualifications
      .filter((q) => ["demo-qualification", "second"].includes(q.id))
      .map((q) => ({
        entityId: q.entityId,
        qualificationId: q.id,
        title: q.title,
        version: q.version!,
      }));
  });
  const get = () => f.call("learner-2", path) as Promise<PlanningSchedule>;
  const input = (view: PlanningSchedule) => ({
    requestRevision: view.requestRevision,
    rows: view.rows
      .filter((r) => r.selected && r.editable)
      .map((r) => ({
        entityId: r.entityId,
        qualificationId: r.plan?.qualificationId || r.qualificationId,
        ...(r.plan ? { planId: r.plan.id, revision: r.plan.revision } : {}),
        startOn: r.startOn,
        endOn: r.endOn,
        goal: r.goal,
      })),
  });
  const save = (data: unknown, status = 200, key = randomUUID()) =>
    f.call("learner-2", path, data, status, "PUT", key);
  const preview = () =>
    f.call("learner-2", path + "/preview", {}) as Promise<PlanningSchedule>;
  const finish = (v: PlanningSchedule, status = 200, key = randomUUID()) =>
    f.call(
      "learner-2",
      path + "/complete",
      {
        requestRevision: v.requestRevision,
        reviewToken: v.reviewToken || "invalid",
        confirmNoAdditional: v.noAdditional,
      },
      status,
      "POST",
      key,
    );
  return { ...f, id, path, get, input, save, preview, finish };
}

test("전체 일정 조회 무변경·미완성 저장·항목 오류·원자 확정·재시도", async (t) => {
  const f = await fixture(t),
    before = await readFile(f.file),
    v = await f.get();
  assert.deepEqual(await readFile(f.file), before);
  assert.equal(v.rows.length, 2);
  assert.equal(v.rows[1]!.window!.deadlineOn, "2026-11-26");
  const partial = f.input(v);
  partial.rows[0]!.endOn = "";
  partial.rows[1]!.endOn = "2026-11-27";
  await f.save(partial);
  const invalid = await f.preview();
  assert.equal(invalid.canComplete, false);
  assert.ok(invalid.rows[0]!.errors.endOn);
  assert.match(invalid.rows[1]!.errors.endOn!, /2026-11-26/);
  const valid = f.input(await f.get());
  valid.rows.forEach((r) => (r.endOn = "2026-11-26"));
  await f.save(valid);
  const review = await f.preview();
  assert.equal(review.canComplete, true);
  const key = randomUUID(),
    [a, b] = await Promise.all([
      f.finish(review, 200, key),
      f.finish(review, 200, key),
    ]);
  assert.deepEqual(a, b);
  const state = f.store.snapshot(),
    plans = state.plans.filter((p) => p.requestId === f.id);
  assert.equal(plans.length, 2);
  assert.ok(
    plans.every(
      (p) =>
        p.status === "completed" &&
        p.workflowVersion === "personal-certification-v7" &&
        p.planningWindow?.baseOn === "2026-10-26",
    ),
  );
  assert.equal(
    state.assignments.filter((a) => plans.some((p) => p.id === a.planId))
      .length,
    2,
  );
  assert.equal(
    state.planningRequests.find((r) => r.id === f.id)!.completion!.evidence
      .length,
    2,
  );
  const frozen = structuredClone(plans);
  await f.update((s) => {
    const q = s.qualifications.find((q) => q.id === "second")!;
    appendQualification(
      s,
      q,
      { ...q, planningDeadlineMonths: 2 },
      "admin-1",
      "기한 변경",
    );
  });
  assert.deepEqual(f.store.snapshot().plans, frozen);
});

test("버전 변경은 일정 보존·명시 재확인, 최종 확인 후 변경·KST 날짜 변경은409", async (t) => {
  const f = await fixture(t);
  await f.save(f.input(await f.get()));
  await f.update((s) => {
    const q = s.qualifications.find((q) => q.id === "second")!;
    appendQualification(
      s,
      q,
      { ...q, planningDeadlineMonths: 2 },
      "admin-1",
      "기간 변경",
    );
  });
  const changed = await f.preview(),
    row = changed.rows.find((r) => r.entityId === "second")!;
  assert.equal(changed.canComplete, false);
  assert.equal(row.criteriaChanged, true);
  const original = f.store.snapshot().plans.find((p) => p.id === row.plan!.id)!;
  const body = f.input(changed),
    update = body.rows.find((r) => r.entityId === "second")!;
  update.qualificationId = row.qualificationId;
  await f.save(body, 409);
  await f.save({
    ...body,
    rows: body.rows.map((r) =>
      r.entityId === "second"
        ? { ...r, reviewedCriteriaToken: row.criteriaToken }
        : r,
    ),
  });
  const plan = f.store.snapshot().plans.find((p) => p.id === original.id)!;
  assert.equal(plan.startOn, original.startOn);
  assert.equal(plan.endOn, original.endOn);
  const review = await f.preview();
  assert.equal(review.canComplete, true);
  f.setTime("2026-10-26T15:00:00.000Z");
  await f.finish(review, 409);
  assert.ok(f.store.snapshot().plans.every((p) => p.status === "draft"));
  await f.finish(await f.preview());
});

test("타인·혼합 범위·revision·Hold·저장 실패는 부분 반영 없이 거부", async (t) => {
  const f = await fixture(t),
    initial = await f.get();
  await f.call("learner-1", f.path, undefined, 403);
  const bad = f.input(initial);
  bad.rows[1]!.entityId = "outside";
  const before = f.store.snapshot();
  await f.save(bad, 409);
  assert.deepEqual(f.store.snapshot(), before);
  await f.save({ ...f.input(initial), requestRevision: 999 }, 409);
  f.store.beforeReplace = async () => {
    throw Error("forced failure");
  };
  await f.save(f.input(initial), 503);
  f.store.beforeReplace = undefined;
  assert.deepEqual(f.store.snapshot(), before);
  await f.save(f.input(initial));
  const review = await f.preview(),
    saved = f.store.snapshot();
  f.store.beforeReplace = async () => {
    throw Error("forced failure");
  };
  await f.finish(review, 503);
  f.store.beforeReplace = undefined;
  assert.deepEqual(f.store.snapshot(), saved);
  await f.update((s) => {
    s.users.find((u) => u.id === "learner-2")!.certificationEligibility =
      "hold";
  });
  await f.finish(review, 409);
  assert.ok(f.store.snapshot().plans.every((p) => p.status === "draft"));
});

test("단건 확정·확정 후 일정 수정에도 기한 검증, 월말·윤년 경계", async (t) => {
  assert.equal(addCalendarMonths("2028-01-31", 1), "2028-02-29");
  assert.equal(addCalendarMonths("2027-01-31", 1), "2027-02-28");
  const f = await fixture(t);
  f.setTime("2028-01-30T15:00:00.000Z");
  const view = await f.get();
  assert.equal(view.serverDate, "2028-01-31");
  assert.equal(
    view.rows.find((r) => r.entityId === "second")!.window!.deadlineOn,
    "2028-02-29",
  );
  const body = f.input(view);
  body.rows.forEach((r) => (r.endOn = "2028-03-01"));
  await f.save(body);
  const p = f.store
    .snapshot()
    .plans.find((p) => p.qualificationId === "second")!;
  await f.call(
    "learner-2",
    `/plans/${p.id}/complete`,
    { revision: p.revision },
    422,
  );
  const fixed = f.input(await f.get());
  fixed.rows.forEach((r) => (r.endOn = "2028-02-29"));
  await f.save(fixed);
  await f.finish(await f.preview());
  const completed = f.store.snapshot().plans.find((x) => x.id === p.id)!;
  await f.call(
    "learner-2",
    `/plans/${p.id}`,
    {
      revision: completed.revision,
      startOn: completed.startOn,
      endOn: "2028-03-01",
      goal: "",
      reason: "변경",
    },
    422,
    "PUT",
  );
});

test("28→29 이관은 최신 마이너만 추가·Ready 보존·과거 불변·재실행 무변경", async (t) => {
  const f = await fixture(t);
  await f.save(f.input(await f.get()));
  await f.finish(await f.preview());
  const raw = f.store.snapshot();
  raw.schemaVersion = 28;
  // Simulate a pre-feature release without changing the already frozen qualification.
  const base = raw.qualifications.find((q) => q.id === "second")!;
  const newer = appendQualification(
    raw,
    base,
    { ...base, title: base.title + " 최신" },
    "admin-1",
    "fixture",
  );
  delete newer.planningDeadlineMonths;
  raw.qualifications.push({
    ...structuredClone(newer),
    id: "ready",
    entityId: "ready",
    version: null,
    releaseVersion: null,
    lifecycleStatus: "Ready",
    templateId: "ready-template",
    parentId: undefined,
  });
  linkFixtureTemplates(raw);
  const before = structuredClone(raw),
    result = migratePlanningSchedule(
      raw,
      f.store.organizations.snapshot(),
      "2026-10-29T00:00:00.000Z",
    );
  assert.deepEqual(raw, before);
  assert.equal(result.state.schemaVersion, 29);
  assert.deepEqual(result.state.plans, before.plans);
  assert.deepEqual(result.state.assignments, before.assignments);
  assert.deepEqual(
    result.state.qualifications.find((q) => q.id === base.id),
    base,
  );
  const updated = result.state.qualifications.find(
    (q) => q.parentId === newer.id,
  )!;
  assert.equal(updated.planningDeadlineMonths, 6);
  assert.equal(updated.releaseVersion!.minor, newer.releaseVersion!.minor + 1);
  const ready = result.state.qualifications.find((q) => q.id === "ready")!;
  assert.equal(ready.version, null);
  assert.equal(ready.lifecycleStatus, "Ready");
  assert.equal(ready.planningDeadlineMonths, 6);
  assert.deepEqual(
    migratePlanningSchedule(result.state, result.organizations).state,
    result.state,
  );
});

test("이관 해시·교체 실패는 세 원본 보존, 명시 이관 후 재시작", async (t) => {
  const f = await fixture(t);
  const raw = f.store.snapshot();
  await f.app.close();
  const { writeFile } = await import("node:fs/promises");
  raw.schemaVersion = 28;
  await writeFile(f.file, JSON.stringify(raw));
  const disk = new JsonStore(f.file),
    files = [f.file, disk.organizations.file, disk.maintenanceFile];
  const bytes = await Promise.all(files.map((p) => readFile(p))),
    hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const expected = {
    revision: raw.revision,
    stateHash: hash(bytes[0]!),
    organizationHash: hash(bytes[1]!),
  };
  await assert.rejects(
    new JsonStore(f.file).load(),
    /data:migrate-planning-schedule/,
  );
  await assert.rejects(
    disk.migratePolicies(
      { ...expected, stateHash: "0".repeat(64) },
      migratePlanningSchedule,
    ),
  );
  disk.beforeReplace = async () => {
    throw Error("forced");
  };
  await assert.rejects(disk.migratePolicies(expected, migratePlanningSchedule));
  disk.beforeReplace = undefined;
  assert.deepEqual(await Promise.all(files.map((p) => readFile(p))), bytes);
  await disk.migratePolicies(expected, migratePlanningSchedule);
  const next = await loadPlanningFixture(f.file);
  assert.equal(next.snapshot().schemaVersion, 30);
  await next.close();
});
