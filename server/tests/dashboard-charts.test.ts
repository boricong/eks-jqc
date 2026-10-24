import test from "node:test";
import assert from "node:assert/strict";
import { addCalendarDays } from "@eks/contracts";
import type { DashboardResponse, DashboardChartDetails } from "@eks/contracts";
import {
  dashboardFixture,
  dashboardSeed,
  addQualification,
  addCertification,
  addRequest,
  addDraft,
  Q,
  ORG_A,
  ORG_B,
  ORG_CHILD,
  TEAM,
  DASHBOARD_SECRET,
} from "./dashboard-fixtures.ts";
const params = (o: Record<string, unknown>) =>
  new URLSearchParams(
    Object.entries(o).map(([k, v]) => [k, String(v)]),
  ).toString();

test("모든 뷰의 차트는 페이지와 무관하며 각 구간 명세의 단위·건수가 일치한다", async (t) => {
  const seed = dashboardSeed();
  addCertification(seed, "active", "alice", { qualificationId: Q });
  addCertification(seed, "hold", "bob", { qualificationId: Q, status: "Hold" });
  addRequest(seed, "request");
  addDraft(seed, "draft", "request");
  const f = await dashboardFixture(t, seed);
  const before = f.store.snapshot(),
    orgBefore = f.store.organizations.snapshot();
  for (const view of [
    "summary",
    "organizations",
    "qualifications",
    "members",
    "matrix",
    "renewals",
  ]) {
    const value: DashboardResponse = await f.call(
      "admin-1",
      "/dashboard?" + params({ view }),
    );
    assert.ok(value.charts.length);
    for (const chart of value.charts)
      for (const group of chart.groups)
        for (const [i, series] of chart.series.entries()) {
          const detail: DashboardChartDetails = await f.call(
            "admin-1",
            "/dashboard/chart-details?" +
              params({
                view,
                chartId: chart.id,
                groupKey: group.key,
                seriesKey: series.key,
                expectedStateRevision: value.snapshot.stateRevision,
                expectedOrganizationRevision:
                  value.snapshot.organizationRevision,
                expectedDate: value.snapshot.date,
              }),
          );
          assert.equal(
            detail.rows.total,
            group.values[i],
            chart.id + "/" + series.key,
          );
          assert.equal(detail.unit, chart.unit);
          assert.deepEqual(detail.snapshot, value.snapshot);
          assert.ok(!JSON.stringify(detail).includes(DASHBOARD_SECRET));
          for (const field of [
            "answers",
            "correct",
            "earned",
            "itemResults",
            "goal",
            "reason",
            "message",
          ])
            assert.ok(
              !JSON.stringify(detail).includes('"' + field + '":'),
              field,
            );
        }
  }
  assert.deepEqual(f.store.snapshot(), before);
  assert.deepEqual(f.store.organizations.snapshot(), orgBefore);
});

test("구성원/매트릭스의 현재25행·10열 밖 진행도 차트에 포함하고 개인은 한 번만 센다", async (t) => {
  const seed = dashboardSeed();
  for (let i = 0; i < 40; i++) {
    const id = "extra-" + i;
    seed.state.users.push({
      id,
      name: "가상 구성원 " + i,
      roles: ["learner"],
      organizationId: ORG_A,
      revision: 1,
    });
  }
  for (let i = 0; i < 12; i++) {
    const q = addQualification(seed, "q" + i);
    seed.orgs.qualificationPools.push({
      lv1OrganizationId: TEAM,
      entityId: q.entityId,
      qualificationId: q.id,
    });
    addRequest(seed, "r" + i, "extra-39", [q.entityId]);
    addDraft(seed, "p" + i, "r" + i, q.id);
  }
  const f = await dashboardFixture(t, seed);
  const a: DashboardResponse = await f.call(
    "admin-1",
    "/dashboard?view=matrix&page=1&columnPage=1",
  );
  const b: DashboardResponse = await f.call(
    "admin-1",
    "/dashboard?view=matrix&page=2&columnPage=2",
  );
  assert.deepEqual(a.charts, b.charts);
  const progress = a.charts.find((c) => c.id === "progress")!;
  assert.equal(progress.groups[0]!.values[1], 12);
  const members = a.charts.find((c) => c.id === "member-coverage")!;
  assert.equal(
    members.groups[0]!.values.reduce((a, b) => a + b, 0),
    a.matrix.members.total,
  );
  const detail: DashboardChartDetails = await f.call(
    "admin-1",
    "/dashboard/chart-details?view=matrix&chartId=progress&groupKey=all&seriesKey=draft",
  );
  assert.equal(detail.rows.total, 12);
  assert.ok(detail.rows.items.every((r) => r.userId === "extra-39"));
});

test("구성원·만료 차트는 검색/대상/상태 필터를 유지하고 필수 전체 판정은 축소하지 않는다", async (t) => {
  const seed = dashboardSeed();
  const q = addQualification(seed, "required-second");
  seed.orgs.qualificationPools.push({
    lv1OrganizationId: TEAM,
    entityId: q.entityId,
    qualificationId: q.id,
  });
  seed.orgs.roots[0]!.children[0]!.requiredQualifications = [Q, q.entityId];
  addCertification(seed, "active", "alice", { qualificationId: Q });
  seed.state.users.find((u) => u.id === "bob")!.certificationEligibility =
    "hold";
  const f = await dashboardFixture(t, seed);
  const value: DashboardResponse = await f.call(
    "admin-1",
    "/dashboard?view=members&search=가&entityId=" + Q + "&efficacy=Active",
  );
  assert.equal(
    value.charts.find((c) => c.id === "member-coverage")!.groups[0]!.values[1],
    1,
  );
  const detail: DashboardChartDetails = await f.call(
    "admin-1",
    "/dashboard/chart-details?view=members&search=가&entityId=" +
      Q +
      "&efficacy=Active&chartId=member-coverage&groupKey=all&seriesKey=partial",
  );
  assert.equal(detail.rows.total, 1);
  assert.equal(detail.rows.items[0]!.requiredCoverage!.total, 2);
  const excluded: DashboardResponse = await f.call(
    "admin-1",
    "/dashboard?view=members&population=excluded",
  );
  assert.equal(
    excluded.charts
      .find((c) => c.id === "member-coverage")!
      .groups[0]!.values.reduce((a, b) => a + b, 0),
    1,
  );
  const empty: DashboardResponse = await f.call(
    "admin-1",
    "/dashboard?view=renewals&population=excluded",
  );
  assert.equal(
    empty.charts[0]!.groups[0]!.values.reduce((a, b) => a + b, 0),
    0,
  );
});

test("세부 조직 차트는 직접 소속만 포함하고 위조 구간·상위/형제/타팀과 오래된 명세를 차단한다", async (t) => {
  const seed = dashboardSeed();
  const user = seed.state.users.find((u) => u.id === "alice")!;
  user.organizationAdministration = {
    organizationId: ORG_A,
    grantedBy: "admin-1",
    grantedAt: "2026-10-01T00:00:00.000Z",
  };
  seed.state.users.push({
    id: "child",
    name: "하위 직원",
    roles: ["learner"],
    organizationId: ORG_CHILD,
    revision: 1,
  });
  const f = await dashboardFixture(t, seed);
  const value: DashboardResponse = await f.call(
    "alice",
    "/dashboard?view=members",
  );
  assert.ok(!value.charts.some((c) => c.id.startsWith("organization")));
  await f.call(
    "alice",
    "/dashboard/chart-details?chartId=organization-coverage&groupKey=" +
      TEAM +
      ":subtree&seriesKey=missing",
    403,
  );
  await f.call(
    "alice",
    "/dashboard/chart-details?view=members&organizationId=" +
      ORG_B +
      "&chartId=member-coverage&groupKey=all&seriesKey=missing",
    403,
  );
  await f.call(
    "alice",
    "/dashboard/chart-details?view=members&chartId=member-coverage&groupKey=forged&seriesKey=missing",
    403,
  );
  await f.call(
    "alice",
    "/dashboard/chart-details?view=members&chartId=member-coverage&groupKey=all&seriesKey=forged",
    403,
  );
  await f.call(
    "alice",
    "/dashboard/chart-details?view=members&chartId=member-coverage&groupKey=all&seriesKey=missing&expectedStateRevision=999",
    409,
  );
  await f.call(
    "alice",
    "/dashboard/chart-details?view=members&chartId=member-coverage",
    422,
  );
  await f.mutate((s) => {
    delete s.users.find((u) => u.id === "alice")!.organizationAdministration;
  });
  await f.call(
    "alice",
    "/dashboard/chart-details?view=members&chartId=member-coverage&groupKey=all&seriesKey=missing",
    403,
  );
});

test("필수0·기록0은 가상의 비율을 만들지 않고 만료/재인증 효력은 별도 집계한다", async (t) => {
  const seed = dashboardSeed();
  seed.orgs.roots[0]!.children[0]!.requiredQualifications = [];
  const f = await dashboardFixture(t, seed);
  const value: DashboardResponse = await f.call("admin-1", "/dashboard");
  assert.deepEqual(
    value.charts.find((c) => c.id === "required-coverage")!.groups[0]!.values,
    [0, 0],
  );
  assert.equal(value.summary.requiredCoverage.rate, null);
});

test("만료 차트는 KST 0/30/31/60/61/90일과 Hold를 유지하며 다음날 같은 시점으로 이동한다", async (t) => {
  const seed = dashboardSeed();
  for (const days of [0, 30, 31, 60, 61, 90, 91, -1]) {
    const id = "day-" + days;
    seed.state.users.push({
      id,
      name: id,
      roles: ["learner"],
      organizationId: ORG_A,
      revision: 1,
    });
    addCertification(seed, id, id, {
      expiresOn: addCalendarDays("2026-10-23", days),
      status: days === 30 ? "Hold" : "Active",
    });
  }
  addCertification(seed, "unlimited", "alice");
  addCertification(seed, "unknown", "bob", { unknown: true });
  const f = await dashboardFixture(t, seed);
  const value: DashboardResponse = await f.call(
    "admin-1",
    "/dashboard?view=renewals",
  );
  const chart = value.charts.find((c) => c.id === "expiry")!;
  assert.deepEqual(chart.groups[0]!.values, [2, 2, 2, 1, 1, 0, 1, 1]);
  const held: DashboardResponse = await f.call(
    "admin-1",
    "/dashboard?view=renewals&expiryBucket=0_30",
  );
  assert.equal(held.charts[0]!.groups[0]!.values[0], 2);
  f.setTime("2026-10-23T15:00:00.000Z");
  const next: DashboardResponse = await f.call(
    "admin-1",
    "/dashboard?view=renewals",
  );
  assert.equal(next.snapshot.date, "2026-10-24");
  assert.deepEqual(next.charts[0]!.groups[0]!.values, [2, 2, 2, 0, 2, 0, 1, 1]);
});
