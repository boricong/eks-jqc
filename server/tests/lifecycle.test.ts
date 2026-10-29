import { loadPlanningFixture } from "./planning-migration-helper.ts";
import { releaseFixture } from "./release-fixture.ts";
import { legacyPlanFixture } from "./legacy-plan-fixture.ts";
import { legacyRequestFixture } from "./legacy-request-fixture.ts";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import {
  addCalendarMonths,
  renewalOpensOn,
  effectiveCredentialStatus,
  credentialCurrent,
  assessmentQuestions,
  type State,
} from "@eks/contracts";
import { seedState } from "../src/seed.ts";
import { JsonStore } from "../src/storage.ts";
import { buildApp } from "./release-test-app.ts";
import { validateState } from "../src/integrity.ts";
import { migrateLifecycle } from "../src/lifecycle-migration.ts";
const qid = "demo-qualification",
  learner = "learner-2";
const at = "2026-01-31T01:00:00.000Z";
async function fixture(t: TestContext, months = 12) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-lifecycle-")),
    file = path.join(dir, "runtime/state.json");
  const seed = seedState(true);
  const q = seed.qualifications.find((q) => q.id === qid)!;
  q.validity = { type: "months", months, reminderDays: [90, 30, 7] };
  q.renewalLeadMonths = 3;
  q.lifecycleStatus = "Active";
  // Test-only one-Set qualification; keep the unrelated fixture untouched.
  q.courseIds = ["demo-course-1"];
  seed.assignments = [];
  seed.enrollments = [];
  seed.attempts = [];
  seed.completions = [];
  seed.users.push({
    id: "other-team",
    name: "다른 팀",
    roles: ["learner"],
    organizationId: "org-etch",
    revision: 1,
  });
  const template = seed.qualificationTemplates.find(
      (t) => t.id === q.templateId,
    )!,
    course = seed.courses.find((c) => c.id === q.courseIds[0])!;
  seed.qualificationTemplates.push({
    ...structuredClone(template),
    id: "renewal-template",
    purpose: "renewal",
    title: "재인증",
    scope: "system",
  });
  seed.courses.push({
    ...structuredClone(course),
    id: "renewal-course",
    entityId: "renewal-course",
    assessmentKinds: ["objective"],
    practicalQuestions: [],
    subjectiveEnabled: false,
    subjectiveQuestions: [],
  });
  seed.qualifications.push({
    ...structuredClone(q),
    id: "renewal-q",
    entityId: "renewal-q",
    templateId: "renewal-template",
    purpose: "renewal",
    title: "재인증",
    courseIds: ["renewal-course"],
  });
  await new JsonStore(file).initialize(seed);
  let store = await loadPlanningFixture(file),
    now = at;
  let app = await buildApp(store, { clock: () => now });
  const sessions = new Map<string, string>();
  async function call(
    who: string,
    url: string,
    body?: any,
    status = 200,
    method?: "GET" | "POST" | "PUT",
    key = randomUUID(),
  ) {
    if (!sessions.has(who)) {
      const r = await app.inject({
        method: "POST",
        url: "/api/session",
        payload: { actorId: who },
      });
      assert.equal(r.statusCode, 200, r.body);
      sessions.set(who, `${r.cookies[0]!.name}=${r.cookies[0]!.value}`);
    }
    const r = await app.inject({
      method: method || (body === undefined ? "GET" : "POST"),
      url: `/api${url}`,
      headers: { cookie: sessions.get(who)!, "idempotency-key": key },
      ...(body === undefined ? {} : { payload: body }),
    });
    assert.equal(r.statusCode, status, `${who} ${url}: ${r.body}`);
    return r.json();
  }
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  return {
    dir,
    file,
    call,
    get store() {
      return store;
    },
    setTime(v: string) {
      now = v;
    },
    get now() {
      return now;
    },
    async restart() {
      await app.close();
      store = await loadPlanningFixture(file);
      app = await buildApp(store, { clock: () => now });
      sessions.clear();
    },
    async mutate(fn: (s: State) => void) {
      return store.transact(
        "admin-1",
        randomUUID(),
        "fixture",
        () => {},
        (s) => {
          fn(s);
          return {};
        },
      );
    },
  };
}
type F = Awaited<ReturnType<typeof fixture>>;
async function request(f: F) {
  return (
    await legacyRequestFixture(f.store, "admin-1", {
      learnerIds: [learner],
      message: "취득 계획",
    })
  ).ids[0] as string;
}
async function plan(f: F, requestId = undefined as string | undefined) {
  requestId ||= await request(f);
  const p = await f.call(learner, "/plans", {
    requestRevision: f.store
      .snapshot()
      .planningRequests.find((r) => r.id === requestId)!.revision,
    qualificationId: qid,
    requestId,
  });
  const draft = f.store.snapshot().plans.find((x) => x.id === p.id)!;
  await f.call(
    learner,
    `/plans/${p.id}`,
    {
      revision: draft.revision,
      endOn: draft.endOn,
      startOn: draft.startOn,
      goal: "기준 확인과 대응 판단",
    },
    200,
    "PUT",
  );
  return { id: p.id as string, requestId };
}
async function confirm(f: F, p: { id: string }) {
  return (
    await f.call(learner, `/plans/${p.id}/complete`, {
      revision: f.store.snapshot().plans.find((x) => x.id === p.id)!.revision,
    })
  ).assignmentId as string;
}
async function finish(f: F, assignmentId: string) {
  for (const e of f.store
    .snapshot()
    .enrollments.filter((e) => e.assignmentId === assignmentId)) {
    const c = f.store.snapshot().courses.find((c) => c.id === e.courseId)!;
    for (const kind of c.assessmentKinds) {
      const a = await f.call(
        learner,
        `/enrollments/${encodeURIComponent(e.id)}/attempts`,
        { kind },
      );
      await f.call(
        learner,
        `/attempts/${a.id}/draft`,
        {
          revision: a.revision,
          answers: Object.fromEntries(
            assessmentQuestions(c, kind).map((q) => [q.id, q.correct]),
          ),
        },
        200,
        "PUT",
      );
      await f.call(learner, `/attempts/${a.id}/submit`, {
        revision: a.revision + 1,
      });
    }
  }
  return f.store
    .snapshot()
    .certifications.find((c) => c.assignmentId === assignmentId)!;
}
async function earn(f: F) {
  return finish(f, await confirm(f, await plan(f)));
}
async function criterion(f: F, status: string, key = randomUUID()) {
  const i = await f.call("admin-1", `/qualifications/${qid}/lifecycle-impact`);
  return f.call(
    "admin-1",
    `/qualifications/${qid}/lifecycle`,
    {
      status,
      reason: "운영 검토",
      revision: i.qualification.revision,
      stateRevision: i.revision,
      organizationRevision: i.organizationRevision,
    },
    200,
    "POST",
    key,
  );
}
async function eligibility(
  f: F,
  value: string,
  who = "admin-1",
  ids = [learner],
  expected = 200,
) {
  return f.call(
    who,
    "/certification-targets/eligibility",
    {
      userIds: ids,
      eligibility: value,
      reason: "대상자 조정",
      revision: f.store.snapshot().revision,
    },
    expected,
    "PUT",
  );
}
async function history(f: F, id: string) {
  return f.call(learner, `/certifications/${id}/history`);
}
async function start(f: F, id: string) {
  const v = await f.call(learner, "/me/renewal-candidates");
  const b = await f.call(learner, "/renewal-batches", {
    stateRevision: v.stateRevision,
    organizationRevision: v.organizationRevision,
    qualificationId: v.qualification.id,
    qualificationRevision: v.qualification.revision,
    certificationIds: [id],
  });
  const batch = f.store
      .snapshot()
      .renewalBatches.find((bat) => bat.id === b.id)!,
    e = f.store
      .snapshot()
      .enrollments.find((e) => e.assignmentId === batch.assignmentId)!,
    course = f.store.snapshot().courses.find((c) => c.id === e.courseId)!;
  const attempt = await f.call(learner, `/enrollments/${e.id}/attempts`, {
    kind: "objective",
  });
  await f.call(
    learner,
    `/attempts/${attempt.id}/draft`,
    {
      revision: attempt.revision,
      answers: Object.fromEntries(
        course.questions.map((q) => [q.id, q.correct]),
      ),
    },
    200,
    "PUT",
  );
  const r = f.store.snapshot().renewals.find((r) => r.batchId === batch.id)!;
  return {
    ...r,
    attemptId: attempt.id,
    attemptRevision: attempt.revision + 1,
    certificationRevision: f.store
      .snapshot()
      .certifications.find((c) => c.id === id)!.revision,
  };
}
async function complete(
  f: F,
  id: string,
  r: any,
  status = 200,
  key = randomUUID(),
) {
  return f.call(
    learner,
    `/attempts/${r.attemptId}/submit`,
    { revision: r.attemptRevision },
    status,
    "POST",
    key,
  );
}
test("달력 개월·윤년·KST 만료 경계·짧은 기간의 재인증 시작 보정", () => {
  assert.equal(addCalendarMonths("2028-01-31", 1), "2028-02-29");
  assert.equal(addCalendarMonths("2028-02-29", 12), "2029-02-28");
  const p = {
    startsOn: "2028-01-31",
    expiresOn: "2028-02-29",
    renewalLeadMonths: 3,
    validity: { type: "months" as const, months: 1, reminderDays: [7] },
  };
  assert.equal(renewalOpensOn(p), "2028-01-31");
  assert.equal(
    effectiveCredentialStatus(
      { lifecycleStatus: "Hold", validity: p.validity, expiresOn: p.expiresOn },
      "2028-02-29T14:59:59.999Z",
    ),
    "Hold",
  );
  assert.equal(
    effectiveCredentialStatus(
      { lifecycleStatus: "Hold", validity: p.validity, expiresOn: p.expiresOn },
      "2028-02-29T15:00:00.000Z",
    ),
    "Revoke",
  );
});
test("기준 Hold/Revoke는 새 계획·확정만 막고 기존 배정의 자동 취득과 보유 자격은 유지", async (t) => {
  const f = await fixture(t),
    draft = await plan(f);
  await criterion(f, "Hold");
  await f.call(learner, `/plans/${draft.id}/complete`, { revision: 2 }, 409);
  await criterion(f, "Active");
  const a = await confirm(f, draft);
  await criterion(f, "Revoke");
  const c = await finish(f, a);
  assert.equal(c.lifecycleStatus, "Active");
  f.setTime("2026-11-01T00:00:00.000Z");
  assert.equal((await history(f, c.id)).renewal.canStart, false);
  const impact = await f.call(
    "admin-1",
    `/qualifications/${qid}/lifecycle-impact`,
  );
  await f.call(
    "admin-1",
    `/qualifications/${qid}/lifecycle`,
    {
      status: "Active",
      reason: "재개 불가",
      revision: impact.qualification.revision,
      stateRevision: impact.revision,
      organizationRevision: impact.organizationRevision,
    },
    409,
  );
  const clone = await f.call(
    "admin-1",
    ...releaseFixture(f.store.snapshot(), "qualifications", qid),
    200,
    "PUT",
  );
  assert.equal(
    f.store.snapshot().qualifications.find((q) => q.id === clone.id)!
      .lifecycleStatus,
    "Revoke",
  );
});
test("대상자 Hold는 평가 시작·저장·제출·요청을 막고 기존 답안과 개인 효력은 유지", async (t) => {
  const f = await fixture(t),
    a = await confirm(f, await plan(f)),
    e = f.store.snapshot().enrollments.find((e) => e.assignmentId === a)!;
  const attempt = await f.call(
    learner,
    `/enrollments/${encodeURIComponent(e.id)}/attempts`,
    { kind: "objective" },
  );
  await eligibility(f, "hold");
  assert.equal(
    (
      await f.call(
        learner,
        `/attempts/${attempt.id}/draft`,
        { revision: 1, answers: {} },
        409,
        "PUT",
      )
    ).code,
    "TARGET_ON_HOLD",
  );
  await f.call(learner, `/attempts/${attempt.id}/submit`, { revision: 1 }, 409);
  await f.call(
    learner,
    `/enrollments/${encodeURIComponent(e.id)}/attempts`,
    { kind: "practical" },
    409,
  );
  await f.call(
    "admin-1",
    "/planning-requests",
    {
      stateRevision: f.store.snapshot().revision,
      organizationRevision: f.store.organizations.snapshot().revision,
      learnerIds: [learner],
      message: "요청",
    },
    409,
  );
  const w = await f.call("admin-1", "/workspace");
  assert.equal(w.eligibilitySummary.held, 1);
  assert.equal(
    f.store.snapshot().attempts.find((x) => x.id === attempt.id)!.status,
    "in_progress",
  );
  await eligibility(f, "eligible");
  const c = await finish(f, a);
  await eligibility(f, "hold");
  assert.equal((await history(f, c.id)).effectiveStatus, "Active");
});
test("세부 관리자는 하위 조직 인원도 Hold하고 기준·개인 상태·재인증 대리는 거부", async (t) => {
  const f = await fixture(t);
  const entries = f.store.organizations.snapshot().roots[0]!.children;
  const child = entries[0]!.id,
    grandchild = entries[0]!.children[0]!.id;
  await f.mutate((s) => {
    s.users.find((x) => x.id === learner)!.organizationId = child;
    const u = s.users.find((x) => x.id === "ft-1")!;
    u.organizationId = child;
    u.organizationAdministration = {
      organizationId: child,
      grantedBy: "admin-1",
      grantedAt: at,
    };
    s.users.find((x) => x.id === "ft-2")!.organizationId = grandchild;
  });
  const view = await f.call("ft-1", "/certification-targets");
  assert.deepEqual(
    view.users.map((u: any) => u.id).sort(),
    ["ft-1", "ft-2", learner].sort(),
  );
  for (const other of ["learner-1", "other-team"])
    await eligibility(f, "hold", "ft-1", [other], 403);
  await eligibility(f, "hold", "ft-1", ["ft-2"]);
  await eligibility(f, "eligible", "ft-1", ["ft-2"]);
  await eligibility(f, "hold", "ft-1");
  await eligibility(f, "eligible", "ft-1");
  const c = await earn(f);
  await f.call(
    "ft-1",
    `/certifications/${c.id}/status`,
    { revision: c.revision, status: "Hold", reason: "권한 없음" },
    403,
  );
  await f.call(
    "ft-1",
    `/qualifications/${qid}/lifecycle-impact`,
    undefined,
    403,
  );
  await f.call(
    "admin-1",
    `/certifications/${c.id}/renewals`,
    { certificationRevision: c.revision },
    403,
  );
  await f.mutate((s) => {
    delete s.users.find((x) => x.id === "ft-1")!.organizationAdministration;
  });
  await eligibility(f, "hold", "ft-1", [learner], 403);
});
test("조기 재인증·유효기간 연속성·최초 근거 보존·재시도·한 회차 중복 방지", async (t) => {
  const f = await fixture(t),
    c = await earn(f),
    before = f.store.snapshot();
  await f.call(
    learner,
    `/certifications/${c.id}/renewals`,
    { certificationRevision: c.revision },
    410,
  );
  f.setTime("2026-10-31T00:00:00.000Z");
  const r = await start(f, c.id),
    key = randomUUID(),
    body = {
      revision: r.attemptRevision,
    };
  const done = await complete(f, c.id, r, 200, key);
  assert.deepEqual(
    await f.call(
      learner,
      `/attempts/${r.attemptId}/submit`,
      body,
      200,
      "POST",
      key,
    ),
    done,
  );
  const h = await history(f, c.id),
    after = f.store.snapshot();
  assert.equal(h.current.expiresOn, "2028-01-31");
  assert.equal(h.periods[1].startsOn, "2027-02-01");
  assert.equal(h.periods[1].completedAt, f.now);
  for (const field of [
    "id",
    "date",
    "snapshot",
    "completedCourseIds",
    "completionIds",
    "validity",
    "expiresOn",
  ] as const)
    assert.deepEqual((h.certification as any)[field], (c as any)[field]);
  assert.deepEqual(
    after.attempts.filter((t) => before.attempts.some((x) => x.id === t.id)),
    before.attempts,
  );
  assert.deepEqual(
    after.completions.filter((c) =>
      before.completions.some((x) => x.id === c.id),
    ),
    before.completions,
  );
  assert.equal(after.certifications.length, 1);
  assert.equal(
    after.renewals.filter((r) => r.status === "completed").length,
    1,
  );
  assert.equal(h.renewal.canStart, false);
  await complete(f, c.id, r, 409);
  await f.restart();
  assert.equal((await history(f, c.id)).current.expiresOn, "2028-01-31");
});
test("짧은 인증기간 갱신은 다음 유효기간 시작 전 반복할 수 없다", async (t) => {
  const f = await fixture(t, 1),
    c = await earn(f),
    r = await start(f, c.id);
  await complete(f, c.id, r);
  assert.equal((await history(f, c.id)).renewal.opensOn, "2026-03-01");
  await f.call(
    learner,
    `/certifications/${c.id}/renewals`,
    { certificationRevision: f.store.snapshot().certifications[0]!.revision },
    410,
  );
  f.setTime("2026-02-28T15:00:00.000Z");
  assert.equal((await history(f, c.id)).renewal.canStart, true);
});
test("재인증 시작 후 최신 변경에도 시작 당시 기준과 발급 원본을 보존", async (t) => {
  const f = await fixture(t),
    c = await earn(f);
  f.setTime("2026-11-01T00:00:00.000Z");
  const r = await start(f, c.id);
  await f.mutate((s) => {
    const q = s.qualifications.find((q) => q.id === qid)!;
    s.qualifications.push({
      ...structuredClone(q),
      id: "renewal-v2",
      parentId: qid,
      version: 2,
      revision: 1,
      validity: { type: "unlimited", months: null, reminderDays: [] },
    });
  });
  await complete(f, c.id, r);
  const h = await history(f, c.id);
  assert.equal(
    f.store.snapshot().renewals.find((x) => x.id === r.id)!.qualificationId,
    qid,
  );
  assert.equal(h.current.validity.type, "months");
  assert.equal(h.renewals[0].status, "completed");
  assert.equal(h.certification.expiresOn, c.expiresOn);
  assert.equal(h.renewal.canStart, false);
});
test("개인 Hold·해제·대상자 Hold와 관계없이 만료 자동 폐기·중복 알림 방지·늦은 완료 거부", async (t) => {
  const f = await fixture(t),
    c = await earn(f);
  f.setTime("2026-11-01T00:00:00.000Z");
  const r = await start(f, c.id);
  await f.call("admin-1", `/certifications/${c.id}/status`, {
    revision: r.certificationRevision,
    status: "Hold",
    reason: "효력 검토",
  });

  let h = await history(f, c.id);
  assert.equal(h.renewal.canStart, false);
  await f.call("admin-1", `/certifications/${c.id}/status`, {
    revision: h.certification.revision,
    status: "Active",
    reason: "검토 완료",
  });
  await eligibility(f, "hold");
  f.setTime("2027-01-31T15:00:00.000Z");
  h = await history(f, c.id);
  assert.equal(h.effectiveStatus, "Revoke");
  const ev = h.events.find((e: any) => e.action === "expired");
  assert.equal(ev.effectiveAt, "2027-01-31T15:00:00.000Z");
  await complete(f, c.id, r, 409);
  await f.restart();
  await history(f, c.id);
  assert.equal(
    f.store.snapshot().lifecycleEvents.filter((e) => e.action === "expired")
      .length,
    1,
  );
  assert.equal(
    f.store.snapshot().notifications.filter((n) => n.type === "expired").length,
    1,
  );
  await f.call(
    "admin-1",
    `/certifications/${c.id}/status`,
    {
      revision: h.certification.revision,
      status: "Active",
      reason: "복구 불가",
    },
    409,
  );
});
test("폐기 후 새 요청·취득 회차·새 인증과 독립 평가", async (t) => {
  const f = await fixture(t),
    p = await plan(f),
    a = await confirm(f, p),
    first = await finish(f, a);
  await f.call("admin-1", `/certifications/${first.id}/status`, {
    revision: first.revision,
    status: "Revoke",
    reason: "재취득 확인",
  });
  await f.call(
    learner,
    "/plans",
    {
      requestRevision: f.store
        .snapshot()
        .planningRequests.find((r) => r.id === p.requestId)!.revision,
      qualificationId: qid,
      requestId: p.requestId,
    },
    409,
  );
  const secondPlan = await plan(f),
    secondA = await confirm(f, secondPlan);
  assert.notEqual(a, secondA);
  assert.equal(
    f.store
      .snapshot()
      .attempts.filter((t) => t.enrollmentId.startsWith(secondA)).length,
    0,
  );
  const second = await finish(f, secondA);
  assert.notEqual(second.id, first.id);
  assert.equal(second.previousCertificationId, first.id);
  assert.equal((await history(f, first.id)).effectiveStatus, "Revoke");
});
test("갱신 저장 실패·동시 완료·관리자 revision 충돌은 부분 저장과 중복을 만들지 않는다", async (t) => {
  const f = await fixture(t),
    c = await earn(f);
  f.setTime("2026-11-01T00:00:00.000Z");
  const r = await start(f, c.id),
    before = f.store.snapshot();
  f.store.beforeReplace = async () => {
    throw new Error("disk full");
  };
  await complete(f, c.id, r, 503);
  assert.deepEqual(f.store.snapshot(), before);
  f.store.beforeReplace = undefined;
  const key = randomUUID();
  const results = await Promise.all([
    complete(f, c.id, r, 200, key),
    complete(f, c.id, r, 200, key),
  ]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(f.store.snapshot().certifications[0]!.periods!.length, 2);
  await f.call(
    "admin-1",
    `/certifications/${c.id}/status`,
    { revision: 1, status: "Hold", reason: "오래된 탭" },
    409,
  );
});
test("스키마 9 보존 이관·기간 미정 Hold와 근거 정정·반복 이관 무변경", async (t) => {
  const f = await fixture(t),
    c = await earn(f),
    raw: any = structuredClone(f.store.snapshot());
  raw.schemaVersion = 8;
  legacyPlanFixture(raw);
  delete raw.renewals;
  raw.qualifications = raw.qualifications.filter(
    (q: any) => q.purpose !== "renewal",
  );
  raw.qualificationTemplates = raw.qualificationTemplates.filter(
    (q: any) => q.purpose !== "renewal",
  );
  raw.renewalBatches = [];
  delete raw.lifecycleEvents;
  for (const x of raw.certifications) {
    delete x.periods;
    delete x.lifecycleStatus;
    delete x.revision;
    delete x.validityNeedsCorrection;
    x.validity = { type: "unknown", months: null, reminderDays: [] };
    delete x.expiresOn;
  }
  const org = f.store.organizations.snapshot(),
    m = migrateLifecycle(raw, org, at);
  assert.equal(m.state.certifications[0]!.lifecycleStatus, "Hold");
  assert.equal(m.state.certifications[0]!.id, c.id);
  assert.deepEqual(m.state.attempts, raw.attempts);
  assert.deepEqual(migrateLifecycle(m.state, org, at).state, m.state);
  await f.mutate((s) => Object.assign(s, m.state));
  await f.call(
    "admin-1",
    `/certifications/${c.id}/status`,
    { revision: 1, status: "Active", reason: "근거 없음" },
    409,
  );
  await f.call("admin-1", `/certifications/${c.id}/validity-correction`, {
    revision: 1,
    reason: "이관 정책 확인",
    evidence: "발급 당시 기준 문서 확인",
    validity: { type: "months", months: 12, reminderDays: [30] },
    renewalLeadMonths: 3,
  });
  const h = await history(f, c.id);
  assert.equal(h.current.expiresOn, "2027-01-31");
  assert.equal(h.certification.date, c.date);
  assert.equal(h.certification.validityNeedsCorrection, false);
  await f.call(
    "admin-1",
    `/certifications/${c.id}/validity-correction`,
    {
      revision: h.certification.revision,
      reason: "임의 연장",
      evidence: "없음",
      validity: { type: "months", months: 24, reminderDays: [30] },
      renewalLeadMonths: 3,
    },
    409,
  );
});

test("업무8→9 이관의 영구 백업 쌍·조직 바이트 불변·교체 실패 복구·반복 실행 무변경", async (t) => {
  const f = await fixture(t);
  await earn(f);
  const file = path.join(f.dir, "offline/runtime/state.json"),
    store = new JsonStore(file);
  await store.initialize(f.store.snapshot());
  const raw: any = structuredClone(f.store.snapshot());
  raw.schemaVersion = 8;
  legacyPlanFixture(raw);
  delete raw.renewals;
  raw.qualifications = raw.qualifications.filter(
    (q: any) => q.purpose !== "renewal",
  );
  raw.qualificationTemplates = raw.qualificationTemplates.filter(
    (q: any) => q.purpose !== "renewal",
  );
  raw.renewalBatches = [];
  delete raw.lifecycleEvents;
  for (const c of raw.certifications) {
    delete c.periods;
    delete c.lifecycleStatus;
    delete c.revision;
    delete c.validityNeedsCorrection;
  }
  await writeFile(file, JSON.stringify(raw));
  await writeFile(
    store.organizations.file,
    JSON.stringify(f.store.organizations.snapshot()),
  );
  const b = await readFile(file),
    o = await readFile(store.organizations.file),
    hash = (v: Buffer) => createHash("sha256").update(v).digest("hex");
  const expected = {
    revision: raw.revision,
    stateHash: hash(b),
    organizationHash: hash(o),
  };
  const transform = (s: unknown, d: unknown) => migrateLifecycle(s, d, at);
  store.beforeReplace = async () => {
    throw new Error("replace failed");
  };
  await assert.rejects(store.migratePolicies(expected, transform, "lifecycle"));
  assert.deepEqual(await readFile(file), b);
  assert.deepEqual(await readFile(store.organizations.file), o);
  store.beforeReplace = undefined;
  const report: any = await store.migratePolicies(
    expected,
    transform,
    "lifecycle",
  );
  assert.deepEqual(await readFile(report.stateBackup), b);
  assert.deepEqual(await readFile(report.organizationBackup), o);
  assert.deepEqual(await readFile(store.organizations.file), o);
  const after = await readFile(file),
    candidate = JSON.parse(after.toString()),
    count = (await readdir(store.backupDir)).length;
  assert.equal(candidate.schemaVersion, 28);
  assert.deepEqual(candidate.attempts, raw.attempts);
  await store.migratePolicies(
    { ...expected, revision: candidate.revision, stateHash: hash(after) },
    transform,
    "lifecycle",
  );
  assert.deepEqual(await readFile(file), after);
  assert.equal((await readdir(store.backupDir)).length, count);
  const loaded = await loadPlanningFixture(file);
  await loaded.close();
});
