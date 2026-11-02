import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setup } from "./auditor-test-fixture.ts";
import { startInput } from "./auditor-fixture.ts";
import { migrateAuditorTeams } from "../src/auditor-team-migration.ts";
import { seedOrganizations } from "../src/organizations.ts";
import { seedState } from "../src/seed.ts";
import { readFile } from "node:fs/promises";
import { resetTestData, testDataStatus } from "../src/test-data.ts";

type F = Awaited<ReturnType<typeof setup>>;
test("팀 설정만 남아 있어도 전체 초기화를 제공하고 계정은 보존한다", () => {
  const empty = resetTestData(seedState(true), seedOrganizations());
  empty.organizations.roots[0]!.auditorEnabled = true;
  assert.equal(testDataStatus(empty.state, empty.organizations).canReset, true);
  const reset = resetTestData(empty.state, empty.organizations);
  assert.deepEqual(reset.state.users, empty.state.users);
  assert.ok(reset.organizations.roots.every((r) => r.auditorEnabled === false));
  assert.equal(
    testDataStatus(reset.state, reset.organizations).canReset,
    false,
  );
});
async function review(
  f: F,
  enabled: boolean,
  actor = "operator-1",
  status = 200,
  team = "org-photo",
) {
  return f.call(
    actor,
    `/system/organizations/${team}/auditor-eligibility/preview`,
    { enabled, revision: f.store.organizations.snapshot().revision },
    status,
  );
}
async function toggle(f: F, enabled: boolean) {
  const p = await review(f, enabled);
  return f.call(
    "operator-1",
    "/system/organizations/org-photo/auditor-eligibility",
    { token: p.token },
    200,
    "PUT",
  );
}

test("팀 미사용 이후 기존 갱신은 완료하고 다음 갱신 시작은 차단한다", async (t) => {
  const f = await setup(t, false);
  await f.program();
  const start = await f.call(
    "learner-2",
    "/me/auditor/starts",
    startInput(f.store.snapshot(), "general"),
  );
  await f.complete(start.assignmentId);
  const c = f.store
    .snapshot()
    .certifications.find((c) => c.assignmentId === start.assignmentId)!;
  f.setTime("2027-07-26T01:00:00.000Z");
  const renewal = await f.call(
    "learner-2",
    `/certifications/${c.id}/renewals`,
    { certificationRevision: c.revision },
  );
  await toggle(f, false);
  await f.call("learner-2", `/renewals/${renewal.id}/complete`, {
    certificationRevision: renewal.certificationRevision,
    revision: renewal.revision,
    confirmation: "교육·인증기준 확인",
  });
  const renewed = f.store.snapshot().certifications.find((x) => x.id === c.id)!;
  assert.equal(renewed.date, c.date);
  assert.equal(renewed.periods!.at(-1)!.expiresOn, "2028-10-26");
  f.setTime("2028-07-26T01:00:00.000Z");
  const blocked = await f.call(
    "learner-2",
    `/certifications/${c.id}/renewals`,
    { certificationRevision: renewed.revision },
    409,
  );
  assert.equal(blocked.code, "AUDITOR_DISABLED");
});

test("팀의 모든 역할·하위 조직이 개인 지정 없이 대상이며 관리 팀 선택은 본인 대상을 바꾸지 않는다", async (t) => {
  const f = await setup(t, false);
  await f.program();
  const notices = f.store.snapshot().notifications.length;
  for (const id of [
    "learner-1",
    "learner-2",
    "admin-1",
    "operator-1",
    "detail-auditor",
  ]) {
    const me = await f.call(id, "/me/auditor");
    assert.equal(me.teamEnabled, true);
    assert.equal(me.levels[0].canStart, true);
    const started = await f.call(
      id,
      "/me/auditor/starts",
      startInput(f.store.snapshot(), "general"),
    );
    const a = f.store
      .snapshot()
      .assignments.find((a) => a.id === started.assignmentId)!;
    assert.equal(a.auditor?.designationId, undefined);
    assert.equal(a.auditor?.teamEligibility?.lv1OrganizationId, "org-photo");
    await f.complete(a.id, id);
    assert.ok(
      f.store.snapshot().certifications.some((c) => c.assignmentId === a.id),
    );
  }
  assert.equal(
    f.store
      .snapshot()
      .notifications.filter((n) => n.type === "auditor_designation").length,
    0,
  );
  const ws = await f.call(
    "operator-1",
    "/workspace?lv1OrganizationId=org-etch",
  );
  assert.equal(ws.actor.auditorEnabled, true);
  assert.equal(
    (await f.call("admin-1", "/dashboard/auditor")).summary.eligible,
    7,
  );
  assert.ok(f.store.snapshot().notifications.length >= notices);
});

test("팀 해제는 신규 취득·등록을 막지만 기존 학습 완료·인증 발급과 기록을 유지한다", async (t) => {
  const f = await setup(t, false);
  await f.program();
  const started = await f.call(
    "learner-2",
    "/me/auditor/starts",
    startInput(f.store.snapshot(), "general"),
  );
  await toggle(f, false);
  const blocked = await f.call(
    "learner-1",
    "/me/auditor/starts",
    startInput(f.store.snapshot(), "general"),
    409,
  );
  assert.equal(blocked.code, "AUDITOR_DISABLED");
  assert.equal(
    (await f.call("learner-2", "/me/auditor")).levels[0].assignment.id,
    started.assignmentId,
  );
  await f.complete(started.assignmentId);
  const cert = f.store
    .snapshot()
    .certifications.find((c) => c.assignmentId === started.assignmentId)!;
  assert.ok(cert);
  assert.equal(cert.lifecycleStatus, "Active");
  await f.call(
    "admin-1",
    "/courses",
    { title: "차단", qualificationType: "auditor" },
    409,
  );
});

test("운영자 권한·Lv1 범위·검토 충돌·토큰 만료·같은 키 재시도와 알림 미발송", async (t) => {
  const f = await setup(t, false);
  await review(f, true, "admin-1", 403);
  await review(f, true, "detail-auditor", 403);
  await review(f, true, "operator-1", 422, "org-photo-fmg");
  const stale = await review(f, true);
  await f.update(() => {});
  await f.call(
    "operator-1",
    "/system/organizations/org-photo/auditor-eligibility",
    { token: stale.token },
    409,
    "PUT",
  );
  const p = await review(f, true),
    key = randomUUID(),
    body = { token: p.token };
  const result = await f.call(
    "operator-1",
    "/system/organizations/org-photo/auditor-eligibility",
    body,
    200,
    "PUT",
    key,
  );
  const state = f.store.snapshot(),
    org = f.store.organizations.snapshot();
  assert.deepEqual(
    await f.call(
      "operator-1",
      "/system/organizations/org-photo/auditor-eligibility",
      body,
      200,
      "PUT",
      key,
    ),
    result,
  );
  assert.deepEqual(f.store.snapshot(), state);
  assert.deepEqual(f.store.organizations.snapshot(), org);
  assert.equal(
    state.notifications.filter((n) => n.type === "auditor_designation").length,
    0,
  );
  const expired = await review(f, false);
  f.setTime("2026-10-26T01:16:00.000Z");
  await f.call(
    "operator-1",
    "/system/organizations/org-photo/auditor-eligibility",
    { token: expired.token },
    409,
    "PUT",
  );
});

test("개인 신규 지정을 거부하고 일반 편집에서 과거 역할을 보존한다", async (t) => {
  const f = await setup(t, false);
  const u = f.store.snapshot().users.find((u) => u.id === "learner-2")!;
  await f.call(
    "operator-1",
    `/system/users/${u.id}`,
    {
      name: u.name,
      organizationId: u.organizationId,
      revision: u.revision,
      roles: ["learner", "evaluator"],
    },
    422,
    "PATCH",
  );
  await f.update((s) => {
    s.users.find((x) => x.id === u.id)!.roles.push("evaluator");
  });
  const current = f.store.snapshot().users.find((x) => x.id === u.id)!;
  await f.call(
    "operator-1",
    `/system/users/${u.id}`,
    {
      name: current.name,
      organizationId: current.organizationId,
      revision: current.revision,
      roles: ["learner"],
    },
    200,
    "PATCH",
  );
  assert.ok(
    f.store
      .snapshot()
      .users.find((x) => x.id === u.id)!
      .roles.includes("evaluator"),
  );
  assert.equal((await f.call(u.id, "/me/auditor")).teamEnabled, false);
});

test("저장 실패는 두 파일을 복원하고 기존 근거의 이관은 재실행해도 동일하다", async (t) => {
  const f = await setup(t, false);
  const p = await review(f, true);
  const bytes = await readFile(f.file),
    state = f.store.snapshot(),
    org = f.store.organizations.snapshot();
  f.store.beforeReplace = () => {
    throw Error("write failure");
  };
  await f.call(
    "operator-1",
    "/system/organizations/org-photo/auditor-eligibility",
    { token: p.token },
    503,
    "PUT",
  );
  assert.deepEqual(f.store.snapshot(), state);
  assert.deepEqual(f.store.organizations.snapshot(), org);
  assert.deepEqual(await readFile(f.file), bytes);
  f.store.beforeReplace = undefined;
  const old = seedState(true),
    oldOrg = seedOrganizations();
  old.schemaVersion = 30;
  oldOrg.schemaVersion = 4;
  for (const root of oldOrg.roots) delete root.auditorEnabled;
  old.users[0]!.roles.push("evaluator");
  const result = migrateAuditorTeams(old, oldOrg);
  assert.equal(result.state.schemaVersion, 31);
  assert.equal(result.organizations.schemaVersion, 5);
  assert.deepEqual(result.state.users, old.users);
  assert.deepEqual(result.state.certifications, old.certifications);
  assert.equal(
    result.organizations.roots.find((r) => r.id === "org-photo")!
      .auditorEnabled,
    true,
  );
  assert.deepEqual(
    migrateAuditorTeams(result.state, result.organizations).state,
    result.state,
  );
});
