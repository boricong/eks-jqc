import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import {
  addCalendarDays,
  type DashboardResponse,
  type DashboardMemberDetail,
} from "@eks/contracts";
import {
  addAssignment,
  addCertification,
  addDraft,
  addQualification,
  addRequest,
  dashboardFixture,
  dashboardSeed,
  DASHBOARD_NOW,
  DASHBOARD_SECRET,
  ORG_A,
  ORG_B,
  ORG_CHILD,
  ORG_INACTIVE,
  Q,
  TEAM,
} from "./dashboard-fixtures.ts";

function privateFieldsAbsent(input: unknown) {
  const forbidden = new Set([
    "answers",
    "correct",
    "earned",
    "itemResults",
    "goal",
    "reason",
    "excludedReason",
    "closeReason",
    "message",
    "criteria",
    "evidence",
  ]);
  function visit(value: unknown) {
    if (!value || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      assert.ok(!forbidden.has(key), `민감 필드 노출: ${key}`);
      visit(entry);
    }
  }
  visit(input);
  assert.ok(!JSON.stringify(input).includes(DASHBOARD_SECRET));
}
const query = (values: Record<string, string | number | boolean>) =>
  new URLSearchParams(
    Object.entries(values).map(([k, v]) => [k, String(v)]),
  ).toString();

test("세부 관리자는 하위 조직까지 조회하고 상위·형제·타팀·위조 식별자를 차단한다", async (t) => {
  const seed = dashboardSeed();
  seed.state.users.push(
    {
      id: "dept-admin",
      name: "세부 관리자",
      roles: ["learner"],
      organizationId: ORG_A,
      revision: 1,
      organizationAdministration: {
        organizationId: ORG_A,
        grantedBy: "admin-1",
        grantedAt: DASHBOARD_NOW,
      },
    },
    {
      id: "child",
      name: "하위 직원",
      roles: ["learner", "evaluator"],
      organizationId: ORG_CHILD,
      revision: 1,
    },
    {
      id: "other",
      name: "다른 팀 직원",
      roles: ["learner", "evaluator"],
      organizationId: "org-etch",
      revision: 1,
    },
  );
  const f = await dashboardFixture(t, seed);
  const team: DashboardResponse = await f.call(
    "admin-1",
    "/dashboard?view=members",
  );
  assert.deepEqual(
    new Set(team.members.items.map((m) => m.userId)),
    new Set(["alice", "bob", "child", "dept-admin"]),
  );
  const own: DashboardResponse = await f.call(
    "dept-admin",
    "/dashboard?view=members",
  );
  assert.deepEqual(
    new Set(own.members.items.map((m) => m.userId)),
    new Set(["alice", "dept-admin", "child"]),
  );
  assert.equal(own.snapshot.scope.directOnly, false);
  assert.equal(own.snapshot.scope.includeDescendants, true);
  assert.equal(own.snapshot.scope.fullManager, false);
  const options = await f.call("dept-admin", "/dashboard/options");
  assert.deepEqual(
    options.organizations.map((o: any) => o.id),
    [ORG_A, ORG_CHILD],
  );
  for (const url of [
    `/dashboard?organizationId=${TEAM}`,
    `/dashboard?organizationId=${ORG_B}`,
    "/dashboard/members/bob",
    "/dashboard?lv1OrganizationId=org-etch",
    "/dashboard?entityId=not-in-team",
  ])
    await f.call("dept-admin", url, 403);
  await f.call("dept-admin", `/dashboard?organizationId=${ORG_CHILD}`);
  await f.call("dept-admin", "/dashboard/members/child");
  const auditor = await f.call("dept-admin", "/dashboard/auditor");
  assert.deepEqual(
    auditor.members.map((m: any) => m.id),
    ["child"],
  );
  assert.equal(
    (await f.call("dept-admin", "/dashboard/auditor?includeDescendants=false"))
      .members.length,
    0,
  );
  await f.call("dept-admin", `/dashboard/auditor?organizationId=${TEAM}`, 403);
  const direct = await f.call(
    "dept-admin",
    "/dashboard?view=members&includeDescendants=false",
  );
  assert.deepEqual(
    new Set(direct.members.items.map((m: any) => m.userId)),
    new Set(["alice", "dept-admin"]),
  );
  await f.call("admin-1", "/dashboard?lv1OrganizationId=org-etch", 403);
  await f.call("admin-1", "/dashboard/members/other", 403);
  await f.call("alice", "/dashboard", 403);
  assert.equal(
    (await f.call("operator-1", "/dashboard", 403)).code,
    "MANAGEMENT_SCOPE_REQUIRED",
  );
  await f.call("operator-1", `/dashboard?lv1OrganizationId=${TEAM}`);
});

test("세션 이후 역할 해제와 구성원 소속 변경도 조회 시 다시 검사한다", async (t) => {
  const seed = dashboardSeed();
  seed.state.users.push({
    id: "dept-admin",
    name: "세부 관리자",
    roles: ["learner"],
    organizationId: ORG_A,
    revision: 1,
    organizationAdministration: {
      organizationId: ORG_A,
      grantedBy: "admin-1",
      grantedAt: DASHBOARD_NOW,
    },
  });
  const f = await dashboardFixture(t, seed);
  await f.call("dept-admin", "/dashboard/members/alice");
  await f.mutate((s) => {
    s.users.find((u) => u.id === "alice")!.organizationId = ORG_B;
  });
  await f.call("dept-admin", "/dashboard/members/alice", 403);
  await f.mutate((s) => {
    delete s.users.find((u) => u.id === "dept-admin")!
      .organizationAdministration;
  });
  await f.call("dept-admin", "/dashboard", 403);
});

test("필수가 없는 조직은 0%가 아닌 null이고 Hold 세 종류와 비활성 소속을 혼동하지 않는다", async (t) => {
  const seed = dashboardSeed();
  seed.state.users.push(
    {
      id: "held",
      name: "대상자 Hold",
      roles: ["learner"],
      organizationId: ORG_A,
      revision: 1,
      certificationEligibility: "hold",
    },
    {
      id: "inactive",
      name: "비활성 소속",
      roles: ["learner"],
      organizationId: ORG_INACTIVE,
      revision: 1,
    },
    {
      id: "both",
      name: "둘 다 제외",
      roles: ["learner"],
      organizationId: ORG_INACTIVE,
      revision: 1,
      certificationEligibility: "hold",
    },
  );
  seed.state.qualifications[0]!.lifecycleStatus = "Hold";
  addCertification(seed, "active-despite-standard-hold", "alice");
  addCertification(seed, "credential-hold", "bob", { status: "Hold" });
  addCertification(seed, "excluded-active", "held");
  const f = await dashboardFixture(t, seed);
  const v: DashboardResponse = await f.call(
    "admin-1",
    "/dashboard?view=members&population=all",
  );
  assert.equal(v.summary.eligiblePeople, 2);
  assert.equal(v.summary.uniqueActiveHolders, 1);
  assert.equal(v.snapshot.exclusions.excludedPeople, 3);
  assert.equal(v.snapshot.exclusions.heldAndInactivePeople, 1);
  const excluded = await f.call(
    "admin-1",
    `/dashboard/details?metric=excludedPeople&efficacy=Active&search=${encodeURIComponent("일치하지 않는 검색어")}`,
  );
  assert.equal(
    excluded.rows.total,
    v.snapshot.exclusions.excludedPeople,
    "제외 인원 상세는 검색 결과가 아닌 상단의 조직 범위 제외 인원과 일치",
  );
  assert.deepEqual(
    new Set(excluded.rows.items.map((r: any) => r.userId)),
    new Set(["held", "inactive", "both"]),
  );
  assert.equal(v.members.total, 5);
  const own: DashboardResponse = await f.call(
    "admin-1",
    `/dashboard?organizationId=${ORG_B}&includeDescendants=false`,
  );
});

test("필수 미충족과 취득 차단은 원인별로 집계하며 선택하지 않은 비필수 자격을 경고하지 않는다", async (t) => {
  const seed = dashboardSeed();
  const draftQ = addQualification(seed, "draft-version");
  const optionalQ = addQualification(seed, "unselected-optional", {
    lifecycleStatus: "Hold",
  });
  const certificateQ = addQualification(seed, "credential-state");
  seed.state.qualifications[0]!.lifecycleStatus = "Hold";
  const request = addRequest(seed, "blocked-requirements", "alice", [
    Q,
    draftQ.entityId,
  ]);
  addDraft(seed, "outdated-draft", request.id, draftQ.id);
  const next = addQualification(seed, "draft-version-v2", {
    entityId: draftQ.entityId,
    templateId: draftQ.templateId,
    parentId: draftQ.id,
    version: 2,
    lifecycleStatus: "Active",
  });

  addCertification(seed, "still-valid", "alice", {
    qualificationId: certificateQ.id,
  });
  addCertification(seed, "personally-held", "bob", {
    qualificationId: certificateQ.id,
    status: "Hold",
  });
  addRequest(seed, "held-personal-request", "bob", [certificateQ.entityId]);
  addAssignment(seed, "already-confirmed", "bob");
  seed.state.users.push({
    id: "target-held",
    name: "취득 대상 보류",
    roles: ["learner"],
    organizationId: ORG_A,
    revision: 1,
    certificationEligibility: "hold",
  });
  const f = await dashboardFixture(t, seed);
  const v: DashboardResponse = await f.call(
    "admin-1",
    "/dashboard?view=matrix&population=all",
  );
  assert.equal(
    v.summary.blockedProgress,
    3,
    "기준 보류·초안 버전 변경·개인 효력 Hold 각1건",
  );
  const cells = (id: string) =>
    v.matrix.members.items.find((m) => m.userId === id)!.cells;
  assert.deepEqual(
    cells("alice").find((c) => c.entityId === Q)!.acquisitionBlockCodes,
    ["CRITERIA_UNAVAILABLE"],
  );
  assert.deepEqual(
    cells("alice").find((c) => c.entityId === draftQ.entityId)!
      .acquisitionBlockCodes,
    ["DRAFT_VERSION_CHANGED"],
  );
  assert.ok(
    cells("bob")
      .find((c) => c.entityId === certificateQ.entityId)!
      .acquisitionBlockCodes.includes("CREDENTIAL_HOLD"),
  );
  assert.deepEqual(
    cells("bob").find((c) => c.entityId === Q)!.acquisitionBlockCodes,
    [],
    "확정된 배정은 기준 Hold 이후에도 진행 가능",
  );
  assert.ok(
    cells("target-held").find((c) => c.entityId === Q)!.acquisitionBlockCodes
      .length === 0,
  );
  assert.ok(
    v.matrix.members.items.every(
      (m) =>
        m.cells.find((c) => c.entityId === optionalQ.entityId)!
          .acquisitionBlockCodes.length === 0,
    ),
  );
  for (const metric of ["blockedProgress"] as const) {
    const details = await f.call(
      "admin-1",
      `/dashboard/details?metric=${metric}`,
    );
    assert.equal(details.unit, "person_qualification");
    assert.equal(details.rows.total, v.summary[metric]);
    assert.ok(
      details.rows.items.every(
        (r: any) =>
          r.entityId !== optionalQ.entityId && r.userId !== "target-held",
      ),
    );
    if (metric === "blockedProgress")
      assert.ok(
        details.rows.items.every(
          (r: any) => r.acquisitionBlockCodes.length > 0,
        ),
      );
  }
});

test("인증만 남은 셀도 연결된 인증Set 수료 건수와 상세 근거를 정확히 표시한다", async (t) => {
  const seed = dashboardSeed();
  const c2 = {
    ...structuredClone(seed.state.courses[0]!),
    id: "cert-course-two",
    entityId: "cert-course-two",
    title: "둘째 수료 인증Set",
  };
  seed.state.courses.push(c2);
  seed.state.qualifications[0]!.courseIds.push(c2.id);
  addCertification(seed, "two-course-certificate", "alice");
  const f = await dashboardFixture(t, seed);
  const v: DashboardResponse = await f.call(
    "admin-1",
    "/dashboard?view=matrix",
  );
  const cell = v.matrix.members.items
    .find((m) => m.userId === "alice")!
    .cells.find((c) => c.entityId === Q)!;
  assert.equal(cell.progress, "none");
  assert.equal(cell.completedCourses, 2);
  assert.equal(cell.totalCourses, 2);
  assert.deepEqual(cell.acquisitionBlockCodes, []);
  const detail: DashboardMemberDetail = await f.call(
    "admin-1",
    "/dashboard/members/alice",
  );
  assert.equal(
    detail.qualifications[0]!.courses.filter((c) => c.completed).length,
    cell.completedCourses,
  );
});

test("수동 폐기는 만료와 별도 구간으로 보존하며 두 종류 모두 만료 예정에 포함하지 않는다", async (t) => {
  const seed = dashboardSeed();
  const examples = [
    {
      id: "manual-future",
      expiresOn: "2026-11-01",
      event: "status.changed",
      status: "Revoke" as const,
      bucket: "revoked",
    },
    {
      id: "manual-past",
      expiresOn: "2026-10-22",
      event: "status.changed",
      status: "Revoke" as const,
      bucket: "revoked",
    },
    {
      id: "legacy-future",
      expiresOn: "2026-11-01",
      event: undefined,
      status: "Revoke" as const,
      bucket: "revoked",
    },
    {
      id: "legacy-unlimited",
      expiresOn: undefined,
      event: undefined,
      status: "Revoke" as const,
      bucket: "revoked",
    },
    {
      id: "automatic-expiry",
      expiresOn: "2026-10-22",
      event: "expired",
      status: "Revoke" as const,
      bucket: "expired",
    },
    {
      id: "derived-expiry",
      expiresOn: "2026-10-23",
      event: undefined,
      status: "Active" as const,
      bucket: "expired",
    },
  ];
  for (const example of examples) {
    seed.state.users.push({
      id: example.id,
      name: example.id,
      roles: ["learner"],
      organizationId: ORG_A,
      revision: 1,
    });
    const c = addCertification(seed, example.id, example.id, {
      expiresOn: example.expiresOn,
      status: example.status,
    });
    if (example.event)
      seed.state.lifecycleEvents.push({
        id: `event-${example.id}`,
        subject: "certification",
        targetId: c.id,
        lv1OrganizationId: TEAM,
        actorId: example.event === "expired" ? "system" : "admin-1",
        action: example.event,
        reason: DASHBOARD_SECRET,
        effectiveAt: "2026-10-22T00:00:00.000Z",
        recordedAt: "2026-10-22T00:00:00.000Z",
        before: { status: "Active" },
        after: { status: "Revoke" },
        assignmentId: c.assignmentId,
      });
  }
  addCertification(seed, "active-upcoming", "bob", { expiresOn: "2026-11-01" });
  const f = await dashboardFixture(t, seed);
  await f.call("admin-1", "/dashboard/options");
  f.setTime("2026-10-23T15:00:00.000Z");
  const v: DashboardResponse = await f.call(
    "admin-1",
    "/dashboard?view=renewals",
  );
  for (const example of examples) {
    const row = v.renewals.items.find((r) => r.certificationId === example.id)!;
    assert.equal(row.efficacy, "Revoke");
    assert.equal(row.expiryBucket, example.bucket, example.id);
  }
  assert.equal(v.summary.expires0to30, 1);
  const upcoming = await f.call(
    "admin-1",
    "/dashboard/details?metric=expires0to30",
  );
  assert.equal(upcoming.rows.total, 1);
  assert.equal(upcoming.rows.items[0].certificationId, "active-upcoming");
  for (const bucket of ["revoked", "expired"] as const) {
    const filtered: DashboardResponse = await f.call(
      "admin-1",
      `/dashboard?view=renewals&expiryBucket=${bucket}`,
    );
    assert.deepEqual(
      new Set(filtered.renewals.items.map((r) => r.certificationId)),
      new Set(examples.filter((e) => e.bucket === bucket).map((e) => e.id)),
    );
    assert.equal(filtered.summary.expires0to30, 0);
  }
  assert.equal(
    f.store.snapshot().certifications.find((c) => c.id === "derived-expiry")!
      .lifecycleStatus,
    "Active",
    "파생 만료 조회는 저장 상태를 변경하지 않음",
  );
  privateFieldsAbsent(v);
});

test("구성원·매트릭스와 일반 명세의 기본 정렬은 조직·자격·이름 순서이며 명시 정렬을 유지한다", async (t) => {
  const seed = dashboardSeed();
  seed.state.users.find((u) => u.id === "alice")!.name = "하늘";
  seed.state.users.find((u) => u.id === "bob")!.name = "가람";
  seed.state.users.push(
    {
      id: "b-id",
      name: "가온",
      roles: ["learner"],
      organizationId: ORG_A,
      revision: 1,
    },
    {
      id: "a-id",
      name: "가온",
      roles: ["learner"],
      organizationId: ORG_A,
      revision: 1,
    },
    {
      id: "child-sort",
      name: "나무",
      roles: ["learner"],
      organizationId: ORG_CHILD,
      revision: 1,
    },
  );
  seed.state.qualifications[0]!.title = "후기 자격";
  seed.state.qualificationTemplates.find(
    (q) => q.id === seed.state.qualifications[0]!.templateId,
  )!.title = "후기 자격";
  const first = addQualification(seed, "first-in-sort", { title: "기초 자격" });

  for (const person of ["a-id", "b-id", "alice", "bob"]) {
    const request = addRequest(seed, "sort-" + person, person, [
      Q,
      first.entityId,
    ]);
    for (const entityId of [Q, first.entityId]) {
      const q = seed.state.qualifications.find((q) => q.entityId === entityId)!;
      addDraft(seed, "sort-" + person + entityId, request.id, q.id);
    }
  }
  const f = await dashboardFixture(t, seed);
  for (const view of ["members", "matrix"]) {
    for (const suffix of ["", "&sort=organization"]) {
      const response: DashboardResponse = await f.call(
        "admin-1",
        `/dashboard?view=${view}${suffix}`,
      );
      const rows =
        view === "members" ? response.members : response.matrix.members;
      assert.deepEqual(
        rows.items.map((r) => r.userId),
        ["a-id", "b-id", "alice", "child-sort", "bob"],
      );
    }
    const explicit: DashboardResponse = await f.call(
      "admin-1",
      `/dashboard?view=${view}&sort=name`,
    );
    const rows =
      view === "members" ? explicit.members : explicit.matrix.members;
    assert.deepEqual(
      rows.items.map((r) => r.userId),
      ["bob", "a-id", "b-id", "child-sort", "alice"],
    );
  }
  const details = await f.call(
    "admin-1",
    "/dashboard/details?metric=inProgress",
  );
  assert.deepEqual(
    details.rows.items.map((r: any) => `${r.userId}:${r.entityId}`),
    [
      `a-id:${first.entityId}`,
      `b-id:${first.entityId}`,
      `alice:${first.entityId}`,
      `a-id:${Q}`,
      `b-id:${Q}`,
      `alice:${Q}`,
      `bob:${first.entityId}`,
      `bob:${Q}`,
    ],
  );
});

test("조직별 세 종류 경과 건수·다음 일정·인증Set 평가일은 현재 미완료 업무의 실제 일정에 맞는다", async (t) => {
  const seed = dashboardSeed();
  const c2 = {
    ...structuredClone(seed.state.courses[0]!),
    id: "schedule-course-two",
    entityId: "schedule-course-two",
    title: "남은 인증Set",
  };
  seed.state.courses.push(c2);
  seed.state.qualifications[0]!.courseIds.push(c2.id);
  seed.state.users.push({
    id: "charlie",
    name: "다 직원",
    roles: ["learner"],
    organizationId: ORG_A,
    revision: 1,
  });
  const partial = addCertification(seed, "schedule-partial", "alice");
  seed.state.certifications = [];
  const pending = seed.state.enrollments.find(
    (e) => e.assignmentId === partial.assignmentId && e.courseId === c2.id,
  )!;
  seed.state.attempts = seed.state.attempts.filter(
    (a) => a.enrollmentId !== pending.id,
  );
  seed.state.completions = seed.state.completions.filter(
    (c) => c.enrollmentId !== pending.id,
  );
  const r = addRequest(seed, "schedule-alice", "alice");
  r.dueOn = "2026-10-24";
  const plan = addDraft(seed, "schedule-confirmed", r.id);
  plan.endOn = "2026-10-22";
  const assignment = seed.state.assignments[0]!;
  plan.status = "completed";
  plan.assignmentId = assignment.id;
  plan.completedAt = assignment.assignedAt;
  plan.approval = "skipped_by_policy";
  assignment.planId = plan.id;
  assignment.createdBy = "alice";
  const bobRequest = addRequest(seed, "schedule-bob", "bob");
  bobRequest.dueOn = "2026-10-18";
  addDraft(seed, "bob-target", bobRequest.id).endOn = "2026-10-19";
  const charlieRequest = addRequest(seed, "schedule-charlie", "charlie");
  charlieRequest.dueOn = "2026-10-25";
  addDraft(seed, "charlie-target", charlieRequest.id).endOn = "2026-10-17";
  const f = await dashboardFixture(t, seed);
  const members: DashboardResponse = await f.call(
    "admin-1",
    "/dashboard?view=members",
  );
  const byId = new Map(members.members.items.map((m) => [m.userId, m]));
  assert.equal(byId.get("alice")!.nextSchedule!.kind, "target");
  assert.equal(
    byId.get("alice")!.nextSchedule!.date,
    "2026-10-22",
    "자격 종료일 사용",
  );
  assert.equal(byId.get("alice")!.nextSchedule!.courseTitle, undefined);
  assert.equal(byId.get("bob")!.nextSchedule!.kind, "request");
  assert.equal(byId.get("bob")!.nextSchedule!.date, "2026-10-18");
  assert.equal(byId.get("charlie")!.nextSchedule!.kind, "target");
  assert.equal(byId.get("charlie")!.nextSchedule!.date, "2026-10-17");
  const orgs: DashboardResponse = await f.call(
    "admin-1",
    "/dashboard?view=organizations",
  );
  const orgA = orgs.organizations.items.find(
    (o) => o.organizationId === ORG_A,
  )!;
  const orgB = orgs.organizations.items.find(
    (o) => o.organizationId === ORG_B,
  )!;
  assert.deepEqual([orgA.overdueRequests, orgA.overdueTargets], [0, 2]);
  assert.deepEqual([orgB.overdueRequests, orgB.overdueTargets], [1, 1]);
  for (const metric of ["overdueRequests", "overdueTargets"] as const)
    assert.equal(
      orgs.organizations.items.reduce((sum, row) => sum + row[metric], 0),
      orgs.summary[metric],
    );
  const detail: DashboardMemberDetail = await f.call(
    "admin-1",
    "/dashboard/members/alice",
  );
  assert.deepEqual(
    detail.qualifications[0]!.courses.map((c) =>
      Object.hasOwn(c, "assessmentOn"),
    ),
    [false, false],
  );
  const targets = await f.call(
    "admin-1",
    "/dashboard/details?metric=overdueTargets",
  );
  assert.deepEqual(
    targets.rows.items.map((r: any) => r.userId),
    ["charlie", "bob", "alice"],
  );
  const byName = await f.call(
    "admin-1",
    "/dashboard/details?metric=overdueTargets&sort=name",
  );
  assert.deepEqual(
    byName.rows.items.map((r: any) => r.userId),
    ["alice", "bob", "charlie"],
  );
});

test("만료 예정 명세는 이름 대신 만료일이 가까운 순서로 표시한다", async (t) => {
  const seed = dashboardSeed();
  addCertification(seed, "later-expiry", "alice", { expiresOn: "2026-11-20" });
  addCertification(seed, "earlier-expiry", "bob", { expiresOn: "2026-10-25" });
  const f = await dashboardFixture(t, seed);
  const details = await f.call(
    "admin-1",
    "/dashboard/details?metric=expires0to30",
  );
  assert.deepEqual(
    details.rows.items.map((r: any) => r.certificationId),
    ["earlier-expiry", "later-expiry"],
  );
  const explicit = await f.call(
    "admin-1",
    "/dashboard/details?metric=expires0to30&sort=name",
  );
  assert.deepEqual(
    explicit.rows.items.map((r: any) => r.certificationId),
    ["later-expiry", "earlier-expiry"],
  );
  const members: DashboardResponse = await f.call(
    "admin-1",
    "/dashboard?view=members",
  );
  assert.ok(
    members.members.items.every((m) => !m.nextSchedule),
    "인증 완료 이후 미완료 일정이 없으면 다음 일정도 없음",
  );
});

test("카탈로그는 미완성 등록 자격도 포함하며 다른 소속의 초안은 진행으로 집계하지 않는다", async (t) => {
  const seed = dashboardSeed();
  const recorded = addQualification(seed, "recorded"),
    unused = addQualification(seed, "unused", { courseIds: [] });
  addAssignment(seed, "recorded-work", "alice", recorded.id);
  addRequest(seed, "old-org-request", "alice", [Q], ORG_B);
  addDraft(seed, "old-org-draft", "old-org-request");
  const f = await dashboardFixture(t, seed);
  const options = await f.call("admin-1", "/dashboard/options");
  assert.deepEqual(
    new Set(options.qualifications.map((q: any) => q.entityId)),
    new Set([Q, recorded.entityId, unused.entityId]),
  );
  assert.ok(
    options.qualifications.some(
      (q: any) => q.entityId === unused.entityId && q.registered,
    ),
  );
  const v: DashboardResponse = await f.call(
    "admin-1",
    "/dashboard?view=members",
  );
  assert.equal(v.summary.incompleteRequests, 0);
  assert.equal(v.summary.inProgress, 1, "현재 실제 배정만 진행으로 계산");
  assert.notEqual(
    v.members.items
      .find((m) => m.userId === "alice")!
      .cells.find((c) => c.entityId === Q)?.progress,
    "draft",
  );
  const detail: DashboardMemberDetail = await f.call(
    "admin-1",
    "/dashboard/members/alice",
  );
  assert.deepEqual(
    new Set(detail.previousPlanningRecords.map((r) => `${r.kind}:${r.id}`)),
    new Set(["request:old-org-request", "draft:old-org-draft"]),
  );
  assert.ok(
    detail.previousPlanningRecords.every(
      (r) => r.organizationPath.at(-1)?.id === ORG_B,
    ),
  );
  privateFieldsAbsent(detail);
});

test("만료 구간은 KST 0/30/31/60/61/90일 경계와 무기한·미정·만료를 구분한다", async (t) => {
  const seed = dashboardSeed();
  const fixtures = [
    [0, "0_30"],
    [30, "0_30"],
    [31, "31_60"],
    [60, "31_60"],
    [61, "61_90"],
    [90, "61_90"],
    [91, "over_90"],
    [-1, "expired"],
  ] as const;
  for (const [days] of fixtures) {
    const id = `expiry-${days}`;
    seed.state.users.push({
      id,
      name: id,
      roles: ["learner"],
      organizationId: ORG_A,
      revision: 1,
    });
    addCertification(seed, id, id, {
      expiresOn: addCalendarDays("2026-10-23", days),
    });
  }
  addCertification(seed, "unlimited", "alice");
  addCertification(seed, "unknown", "bob", { unknown: true });
  const f = await dashboardFixture(t, seed);
  const v: DashboardResponse = await f.call(
    "admin-1",
    "/dashboard?view=renewals&pageSize=100",
  );
  assert.equal(v.snapshot.date, "2026-10-23");
  for (const [days, bucket] of fixtures) {
    const row = v.renewals.items.find(
      (r) => r.certificationId === `expiry-${days}`,
    )!;
    assert.ok(row, `${days}일 기록이 조회됨`);
    assert.equal(row.expiryBucket, bucket);
    assert.equal(row.daysUntilExpiry, days);
  }
  assert.equal(
    v.renewals.items.find((r) => r.certificationId === "unlimited")!
      .expiryBucket,
    "unlimited",
  );
  assert.equal(
    v.renewals.items.find((r) => r.certificationId === "unknown")!.expiryBucket,
    "unknown",
  );
  assert.equal(v.summary.expires0to30, 2);
  f.setTime("2026-10-23T15:00:00.000Z");
  const next: DashboardResponse = await f.call(
    "admin-1",
    "/dashboard?view=renewals&pageSize=100",
  );
  assert.equal(next.snapshot.date, "2026-10-24");
  assert.equal(
    next.renewals.items.find((r) => r.certificationId === "expiry-0")!.efficacy,
    "Revoke",
  );
  assert.equal(
    next.renewals.items.find((r) => r.certificationId === "expiry-31")!
      .expiryBucket,
    "0_30",
  );
});

test("Active 인증과 진행 중 재인증은 함께 표시하며 발급 완료 배정을 취득 진행으로 세지 않는다", async (t) => {
  const seed = dashboardSeed();
  const c = addCertification(seed, "renewing", "alice", {
    expiresOn: "2026-11-10",
  });
  seed.state.renewals.push({
    id: "renewal-draft",
    certificationId: c.id,
    periodId: c.periods![0]!.id,
    learnerId: "alice",
    lv1OrganizationId: TEAM,
    qualificationId: Q,
    qualificationRevision: 1,
    validity: c.validity!,
    renewalLeadMonths: 3,
    revision: 1,
    status: "draft",
    startedAt: "2026-10-22T00:00:00.000Z",
    method: "mvp_completion",
  });
  const f = await dashboardFixture(t, seed);
  const v: DashboardResponse = await f.call(
    "admin-1",
    "/dashboard?view=members",
  );
  const cell = v.members.items
    .find((m) => m.userId === "alice")!
    .cells.find((c) => c.entityId === Q)!;
  assert.equal(cell.efficacy, "Active");
  assert.equal(cell.renewalState, "in_progress");
  assert.equal(cell.progress, "none");
  assert.equal(v.summary.inProgress, 0);
  assert.equal(v.summary.uniqueActiveHolders, 1);
  assert.equal(
    (await f.call("admin-1", "/dashboard?view=renewals")).renewals.total,
    1,
  );
});

test("평가 대기·응시·일부 수료를 구분하고 이미 수료한 인증Set은 평가 지연에서 제외한다", async (t) => {
  const seed = dashboardSeed();
  const extraCourse = {
    ...structuredClone(seed.state.courses[0]!),
    id: "course-two",
    entityId: "course-two",
    title: "두 번째 인증Set",
  };
  seed.state.courses.push(extraCourse);
  seed.state.qualifications[0]!.courseIds.push(extraCourse.id);
  seed.state.users.push({
    id: "waiting",
    name: "평가 대기 직원",
    roles: ["learner"],
    organizationId: ORG_A,
    revision: 1,
  });
  const partial = addCertification(seed, "partial", "bob");
  seed.state.certifications = [];
  const undoneEnrollment = seed.state.enrollments.find(
    (e) =>
      e.assignmentId === partial.assignmentId && e.courseId === extraCourse.id,
  )!;
  seed.state.completions = seed.state.completions.filter(
    (c) => c.enrollmentId !== undoneEnrollment.id,
  );
  seed.state.attempts = seed.state.attempts.filter(
    (a) => a.enrollmentId !== undoneEnrollment.id,
  );
  const a = addAssignment(seed, "attempting", "alice");
  const e = seed.state.enrollments.find((e) => e.assignmentId === a.id)!;
  seed.state.attempts.push({
    id: "in-progress-attempt",
    enrollmentId: e.id,
    courseId: e.courseId,
    learnerId: "alice",
    kind: seed.state.courses[0]!.assessmentKinds[0]!,
    round: 1,
    status: "in_progress",
    revision: 1,
    createdAt: DASHBOARD_NOW,
    answers: {},
  });
  addAssignment(seed, "waiting-assignment", "waiting");
  for (const assignment of seed.state.assignments) {
    const request = addRequest(
      seed,
      `request-${assignment.id}`,
      assignment.learnerId,
    );
    const p = addDraft(seed, `plan-${assignment.id}`, request.id);
    p.status = "completed";
    p.assignmentId = assignment.id;
    p.approval = "skipped_by_policy";
    p.completedAt = assignment.assignedAt;
    assignment.planId = p.id;
    assignment.createdBy = assignment.learnerId;
  }
  const f = await dashboardFixture(t, seed);
  const v: DashboardResponse = await f.call(
    "admin-1",
    "/dashboard?view=members",
  );
  const byUser = new Map(v.members.items.map((m) => [m.userId, m.cells[0]!]));
  assert.equal(byUser.get("alice")!.progress, "assessment_progress");
  assert.equal(byUser.get("bob")!.progress, "partial_completion");
  assert.equal(byUser.get("bob")!.completedCourses, 1);
  assert.equal(byUser.get("waiting")!.progress, "assessment_wait");
  assert.equal(v.summary.inProgress, 3);
  assert.equal(v.summary.overdueTargets, 3);
  assert.equal(Object.hasOwn(v.summary, "overdueAssessments"), false);
  const details = await f.call(
    "admin-1",
    "/dashboard/details?metric=overdueAssessments",
    410,
  );
  assert.equal(details.code, "FEATURE_REMOVED");
});

test("같은 팀에서 소속을 옮겨도 확정 배정 진행과 당시 근거는 유지한다", async (t) => {
  const seed = dashboardSeed();
  const a = addAssignment(seed, "before-transfer", "alice", Q, ORG_B);
  const request = addRequest(
    seed,
    "before-transfer-request",
    "alice",
    [Q],
    ORG_B,
  );
  const p = addDraft(seed, "before-transfer-plan", request.id);
  p.status = "completed";
  p.assignmentId = a.id;
  p.approval = "skipped_by_policy";
  p.completedAt = a.assignedAt;
  a.planId = p.id;
  a.createdBy = "alice";
  const f = await dashboardFixture(t, seed);
  const v: DashboardResponse = await f.call(
    "admin-1",
    `/dashboard?view=members&organizationId=${ORG_A}&includeDescendants=false`,
  );
  assert.equal(
    v.summary.inProgress,
    1,
    "확정 배정은 동일 팀 이동 후에도 이어서 취득하는 업무",
  );
  assert.equal(
    v.summary.incompleteRequests,
    0,
    "이전 소속 요청은 현재 요청 집계에서 제외",
  );
  assert.equal(v.members.items[0]!.cells[0]!.assignmentId, a.id);
  const detail: DashboardMemberDetail = await f.call(
    "admin-1",
    "/dashboard/members/alice",
  );
  assert.equal(detail.history[0]!.currentOrganization, false);
  assert.deepEqual(detail.history[0]!.organizationPath, a.organizationPath);
  assert.equal(
    detail.qualifications[0]!.detailsHref?.split("?")[0],
    `/admin/results/${a.id}`,
  );
});

test("자격 검색은 일치하는 행만, 조직 요약은 직접 인원과 하위 묶음을 중복 없이 표시한다", async (t) => {
  const seed = dashboardSeed(),
    unique = addQualification(seed, "backup", { title: "설비 Backup 검증" });

  seed.state.users.push({
    id: "nested",
    name: "하위 조직 직원",
    roles: ["learner"],
    organizationId: ORG_CHILD,
    revision: 1,
  });
  const f = await dashboardFixture(t, seed);
  const filtered: DashboardResponse = await f.call(
    "admin-1",
    `/dashboard?view=qualifications&search=${encodeURIComponent("Backup")}`,
  );
  assert.equal(filtered.qualifications.total, 1);
  assert.equal(filtered.qualifications.items[0]!.entityId, unique.entityId);
  const v: DashboardResponse = await f.call(
    "admin-1",
    "/dashboard?view=organizations",
  );
  assert.equal(
    v.organizations.items.reduce((sum, row) => sum + row.people, 0),
    v.summary.eligiblePeople,
  );
  assert.equal(
    v.organizations.items.find((o) => o.organizationId === ORG_A)!.people,
    2,
  );
  assert.ok(
    !v.organizations.items.some((o) => o.organizationId === ORG_CHILD),
    "자식 인원은 상위 묶음과 별도 행에 중복되지 않음",
  );
});

test("요청 완료 근거는 후속 필수 변경·인증 만료로 다시 미완료가 되지 않는다", async (t) => {
  const seed = dashboardSeed();
  const c = addCertification(seed, "completed-then-expired", "alice", {
    expiresOn: "2026-10-23",
  });
  const r = addRequest(seed, "completed-request");
  r.completion = {
    date: "2026-10-20T00:00:00.000Z",
    reason: "no_additional",
    evidence: [
      { entityId: Q, assignmentId: c.assignmentId, certificationId: c.id },
    ],
  };
  const newRequirement = addQualification(seed, "later-required");
  const f = await dashboardFixture(t, seed);
  await f.call("admin-1", "/dashboard/options");
  f.setTime("2026-10-23T15:00:00.000Z");
  const v: DashboardResponse = await f.call("admin-1", "/dashboard");
  assert.equal(v.summary.incompleteRequests, 0);
  const detail: DashboardMemberDetail = await f.call(
    "admin-1",
    "/dashboard/members/alice",
  );
  assert.equal(detail.requests[0]!.completedOn, "2026-10-20");
  assert.deepEqual(detail.requests[0]!.selectedTitles, [
    seed.state.qualifications[0]!.title,
  ]);
  assert.deepEqual(
    f.store.snapshot().planningRequests[0]!.completion,
    r.completion,
  );
});

test("재인증 가능성은 팀 적용·기준 상태·인증Set 종료와 개인 효력을 별도로 확인한다", async (t) => {
  for (const condition of ["hold", "revoke", "deleted", "retired"] as const) {
    await t.test(condition, async (sub) => {
      const seed = dashboardSeed();
      addCertification(seed, "renewal-blocked", "alice", {
        expiresOn: "2026-11-10",
      });
      const q = seed.state.qualifications[0]!;
      if (condition === "hold" || condition === "revoke")
        q.lifecycleStatus = condition === "hold" ? "Hold" : "Revoke";
      if (condition === "deleted") {
        q.deletedAt = DASHBOARD_NOW;
        q.deletedBy = "operator-1";
        q.deletionReason = DASHBOARD_SECRET;
      }
      if (condition === "retired") {
        const c = seed.state.courses[0]!;
        c.operationalStatus = "retired";
        c.retiredAt = DASHBOARD_NOW;
        c.retiredBy = "operator-1";
        c.retirementReason = DASHBOARD_SECRET;
      }
      const f = await dashboardFixture(sub, seed);
      const v: DashboardResponse = await f.call(
        "admin-1",
        "/dashboard?view=renewals",
      );
      const row = v.renewals.items[0]!;
      assert.equal(
        row.efficacy,
        "Active",
        "기준 운영 제한은 기존 개인 인증을 변경하지 않음",
      );
      assert.equal(row.renewalState, "blocked", condition);
      assert.ok(row.renewalBlockCodes.length > 0);
      privateFieldsAbsent(v);
    });
  }
});

test("안전한 이력과 인증Set 근거만 제공하고 정답·문항별 점수·개인 목표·사유를 반환하지 않는다", async (t) => {
  const seed = dashboardSeed();
  addCertification(seed, "history", "alice", { organizationId: ORG_B });
  const a = addAssignment(seed, "excluded-history", "alice", Q, ORG_B);
  a.excludedAt = DASHBOARD_NOW;
  a.excludedReason = DASHBOARD_SECRET;
  addRequest(seed, "private-request", "alice");
  addDraft(seed, "private-plan", "private-request");
  const f = await dashboardFixture(t, seed);
  for (const url of [
    "/dashboard/options",
    "/dashboard?view=members",
    "/dashboard?view=matrix",
    "/dashboard?view=renewals",
    "/dashboard/details?metric=incompleteRequests",
    "/dashboard/members/alice",
  ])
    privateFieldsAbsent(await f.call("admin-1", url));
  const detail: DashboardMemberDetail = await f.call(
    "admin-1",
    "/dashboard/members/alice",
  );
  assert.equal(detail.history.length, 2);
  assert.ok(detail.history.every((r) => !r.currentOrganization));
  assert.equal(
    detail.history.find((r) => r.assignmentId === "excluded-history")!.excluded,
    true,
  );
  assert.equal(
    detail.history.find((r) => r.certificationId === "history")!.title,
    `당시 ${seed.state.qualifications[0]!.title}`,
  );
});

test("조회는 파일·revision·알림을 바꾸지 않고 같은 스냅샷 지표/상세가 일치하며 오래된 상세를 거부한다", async (t) => {
  const seed = dashboardSeed();
  addCertification(seed, "expired-but-unreconciled", "alice", {
    expiresOn: "2026-10-23",
  });
  addRequest(seed, "overdue-request", "bob");
  const f = await dashboardFixture(t, seed);
  await f.call("admin-1", "/dashboard/options");
  // Existing login reconciliation runs before the cutoff; only dashboard GETs run after it.
  f.setTime("2026-10-23T15:00:00.000Z");
  const before = await Promise.all([
    readFile(f.file, "utf8"),
    readFile(f.organizationsFile, "utf8"),
  ]);
  const snapshotBefore = f.store.snapshot();
  const v: DashboardResponse = await f.call("admin-1", "/dashboard");
  for (const metric of [
    "eligiblePeople",
    "uniqueActiveHolders",
    "inProgress",
    "incompleteRequests",
    "expires0to30",
    "overdueRequests",
  ] as const) {
    const detail = await f.call(
      "admin-1",
      `/dashboard/details?${query({ metric, expectedStateRevision: v.snapshot.stateRevision, expectedOrganizationRevision: v.snapshot.organizationRevision, expectedDate: v.snapshot.date })}`,
    );
    assert.equal(detail.rows.total, v.summary[metric], metric);
    assert.deepEqual(detail.snapshot, v.snapshot);
  }
  assert.deepEqual(
    await Promise.all([
      readFile(f.file, "utf8"),
      readFile(f.organizationsFile, "utf8"),
    ]),
    before,
  );
  assert.deepEqual(f.store.snapshot(), snapshotBefore);
  assert.equal(
    f.store.snapshot().certifications[0]!.lifecycleStatus,
    "Active",
    "GET는 만료 상태를 저장하지 않음",
  );
  const old = query({
    metric: "eligiblePeople",
    expectedStateRevision: v.snapshot.stateRevision,
    expectedOrganizationRevision: v.snapshot.organizationRevision,
    expectedDate: v.snapshot.date,
  });
  await f.mutate((s) => {
    s.users.find((u) => u.id === "bob")!.name = "변경된 이름";
  });
  assert.equal(
    (await f.call("admin-1", `/dashboard/details?${old}`, 409)).code,
    "DASHBOARD_STALE",
  );
  const current: DashboardResponse = await f.call("admin-1", "/dashboard");
  const currentQuery = query({
    metric: "eligiblePeople",
    expectedStateRevision: current.snapshot.stateRevision,
    expectedOrganizationRevision: current.snapshot.organizationRevision,
    expectedDate: current.snapshot.date,
  });
  await f.store.organizations.transact(
    "operator-1",
    randomUUID(),
    randomUUID(),
    () => {},
    (d) => {
      d.roots[0]!.name = "조직 정보 변경";
      return {};
    },
  );
  await f.call("admin-1", `/dashboard/details?${currentQuery}`, 409);
  const fresh: DashboardResponse = await f.call("admin-1", "/dashboard");
  f.setTime("2026-10-24T15:00:00.000Z");
  await f.call(
    "admin-1",
    `/dashboard/details?${query({ metric: "eligiblePeople", expectedStateRevision: fresh.snapshot.stateRevision, expectedOrganizationRevision: fresh.snapshot.organizationRevision, expectedDate: fresh.snapshot.date })}`,
    409,
  );
});

test("1,000명×100자격 조회 p95 1초 이내이며 매트릭스 응답은 25명×10자격으로 제한한다", async (t) => {
  const seed = dashboardSeed();
  seed.state.users = seed.state.users.filter(
    (u) => u.roles.includes("admin") || u.roles.includes("system_operator"),
  );
  for (let n = 0; n < 1000; n++)
    seed.state.users.push({
      id: `person-${n}`,
      name: `직원 ${String(n).padStart(4, "0")}`,
      roles: ["learner"],
      organizationId: n % 2 ? ORG_A : ORG_B,
      revision: 1,
    });
  for (let n = 1; n < 100; n++) {
    const q = addQualification(seed, `qualification-${n}`);
  }
  for (let n = 0; n < 1000; n++) {
    const qualificationId = n % 100 ? `qualification-${n % 100}` : Q;
    if (n < 100)
      addCertification(seed, `load-cert-${n}`, `person-${n}`, {
        qualificationId,
      });
    else
      addAssignment(
        seed,
        `load-assignment-${n}`,
        `person-${n}`,
        qualificationId,
      );
  }
  const f = await dashboardFixture(t, seed);
  await f.call("admin-1", "/dashboard?view=matrix");
  const samples: number[] = [];
  let maxBytes = 0;
  for (let n = 0; n < 20; n++) {
    const start = performance.now();
    const v: DashboardResponse = await f.call(
      "admin-1",
      `/dashboard?view=matrix&page=${(n % 4) + 1}&columnPage=${(n % 10) + 1}`,
    );
    samples.push(performance.now() - start);
    maxBytes = Math.max(maxBytes, Buffer.byteLength(JSON.stringify(v)));
    assert.equal(v.matrix.members.items.length, 25);
    assert.equal(v.matrix.columns.items.length, 10);
    assert.equal(v.matrix.members.total, 1000);
    assert.equal(v.matrix.columns.total, 100);
    assert.ok(v.matrix.members.items.every((m) => m.cells.length <= 10));
    assert.equal(
      v.members.items.length,
      0,
      "활성 관점 외 전체 행을 보내지 않음",
    );
    assert.ok(
      Buffer.byteLength(JSON.stringify(v)) < 300_000,
      "전체 10만 셀이 아닌 현재 페이지 크기 응답",
    );
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.ceil(samples.length * 0.95) - 1]!;
  t.diagnostic(
    `dashboard matrix 1000×100, 배정1000/인증100, 20회 p95=${p95.toFixed(1)}ms, max=${samples.at(-1)!.toFixed(1)}ms, bytes=${maxBytes}`,
  );
  assert.ok(p95 < 1000, `p95 ${p95.toFixed(1)}ms >= 1000ms`);
  const chartSamples: number[] = [];
  let chartBytes = 0;
  for (let n = 0; n < 20; n++) {
    const start = performance.now();
    const value: DashboardResponse = await f.call(
      "admin-1",
      "/dashboard?view=qualifications",
    );
    chartSamples.push(performance.now() - start);
    chartBytes = Math.max(chartBytes, Buffer.byteLength(JSON.stringify(value)));
    assert.equal(value.charts.length, 2);
    assert.ok(value.charts.every((chart) => chart.groups.length === 100));
    assert.equal(value.qualifications.items.length, 25);
  }
  chartSamples.sort((a, b) => a - b);
  const chartP95 = chartSamples[18]!;
  t.diagnostic(
    "dashboard qualification charts 1000×100, 20회 p95=" +
      chartP95.toFixed(1) +
      "ms, bytes=" +
      chartBytes,
  );
  assert.ok(chartP95 < 1000);
  assert.ok(chartBytes < 300_000);
});
