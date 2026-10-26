import { legacyPlanFixture } from "./legacy-plan-fixture.ts";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { seedState } from "../src/seed.ts";
import { seedOrganizations, userView } from "../src/organizations.ts";
import { JsonStore } from "../src/storage.ts";
import { buildApp } from "../src/app.ts";
import {
  effectiveRequirements,
  saveRequirements,
  previewPlanningRequest,
} from "../src/organization-requirements.ts";
import { migrateOrganizationNeeds } from "../src/organization-requirement-migration.ts";
import { exportMaster, readMaster, contentHash } from "../src/master-data.ts";
import { linkFixtureTemplates } from "./template-helpers.ts";
const root = "org-photo",
  child = "org-photo-fmg",
  leaf = "org-photo-pyeongtaek-1",
  qid = "demo-qualification";
async function fixture(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-needs-")),
    file = path.join(dir, "runtime/state.json");
  await new JsonStore(file).initialize(seedState(true));
  const store = await new JsonStore(file).load(),
    app = await buildApp(store),
    cookies = new Map<string, string>();
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  async function call(
    who: string,
    url: string,
    body?: any,
    status = 200,
    method?: any,
    key = randomUUID(),
  ) {
    if (!cookies.has(who)) {
      const r = await app.inject({
        method: "POST",
        url: "/api/session",
        payload: { actorId: who },
      });
      cookies.set(who, `${r.cookies[0]!.name}=${r.cookies[0]!.value}`);
    }
    const r = await app.inject({
      method: method || (body === undefined ? "GET" : "POST"),
      url: "/api" + url,
      headers: { cookie: cookies.get(who)!, "idempotency-key": key },
      ...(body === undefined ? {} : { payload: body }),
    });
    assert.equal(r.statusCode, status, `${who} ${url}: ${r.body}`);
    return r.json();
  }
  const change = (fn: (s: ReturnType<typeof seedState>) => void) =>
    store.transact(
      "operator-1",
      randomUUID(),
      "fixture",
      () => {},
      (s) => {
        fn(s);
        return {};
      },
    );
  const set = async (organizationId = root, entityIds = [qid]) =>
    call(
      "admin-1",
      "/organization-qualification-requirements",
      {
        stateRevision: store.snapshot().revision,
        organizationRevision: store.organizations.snapshot().revision,
        changes: [{ organizationId, entityIds }],
      },
      200,
      "PUT",
    );
  const request = async (replaceRequestIds: string[] = []) => {
    const p = await call("admin-1", "/planning-requests/preview", {
      learnerIds: ["learner-2"],
    });
    return call("admin-1", "/planning-requests", {
      learnerIds: ["learner-2"],
      message: "필요자격 요청",
      stateRevision: p.stateRevision,
      organizationRevision: p.organizationRevision,
      replaceRequestIds,
    });
  };
  return { dir, file, store, app, call, change, set, request };
}
test("조직 필요자격은 상위 합집합·중복 출처를 유지하고 세부 관리자 권한을 제한한다", async (t) => {
  const f = await fixture(t);
  await f.set();
  await f.set(child);
  await f.change((s) => {
    const u = s.users.find((u) => u.id === "learner-2")!;
    u.organizationId = child;
    u.organizationAdministration = {
      organizationId: child,
      grantedBy: "admin-1",
      grantedAt: new Date().toISOString(),
    };
  });
  const v = await f.call(
    "learner-2",
    "/organization-qualification-requirements",
  );
  assert.equal(v.entries.length, 1);
  assert.equal(v.entries[0].effective.length, 1);
  assert.equal(v.entries[0].effective[0].sourceOrganizations.length, 2);
  await f.call(
    "learner-2",
    "/organization-qualification-requirements",
    {
      stateRevision: f.store.snapshot().revision,
      organizationRevision: f.store.organizations.snapshot().revision,
      changes: [{ organizationId: root, entityIds: [] }],
    },
    403,
    "PUT",
  );
  await f.call(
    "learner-2",
    "/organization-qualification-requirements",
    {
      stateRevision: f.store.snapshot().revision,
      organizationRevision: f.store.organizations.snapshot().revision,
      changes: [{ organizationId: child, entityIds: [] }],
    },
    200,
    "PUT",
  );
  assert.equal(
    effectiveRequirements(
      f.store.snapshot(),
      f.store.organizations.snapshot(),
      leaf,
    ).length,
    1,
  );
  await f.set(root, []);
  assert.equal(
    effectiveRequirements(
      f.store.snapshot(),
      f.store.organizations.snapshot(),
      leaf,
    ).length,
    0,
  );
});
test("필요자격0·준비 미완성·오래된 확인은 요청을 보류하고 서버에서 입력을 검증한다", async (t) => {
  const f = await fixture(t);
  const p = await f.call("admin-1", "/planning-requests/preview", {
    learnerIds: ["learner-2"],
  });
  assert.equal(p.rows[0].status, "excluded");
  await f.call(
    "admin-1",
    "/planning-requests",
    {
      learnerIds: ["learner-2"],
      message: "",
      stateRevision: p.stateRevision,
      organizationRevision: p.organizationRevision,
    },
    409,
  );
  await f.call(
    "admin-1",
    "/organization-qualification-requirements",
    {
      stateRevision: f.store.snapshot().revision,
      organizationRevision: f.store.organizations.snapshot().revision,
      changes: [{ organizationId: root, entityIds: ["recipe"] }],
    },
    409,
    "PUT",
  );
  await f.set();
  await f.call(
    "admin-1",
    "/planning-requests",
    {
      learnerIds: ["learner-2"],
      message: "",
      stateRevision: p.stateRevision,
      organizationRevision: p.organizationRevision,
    },
    409,
  );
  await f.change((s) => {
    s.qualifications.find((q) => q.id === qid)!.lifecycleStatus = "Hold";
  });
  assert.equal(
    (
      await f.call("admin-1", "/planning-requests/preview", {
        learnerIds: ["learner-2"],
      })
    ).rows[0].status,
    "blocked",
  );
  assert.equal(
    f.store.snapshot().organizationQualificationRequirements[0]!.entityIds
      .length,
    1,
  );
  await f.set(root, []);
});
test("새 요청은 필요 목록을 고정하며 제외·추가를 막고 초안 삭제 후에도 필요 대상이 남는다", async (t) => {
  const f = await fixture(t);
  await f.set();
  const { ids } = await f.request();
  let r = f.store.snapshot().planningRequests.find((r) => r.id === ids[0])!;
  assert.equal(r.mode, "organization_required");
  assert.deepEqual(
    r.selections.map((t) => t.entityId),
    [qid],
  );
  await f.set(root, []);
  assert.equal(
    (await f.call("learner-2", `/planning-requests/${r.id}/candidates`))
      .candidates.length,
    1,
  );
  await f.call(
    "learner-2",
    `/planning-requests/${r.id}/selection`,
    { revision: r.revision, entityIds: [] },
    409,
    "PUT",
  );
  await f.call(
    "learner-2",
    "/plans",
    { requestId: r.id, qualificationId: "recipe", requestRevision: r.revision },
    409,
  );
  const p = await f.call("learner-2", "/plans", {
    requestId: r.id,
    qualificationId: qid,
    requestRevision: r.revision,
  });
  const plan = f.store.snapshot().plans.find((x) => x.id === p.id)!;
  await f.call(
    "learner-2",
    `/plans/${plan.id}`,
    { revision: plan.revision },
    200,
    "DELETE",
  );
  r = f.store.snapshot().planningRequests.find((x) => x.id === r.id)!;
  assert.equal(r.selections.length, 1);
  await f.call(
    "learner-2",
    `/planning-requests/${r.id}/complete`,
    { revision: r.revision },
    409,
  );
});
test("요청 교체 종료는 원자적이며 초안은 잠기고 재시도는 요청·종료·알림을 중복 생성하지 않는다", async (t) => {
  const f = await fixture(t);
  await f.set();
  const oldId = (await f.request()).ids[0];
  const p = await f.call("learner-2", "/plans", {
    requestId: oldId,
    qualificationId: qid,
    requestRevision: 1,
  });
  const before = f.store.snapshot();
  const review = await f.call("admin-1", "/planning-requests/preview", {
    learnerIds: ["learner-2"],
  });
  const body = {
      learnerIds: ["learner-2"],
      message: "교체",
      stateRevision: review.stateRevision,
      organizationRevision: review.organizationRevision,
      replaceRequestIds: [oldId],
    },
    key = randomUUID();
  f.store.beforeReplace = () => {
    throw Error("replace");
  };
  await f.call("admin-1", "/planning-requests", body, 503, "POST", key);
  assert.deepEqual(f.store.snapshot(), before);
  f.store.beforeReplace = undefined;
  const result = await f.call(
    "admin-1",
    "/planning-requests",
    body,
    200,
    "POST",
    key,
  );
  assert.deepEqual(
    await f.call("admin-1", "/planning-requests", body, 200, "POST", key),
    result,
  );
  const s = f.store.snapshot(),
    old = s.planningRequests.find((r) => r.id === oldId)!;
  assert.equal(old.closed?.replacementRequestId, result.ids[0]);
  assert.ok(s.plans.find((x) => x.id === p.id));
  await f.call(
    "learner-2",
    `/plans/${p.id}`,
    { revision: s.plans.find((x) => x.id === p.id)!.revision },
    409,
    "DELETE",
  );
  assert.equal(
    (await f.call("learner-2", `/planning-requests/${oldId}/candidates`)).stage,
    "요청 종료",
  );
  const next = await f.call("learner-2", "/plans", {
    requestId: result.ids[0],
    qualificationId: qid,
    requestRevision: 1,
  });
  assert.notEqual(next.id, p.id);
});
test("필요 지정 참조 자격은 삭제 차단, JSON13 왕복과 구형12·이관은 과거 필요 설정을 복원하지 않는다", async (t) => {
  const f = await fixture(t);
  await f.set();
  const impact = await f.call(
    "admin-1",
    `/qualifications/${qid}/deletion-impact`,
  );
  assert.equal(impact.canDelete, false);
  const s = f.store.snapshot(),
    org = f.store.organizations.snapshot(),
    file = exportMaster(s, org, new Date().toISOString());
  assert.equal(file.formatVersion, 14);
  assert.deepEqual(readMaster(file).payload, file.payload);
  const old: any = structuredClone(file);
  old.formatVersion = 12;
  old.stateSchemaVersion = 22;
  delete old.payload.organizationQualificationRequirements;
  delete old.counts.organizationQualificationRequirements;
  old.sha256 = contentHash(old.payload);
  assert.deepEqual(
    readMaster(old).payload.organizationQualificationRequirements,
    [],
  );
  old.payload.organizationQualificationRequirements =
    s.organizationQualificationRequirements;
  old.sha256 = contentHash(old.payload);
  assert.throws(() => readMaster(old));
  const raw: any = seedState(true);
  raw.schemaVersion = 22;
  legacyPlanFixture(raw);
  delete raw.organizationQualificationRequirements;
  const before = structuredClone(raw),
    m = migrateOrganizationNeeds(raw, org);
  assert.equal(m.state.schemaVersion, 25);
  assert.equal(m.state.revision, raw.revision + 3);
  assert.deepEqual(m.state.planningRequests, before.planningRequests);
  assert.deepEqual(migrateOrganizationNeeds(m.state, org).state, m.state);
  assert.deepEqual(raw, before);
});
test("여러 필요자격은 모두 확정해야 완료되며 기존 확정 계획은 추가 요청에서 중복 작성하지 않는다", async (t) => {
  const f = await fixture(t);
  await f.change((s) => {
    const q = structuredClone(s.qualifications.find((q) => q.id === qid)!);
    q.id = q.entityId = "needs-second";
    q.title = "두 번째 필요자격";
    s.qualifications.push(q);
    linkFixtureTemplates(s);
  });
  await f.set(root, [qid, "needs-second"]);
  const id = (await f.request()).ids[0];
  for (const qualificationId of [qid, "needs-second"]) {
    const r = f.store.snapshot().planningRequests.find((r) => r.id === id)!;
    const started = await f.call("learner-2", "/plans", {
      requestId: id,
      requestRevision: r.revision,
      qualificationId,
    });
    let p = f.store.snapshot().plans.find((p) => p.id === started.id)!;
    await f.call(
      "learner-2",
      `/plans/${p.id}`,
      {
        revision: p.revision,
        endOn: "2028-01-01",
        startOn: "2027-01-01",
        goal: p.goal,
      },
      200,
      "PUT",
    );
    p = f.store.snapshot().plans.find((p) => p.id === started.id)!;
    await f.call("learner-2", `/plans/${p.id}/complete`, {
      revision: p.revision,
    });
    if (qualificationId === qid) {
      const view = await f.call(
        "learner-2",
        `/planning-requests/${id}/candidates`,
      );
      assert.equal(view.canComplete, false);
    }
  }
  const r = f.store.snapshot().planningRequests.find((r) => r.id === id)!;
  await f.call("learner-2", `/planning-requests/${id}/complete`, {
    revision: r.revision,
  });
  assert.equal(
    f.store.snapshot().planningRequests.find((r) => r.id === id)!.completion
      ?.reason,
    "planned",
  );
  const next = (await f.request()).ids[0];
  const view = await f.call(
    "learner-2",
    `/planning-requests/${next}/candidates`,
  );
  assert.equal(view.noAdditional, true);
  assert.equal(view.canComplete, true);
  await f.call("learner-2", `/planning-requests/${next}/complete`, {
    revision: 1,
    confirmNoAdditional: true,
  });
  assert.equal(f.store.snapshot().plans.length, 2);
});
test("단독 종료는 소속 이동 후에도 기록을 보존하고 미완료·초안 집계에서 제외한다", async (t) => {
  const f = await fixture(t);
  await f.set();
  const id = (await f.request()).ids[0];
  await f.call("learner-2", "/plans", {
    requestId: id,
    requestRevision: 1,
    qualificationId: qid,
  });
  const before = f.store.snapshot().plans;
  await f.call(
    "learner-2",
    `/planning-requests/${id}/close`,
    { revision: 1, reason: "종료" },
    403,
  );
  const r = f.store.snapshot().planningRequests.find((r) => r.id === id)!;
  await f.call("admin-1", `/planning-requests/${id}/close`, {
    revision: r.revision,
    reason: "조직 변경 준비",
  });
  assert.deepEqual(f.store.snapshot().plans, before);
  const ws = await f.call("admin-1", "/workspace");
  assert.equal(
    ws.planningReadiness.find((r: any) => r.learnerId === "learner-2")
      .draftCount,
    0,
  );
  const member = await f.call("admin-1", "/dashboard/members/learner-2");
  assert.ok(member.requests.find((r: any) => r.id === id).closedOn);
  await f.change((s) => {
    s.users.find((u) => u.id === "learner-2")!.organizationId = leaf;
  });
  assert.equal(
    f.store.snapshot().planningRequests.find((r) => r.id === id)!
      .organizationId,
    root,
  );
  const next = (await f.request()).ids[0];
  assert.equal(
    f.store.snapshot().planningRequests.find((r) => r.id === next)!
      .organizationId,
    leaf,
  );
});
test("시스템 운영자 지정은 선택 팀을 검사하고 미리보기 이후 저장 실패·권한 변경을 보류한다", async (t) => {
  const f = await fixture(t);
  await f.call(
    "operator-1",
    "/organization-qualification-requirements",
    undefined,
    403,
  );
  const v = await f.call(
    "operator-1",
    "/organization-qualification-requirements?lv1OrganizationId=org-photo",
  );
  const body = {
    stateRevision: v.stateRevision,
    organizationRevision: v.organizationRevision,
    changes: [{ organizationId: root, entityIds: [qid] }],
  };
  await f.call(
    "operator-1",
    "/organization-qualification-requirements/preview?lv1OrganizationId=org-photo",
    body,
  );
  const before = f.store.snapshot();
  f.store.beforeReplace = () => {
    throw Error("write failure");
  };
  await f.call(
    "operator-1",
    "/organization-qualification-requirements?lv1OrganizationId=org-photo",
    body,
    503,
    "PUT",
  );
  assert.deepEqual(f.store.snapshot(), before);
  f.store.beforeReplace = undefined;
  await f.call(
    "operator-1",
    "/organization-qualification-requirements?lv1OrganizationId=org-photo",
    body,
    200,
    "PUT",
  );
  await f.call(
    "operator-1",
    "/organization-qualification-requirements?lv1OrganizationId=org-photo",
    body,
    409,
    "PUT",
  );
});
