import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  assessmentQuestions,
  workRevokesOn,
  type WorkStatusPreview,
  type TeamUsersView,
} from "@eks/contracts";
import { setup } from "./auditor-test-fixture.ts";
import { legacyRequestFixture } from "./legacy-request-fixture.ts";
import { seedState } from "../src/seed.ts";
import { seedOrganizations } from "../src/organizations.ts";
import { migrateWorkStatus } from "../src/work-status-migration.ts";
import { JsonStore } from "../src/storage.ts";
import { buildApp } from "./release-test-app.ts";
import { readFile } from "node:fs/promises";
import { dashboardSeed, addCertification, TEAM } from "./dashboard-fixtures.ts";
import { dashboardReader } from "../src/dashboard.ts";
import { userView } from "../src/organizations.ts";
import { startInput } from "./auditor-fixture.ts";

type F = Awaited<ReturnType<typeof setup>>;
async function finish(f: F, assignmentId = "assignment-1") {
  for (const e of f.store
    .snapshot()
    .enrollments.filter((e) => e.assignmentId === assignmentId)) {
    const c = f.store.snapshot().courses.find((c) => c.id === e.courseId)!;
    for (const kind of c.assessmentKinds) {
      if (
        f.store
          .snapshot()
          .attempts.some(
            (t) =>
              t.enrollmentId === e.id &&
              t.kind === kind &&
              t.result === "passed",
          )
      )
        continue;
      const t = await f.call("learner-1", `/enrollments/${e.id}/attempts`, {
        kind,
      });
      await f.call(
        "learner-1",
        `/attempts/${t.id}/draft`,
        {
          revision: t.revision,
          answers: Object.fromEntries(
            assessmentQuestions(c, kind).map((q) => [q.id, q.correct]),
          ),
        },
        200,
        "PUT",
      );
      await f.call("learner-1", `/attempts/${t.id}/submit`, {
        revision: t.revision + 1,
      });
    }
  }
  return f.store
    .snapshot()
    .certifications.find((c) => c.assignmentId === assignmentId)!;
}
async function preview(
  f: F,
  status: "active" | "deactive",
  actor = "admin-1",
  user = "learner-1",
  expected = 200,
) {
  const u = f.store.snapshot().users.find((u) => u.id === user)!;
  return f.call(
    actor,
    `/team-users/${user}/work-status/preview`,
    {
      status,
      revision: u.revision,
      organizationRevision: f.store.organizations.snapshot().revision,
    },
    expected,
  ) as Promise<WorkStatusPreview>;
}
async function change(f: F, status: "active" | "deactive") {
  const p = await preview(f, status);
  return f.call(
    "admin-1",
    "/team-users/learner-1/work-status",
    { token: p.token },
    200,
    "PUT",
  );
}
test("KST 달력6개월 초과·월말·윤년과 기존 사용자 Active의 보존 이관", () => {
  assert.equal(workRevokesOn("2026-10-29"), "2027-04-30");
  assert.equal(workRevokesOn("2023-08-31"), "2024-03-01");
  assert.equal(workRevokesOn("2024-08-31"), "2025-03-01");
  const s = seedState(true);
  s.schemaVersion = 29;
  for (const u of s.users) delete u.workStatus;
  const before = structuredClone(s),
    result = migrateWorkStatus(s, seedOrganizations());
  assert.equal(result.state.schemaVersion, 30);
  assert.ok(result.state.users.every((u) => u.workStatus === "active"));
  for (const k of Object.keys(s).filter(
    (k) => !["users", "schemaVersion", "revision"].includes(k),
  ))
    assert.deepEqual((result.state as any)[k], (before as any)[k]);
  assert.deepEqual(
    migrateWorkStatus(result.state, seedOrganizations()).state,
    result.state,
  );
});
test("무자격 전환 차단·관리자 범위·검토 충돌·동일 키와 동일 상태 재시도", async (t) => {
  const f = await setup(t);
  await preview(f, "deactive", "admin-1", "learner-1", 422);
  await finish(f);
  await preview(f, "deactive", "detail-auditor", "learner-1", 403);
  await preview(f, "deactive", "learner-1", "learner-1", 403);
  const stale = await preview(f, "deactive");
  await f.update((s) => {
    s.users.find((u) => u.id === "learner-1")!.revision++;
  });
  await f.call(
    "admin-1",
    "/team-users/learner-1/work-status",
    { token: stale.token },
    409,
    "PUT",
  );
  const p = await preview(f, "deactive"),
    key = randomUUID();
  const result = await f.call(
    "admin-1",
    "/team-users/learner-1/work-status",
    { token: p.token },
    200,
    "PUT",
    key,
  );
  const before = f.store.snapshot();
  assert.deepEqual(
    await f.call(
      "admin-1",
      "/team-users/learner-1/work-status",
      { token: p.token },
      200,
      "PUT",
      key,
    ),
    result,
  );
  assert.deepEqual(f.store.snapshot(), before);
  await change(f, "deactive");
  assert.deepEqual(
    f.store.snapshot().users.find((u) => u.id === "learner-1")!
      .workDeactivation,
    before.users.find((u) => u.id === "learner-1")!.workDeactivation,
  );
  const view = (await f.call("admin-1", "/team-users")) as TeamUsersView;
  assert.equal(
    view.users.find((u) => u.id === "learner-1")!.workStatusInfo!.status,
    "deactive",
  );
});
test("6개월 초과 말소·진행 종료·복귀 후 새 계획과 두 평가·발급 근거 보존", async (t) => {
  const f = await setup(t);
  f.setTime("2026-10-29T01:00:00.000Z");
  const cert = await finish(f),
    frozen = structuredClone(cert);
  const req = (
    await legacyRequestFixture(f.store, "admin-1", {
      learnerIds: ["learner-1"],
      message: "기존 요청",
    })
  ).ids[0]!;
  await change(f, "deactive");
  await f.call(
    "learner-1",
    `/planning-requests/${req}/schedule`,
    {
      requestRevision: f.store
        .snapshot()
        .planningRequests.find((r) => r.id === req)!.revision,
      rows: [],
    },
    409,
    "PUT",
  );
  const dash = await f.call("admin-1", "/dashboard?view=summary");
  assert.equal(dash.snapshot.exclusions.deactivePeople, 1);
  f.setTime("2027-04-29T14:59:59.000Z");
  await f.call("learner-1", "/workspace");
  assert.equal(
    f.store.snapshot().certifications.find((c) => c.id === cert.id)!
      .lifecycleStatus,
    "Active",
  );
  const stale = await preview(f, "active");
  f.setTime("2027-04-29T15:00:00.000Z");
  await f.call(
    "admin-1",
    "/team-users/learner-1/work-status",
    { token: stale.token },
    409,
    "PUT",
  );
  const revoked = f.store
    .snapshot()
    .certifications.find((c) => c.id === cert.id)!;
  assert.equal(revoked.lifecycleStatus, "Revoke");
  assert.deepEqual(revoked.frozenCriteria, frozen.frozenCriteria);
  assert.deepEqual(revoked.periods, frozen.periods);
  assert.ok(
    f.store.snapshot().planningRequests.find((r) => r.id === req)!.closed,
  );
  assert.ok(
    f.store.snapshot().assignments.find((a) => a.id === "assignment-1")!
      .acquisitionClosedAt,
  );
  const state = f.store.snapshot();
  await f.store.refreshNotifications("2027-04-29T15:01:00.000Z");
  assert.deepEqual(f.store.snapshot(), state);
  await change(f, "active");
  await preview(f, "deactive", "admin-1", "learner-1", 422);
  const nextReq = (
    await legacyRequestFixture(f.store, "admin-1", {
      learnerIds: ["learner-1"],
      message: "복귀 후 재취득",
    })
  ).ids[0]!;
  const path = `/planning-requests/${nextReq}/schedule`;
  let v = await f.call("learner-1", path);
  await f.call(
    "learner-1",
    path,
    {
      requestRevision: v.requestRevision,
      rows: v.rows
        .filter((r: any) => r.editable && r.entityId === "demo-qualification")
        .map((r: any) => ({
          entityId: r.entityId,
          qualificationId: r.qualificationId,
          startOn: "2027-04-30",
          endOn: "2027-05-30",
          goal: "복귀 역량 재확인",
        })),
    },
    200,
    "PUT",
  );
  v = await f.call("learner-1", path + "/preview", {});
  assert.ok(v.reviewToken, JSON.stringify(v.errors));
  await f.call("learner-1", path + "/complete", {
    requestRevision: v.requestRevision,
    reviewToken: v.reviewToken,
    confirmNoAdditional: false,
  });
  const assignment = f.store
    .snapshot()
    .assignments.find(
      (a) => a.learnerId === "learner-1" && !a.acquisitionClosedAt,
    )!;
  assert.notEqual(assignment.id, "assignment-1");
  const fresh = await finish(f, assignment.id);
  assert.equal(fresh.previousCertificationId, cert.id);
  assert.equal(fresh.lifecycleStatus, "Active");
  assert.notEqual(fresh.id, cert.id);
});
test("기한 전 복귀·재전환은 새 구간이며 Hold/조직 이동과 독립적", async (t) => {
  const f = await setup(t);
  await finish(f);
  await change(f, "deactive");
  const previous = f.store
    .snapshot()
    .users.find((u) => u.id === "learner-1")!.workDeactivation!;
  await f.update((s) => {
    const u = s.users.find((u) => u.id === "learner-1")!;
    u.certificationEligibility = "hold";
    u.organizationId = "org-photo-fmg";
    u.revision++;
  });
  assert.deepEqual(
    f.store.snapshot().users.find((u) => u.id === "learner-1")!
      .workDeactivation,
    previous,
  );
  await change(f, "active");
  assert.equal(
    f.store.snapshot().users.find((u) => u.id === "learner-1")!
      .certificationEligibility,
    "hold",
  );
  f.setTime("2026-11-01T01:00:00.000Z");
  await change(f, "deactive");
  const next = f.store
    .snapshot()
    .users.find((u) => u.id === "learner-1")!.workDeactivation!;
  assert.notEqual(next.id, previous.id);
  assert.equal(next.revokesOn, "2027-05-02");
});
test("저장 실패와 기한 도래 처리 실패는 원자적이며 서버 재시작이 누락 말소를 보충", async (t) => {
  const f = await setup(t);
  const cert = await finish(f);
  const p = await preview(f, "deactive"),
    before = await readFile(f.file);
  f.store.beforeReplace = async () => {
    throw Error("시험 저장 실패");
  };
  await f.call(
    "admin-1",
    "/team-users/learner-1/work-status",
    { token: p.token },
    503,
    "PUT",
  );
  assert.deepEqual(await readFile(f.file), before);
  f.store.beforeReplace = undefined;
  await change(f, "deactive");
  const saved = await readFile(f.file);
  f.setTime("2027-05-01T00:00:00.000Z");
  f.store.beforeReplace = async () => {
    throw Error("시험 말소 저장 실패");
  };
  await f.call("learner-1", "/workspace", undefined, 503);
  assert.deepEqual(await readFile(f.file), saved);
  assert.equal(
    f.store.snapshot().certifications.find((c) => c.id === cert.id)!
      .lifecycleStatus,
    "Active",
  );
  f.store.beforeReplace = undefined;
  await f.app.close();
  const store = await new JsonStore(f.file).load();
  const app = await buildApp(store, {
    clock: () => "2027-05-01T00:00:00.000Z",
  });

  assert.equal(
    store.snapshot().certifications.find((c) => c.id === cert.id)!
      .lifecycleStatus,
    "Revoke",
  );
  const state = store.snapshot();
  await store.refreshNotifications("2027-05-01T00:01:00.000Z");
  assert.deepEqual(store.snapshot(), state);
  await app.close();
});
test("모든 조회 필터의 Auditee 지표/차트는 Deactive를 제외하고 Auditor 모수는 유지", () => {
  const seed = dashboardSeed();
  addCertification(seed, "alice-cert", "alice");
  const alice = seed.state.users.find((u) => u.id === "alice")!;
  alice.roles.push("evaluator");
  const manager = userView(
    seed.state.users.find((u) => u.id === "admin-1")!,
    seed.orgs,
  );
  const read = (
    type: "auditee" | "auditor",
    population: "all" | "excluded" | "eligible" = "eligible",
  ) =>
    dashboardReader(
      seed.state,
      seed.orgs,
      manager,
      { qualificationType: type, population, view: "members" },
      "2026-10-29T00:00:00.000Z",
    ).dashboard();
  const before = read("auditee"),
    auditor = read("auditor");
  alice.workStatus = "deactive";
  for (const population of ["all", "excluded", "eligible"] as const) {
    const value = read("auditee", population);
    assert.equal(
      value.summary.eligiblePeople,
      before.summary.eligiblePeople - 1,
    );
    assert.equal(
      value.summary.uniqueActiveHolders,
      before.summary.uniqueActiveHolders - 1,
    );
    assert.equal(value.snapshot.exclusions.deactivePeople, 1);
  }
  assert.deepEqual(read("auditor").summary, auditor.summary);
  alice.certificationEligibility = "hold";
  const double = read("auditee").snapshot.exclusions;
  assert.equal(
    double.excludedPeople,
    double.totalPeople - double.eligiblePeople,
  );
});
test("Deactive 중 Auditor 본인 교육 확인과 발급은 유지되고 미수행 말소에서 제외", async (t) => {
  const f = await setup(t);
  await f.program();
  await f.designate();
  await f.update((s) => {
    const u = s.users.find((u) => u.id === "learner-2")!;
    u.workStatus = "deactive";
    u.workDeactivation = {
      id: randomUUID(),
      startedAt: "2026-10-26T01:00:00.000Z",
      startedOn: "2026-10-26",
      revokesOn: "2027-04-27",
      actorId: "admin-1",
      reason: "기존 업무 미수행",
      processedTeams: [],
    };
  });
  const started = await f.call(
    "learner-2",
    "/me/auditor/starts",
    startInput(f.store.snapshot(), "general"),
  );
  await f.complete(started.assignmentId);
  const cert = f.store
    .snapshot()
    .certifications.find((c) => c.assignmentId === started.assignmentId)!;
  assert.equal(cert.lifecycleStatus, "Active");
  f.setTime("2027-04-26T15:00:00.000Z");
  await f.store.refreshNotifications("2027-04-26T15:00:00.000Z");
  assert.deepEqual(
    f.store.snapshot().certifications.find((c) => c.id === cert.id),
    cert,
  );
  assert.equal(
    (await f.call("learner-2", "/me/auditor")).currentLevel,
    "general",
  );
});
