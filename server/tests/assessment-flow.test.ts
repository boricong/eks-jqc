import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import ExcelJS from "exceljs";
import {
  assessmentQuestions,
  renewalNoticeOn,
  renewalOpensOn,
  addCalendarDays,
  courseUseErrors,
  type CertificationPeriod,
  type State,
} from "@eks/contracts";
import { seedState } from "../src/seed.ts";
import { JsonStore } from "../src/storage.ts";
import { buildApp } from "../src/app.ts";
import { migrateAssessmentFlow } from "../src/assessment-flow-migration.ts";
import { exportCatalog, prepareCatalog } from "../src/catalog.ts";
import {
  readCatalogWorkbook,
  writeCatalogWorkbook,
} from "../src/catalog-workbook.ts";
const clock = "2028-01-31T01:00:00.000Z";
async function fixture(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-flow-")),
    file = path.join(dir, "runtime/state.json"),
    seed = seedState(true);
  const q = seed.qualifications.find((q) => q.id === "demo-qualification")!;
  q.validity = { type: "months", months: 12, reminderDays: [90, 30, 7] };
  q.renewalLeadMonths = 3;
  q.renewalNoticeDaysBefore = 7;
  await new JsonStore(file).initialize(seed);
  const store = await new JsonStore(file).load(),
    app = await buildApp(store, { clock: () => clock }),
    cookies = new Map<string, string>();
  async function call(
    url: string,
    body?: any,
    status = 200,
    who = "learner-1",
    method?: "GET" | "POST" | "PUT",
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
    assert.equal(r.statusCode, status, r.body);
    return r.json();
  }
  async function mutate(fn: (s: State) => void) {
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
  }
  async function pass(eid: string, kind: "objective" | "practical") {
    const e = store.snapshot().enrollments.find((e) => e.id === eid)!,
      c = store.snapshot().courses.find((c) => c.id === e.courseId)!;
    const a = await call(`/enrollments/${encodeURIComponent(eid)}/attempts`, {
      kind,
    });
    await call(
      `/attempts/${a.id}/draft`,
      {
        revision: a.revision,
        answers: Object.fromEntries(
          assessmentQuestions(c, kind).map((q) => [q.id, q.correct]),
        ),
      },
      200,
      "learner-1",
      "PUT",
    );
    await call(`/attempts/${a.id}/submit`, { revision: a.revision + 1 });
    return a.id;
  }
  async function earn() {
    for (const e of store
      .snapshot()
      .enrollments.filter((e) => e.assignmentId === "assignment-1"))
      for (const kind of ["objective", "practical"] as const)
        if (
          !store
            .snapshot()
            .attempts.some(
              (a) =>
                a.enrollmentId === e.id &&
                a.kind === kind &&
                a.result === "passed",
            )
        )
          await pass(e.id, kind);
    return store.snapshot().certifications[0]!;
  }
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, file, store, app, call, mutate, pass, earn };
}
test("재인증 알림일은 KST 달력·월말·윤년·0일과 짧은 유효기간을 적용한다", () => {
  const p: CertificationPeriod = {
    id: "p",
    sequence: 1,
    kind: "initial",
    qualificationId: "q",
    qualificationVersion: 1,
    source: "issued",
    completedAt: clock,
    startsOn: "2027-01-01",
    baseOn: "2027-01-01",
    expiresOn: "2027-10-22",
    validity: { type: "months", months: 12, reminderDays: [] },
    renewalLeadMonths: 3,
    renewalNoticeDaysBefore: 7,
  };
  assert.equal(renewalOpensOn(p), "2027-07-22");
  assert.equal(renewalNoticeOn(p), "2027-07-15");
  assert.equal(
    renewalNoticeOn({ ...p, renewalNoticeDaysBefore: 0 }),
    "2027-07-22",
  );
  assert.equal(
    renewalNoticeOn({ ...p, startsOn: "2028-02-29", expiresOn: "2028-03-31" }),
    "2028-02-29",
  );
  assert.equal(
    renewalNoticeOn({ ...p, startsOn: "2027-01-01", expiresOn: "2028-05-31" }),
    "2028-02-22",
  );
  assert.equal(
    renewalNoticeOn({
      ...p,
      validity: { type: "unlimited", months: null, reminderDays: [] },
    }),
    undefined,
  );
});
test("사전 알림은 회차별 한 번이며 자정·중단 보충·Hold 해제·이미 읽은 알림에도 중복되지 않는다", async (t) => {
  const f = await fixture(t),
    c = await f.earn(),
    p = c.periods![0]!,
    due = renewalNoticeOn(p)!;
  await f.store.refreshNotifications(
    `${addCalendarDays(due, -1)}T14:59:59.000Z`,
  );
  assert.equal(
    f.store.snapshot().notifications.filter((n) => n.type === "renewal").length,
    0,
  );
  await f.mutate((s) => {
    s.users.find((u) => u.id === "learner-1")!.certificationEligibility =
      "hold";
  });
  await f.store.refreshNotifications(`${due}T01:00:00Z`);
  assert.equal(
    f.store.snapshot().notifications.filter((n) => n.type === "renewal").length,
    0,
  );
  await f.mutate((s) => {
    s.users.find((u) => u.id === "learner-1")!.certificationEligibility =
      "eligible";
  });
  await f.store.refreshNotifications(`${due}T01:00:00Z`);
  let list = f.store
    .snapshot()
    .notifications.filter((n) => n.type === "renewal");
  assert.equal(list.length, 1);
  assert.equal(list[0]!.scheduledOn, due);
  await f.call(`/notifications/${list[0]!.id}/read`, {});
  await Promise.all([
    f.store.refreshNotifications(`${renewalOpensOn(p)}T01:00:00Z`),
    f.store.refreshNotifications(`${renewalOpensOn(p)}T01:00:00Z`),
  ]);
  list = f.store.snapshot().notifications.filter((n) => n.type === "renewal");
  assert.equal(list.length, 1);
  assert.ok(list[0]!.readAt);
  assert.equal(
    f.store.snapshot().notifications.filter((n) => n.type === "expiry").length,
    0,
  );
  assert.deepEqual(f.store.snapshot().certifications[0]!.evidence, c.evidence);
});
test("기존 만료 예정 알림이 있으면 새 알림 없이 이력을 유지하고 만료 후에는 폐기 사실만 알린다", async (t) => {
  const f = await fixture(t),
    c = await f.earn(),
    p = c.periods![0]!;
  await f.mutate((s) => {
    s.notifications.push({
      id: "old-reminder",
      key: `expiry:${c.id}:${p.id}:90`,
      type: "expiry",
      title: "이전 알림",
      body: "원문",
      recipientId: c.learnerId,
      lv1OrganizationId: "org-photo",
      assignmentId: c.assignmentId,
      certificationId: c.id,
      periodId: p.id,
      href: "/notifications",
      createdAt: clock,
    });
  });
  await f.store.refreshNotifications(`${renewalOpensOn(p)}T01:00:00Z`);
  assert.equal(
    f.store.snapshot().notifications.filter((n) => n.type === "renewal").length,
    0,
  );
  await f.store.refreshNotifications(
    `${addCalendarDays(p.expiresOn!, 1)}T01:00:00Z`,
  );
  await f.store.refreshNotifications(
    `${addCalendarDays(p.expiresOn!, 2)}T01:00:00Z`,
  );
  assert.equal(
    f.store.snapshot().notifications.filter((n) => n.type === "expired").length,
    1,
  );
  assert.equal(
    f.store.snapshot().notifications.find((n) => n.id === "old-reminder")!.body,
    "원문",
  );
});
test("실기 시작·저장·제출은 같은 수강의 지식 통과가 필요하고 미응답은 문항 ID와 함께 거부된다", async (t) => {
  const f = await fixture(t),
    eid = "assignment-1:demo-course-2";
  let r = await f.call(
    `/enrollments/${eid}/attempts`,
    { kind: "practical" },
    409,
  );
  assert.equal(r.code, "ASSESSMENT_PREREQUISITE_NOT_PASSED");
  // Represent an existing draft from the previous free-order policy.
  await f.mutate((s) => {
    s.attempts.push({
      id: "old-draft",
      enrollmentId: eid,
      courseId: "demo-course-2",
      learnerId: "learner-1",
      kind: "practical",
      round: 1,
      status: "in_progress",
      revision: 1,
      createdAt: clock,
      answers: {},
    });
  });
  for (const suffix of ["draft", "submit"]) {
    r = await f.call(
      `/attempts/old-draft/${suffix}`,
      { revision: 1, ...(suffix === "draft" ? { answers: {} } : {}) },
      409,
      "learner-1",
      suffix === "draft" ? "PUT" : "POST",
    );
    assert.equal(r.code, "ASSESSMENT_PREREQUISITE_NOT_PASSED");
  }
  await f.pass(eid, "objective");
  r = await f.call(`/enrollments/${eid}/attempts`, { kind: "practical" });
  assert.equal(r.id, "old-draft");
  r = await f.call("/attempts/old-draft/submit", { revision: 1 }, 422);
  assert.equal(r.code, "ASSESSMENT_INCOMPLETE");
  assert.ok(r.details.missingQuestionIds.length);
  await f.pass(eid, "practical");
  assert.equal(
    f.store.snapshot().attempts.find((a) => a.id === "old-draft")!.result,
    "passed",
  );
});
test("실기 전용 사용 등록은 개별·일괄 모두 차단하고 지식 전용은 허용한다", async (t) => {
  const f = await fixture(t),
    s = f.store.snapshot(),
    c = s.courses.find((c) => c.id === "demo-course-2")!;
  assert.ok(
    courseUseErrors({ ...c, assessmentKinds: ["practical"] }).some((m) =>
      m.includes("지식 평가도"),
    ),
  );
  assert.ok(
    !courseUseErrors({ ...c, assessmentKinds: ["objective"] }).some((m) =>
      m.includes("지식 평가도"),
    ),
  );
  const x = await f.call("/courses", {}, 200, "admin-1"),
    draft = f.store.snapshot().courses.find((c) => c.id === x.id)!;
  await f.call(
    `/courses/${x.id}`,
    {
      ...draft,
      ...c,
      id: x.id,
      entityId: x.id,
      revision: 1,
      assessmentKinds: ["practical"],
    },
    200,
    "admin-1",
    "PUT",
  );
  const data = exportCatalog(s, "org-photo", ["demo-qualification"]);
  const row = data.sheets[0]!.tables.courses.find(
    (r) => r.sourceId === "demo-course-2",
  )!;
  row.kinds = "practical";
  assert.ok(
    prepareCatalog(s, data, "org-photo").issues.some((i) =>
      i.message.includes("지식 평가도"),
    ),
  );
});
test("v5 왕복과 v3/v4 누락 정책은 새 버전 없이 유지하며 기존 알림 배열을 재해석하지 않는다", async (t) => {
  const f = await fixture(t);
  await f.mutate((s) => {
    s.qualifications.find(
      (q) => q.id === "demo-qualification",
    )!.renewalNoticeDaysBefore = 14;
  });
  const s = f.store.snapshot(),
    data = exportCatalog(s, "org-photo", ["demo-qualification"]);
  const parsed = await readCatalogWorkbook(await writeCatalogWorkbook(data));
  assert.equal(parsed.workbook.format, "eks-catalog-v10");
  assert.equal(parsed.workbook.sheets[0]!.renewalNoticeDaysBefore, 14);
  assert.equal(
    prepareCatalog(s, parsed.workbook, "org-photo").changes[0]!.kind,
    "unchanged",
  );
  for (const format of ["eks-catalog-v3", "eks-catalog-v4"] as const) {
    const old = structuredClone(data);
    old.format = format;
    delete old.sheets[0]!.renewalNoticeDaysBefore;
    old.sheets[0]!.reminderDays = [1, 20, 100];
    const p = prepareCatalog(s, old, "org-photo");
    assert.equal(p.changes[0]!.kind, "unchanged");
    assert.equal(p.workbook.sheets[0]!.renewalNoticeDaysBefore, 14);
  }
  const b = new ExcelJS.Workbook();
  await b.xlsx.load((await writeCatalogWorkbook(data)) as any);
  assert.equal(b.subject, "eks-catalog-v10");
  assert.ok(
    b.worksheets[2]!.getSheetValues()
      .flat()
      .some((x: any) => x === "재인증 시작 N일 전 알림"),
  );
});
test("9→10은 원본 근거·조직을 보존하고 영구 백업·반복 이관 무변경을 확인한다", async (t) => {
  const f = await fixture(t);
  await f.earn();
  const raw: any = structuredClone(f.store.snapshot()),
    org = f.store.organizations.snapshot();
  raw.schemaVersion = 9;
  for (const q of raw.qualifications) delete q.renewalNoticeDaysBefore;
  for (const c of raw.certifications)
    for (const p of c.periods) delete p.renewalNoticeDaysBefore;
  const before = structuredClone(raw),
    next = migrateAssessmentFlow(raw, org, clock);
  assert.deepEqual(raw, before);
  assert.equal(next.state.schemaVersion, 16);
  assert.equal(next.state.revision, raw.revision + 7);
  for (const key of [
    "attempts",
    "completions",
    "plans",
    "assignments",
    "enrollments",
  ] as const)
    assert.deepEqual(next.state[key], raw[key]);
  assert.deepEqual(
    next.state.certifications[0]!.evidence,
    raw.certifications[0].evidence,
  );
  assert.deepEqual(
    next.state.certifications[0]!.validity,
    raw.certifications[0].validity,
  );
  assert.equal(next.state.certifications[0]!.date, raw.certifications[0].date);
  assert.equal(
    migrateAssessmentFlow(next.state, org, clock).report.alreadyApplied,
    true,
  );
  const target = path.join(f.dir, "migration/runtime/state.json"),
    bytes = Buffer.from(JSON.stringify(raw)),
    store = new JsonStore(target);
  await new JsonStore(target).initialize(next.state);
  await writeFile(target, bytes);
  const orgBytes = await readFile(store.organizations.file),
    hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const expected = {
    revision: raw.revision,
    stateHash: hash(bytes),
    organizationHash: hash(orgBytes),
  };
  const result: any = await store.migratePolicies(
    expected,
    migrateAssessmentFlow,
    "assessment-flow",
  );
  assert.equal(
    hash(await readFile(store.organizations.file)),
    expected.organizationHash,
  );
  assert.deepEqual(await readFile(result.stateBackup), bytes);
  const after = await readFile(target),
    count = (await readdir(store.backupDir)).length;
  await store.migratePolicies(
    {
      revision: result.revision,
      stateHash: hash(after),
      organizationHash: expected.organizationHash,
    },
    migrateAssessmentFlow,
    "assessment-flow",
  );
  assert.deepEqual(await readFile(target), after);
  assert.equal((await readdir(store.backupDir)).length, count);
});
