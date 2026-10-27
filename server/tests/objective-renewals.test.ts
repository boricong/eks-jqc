import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execute } from "../src/domain.ts";
import { userView } from "../src/organizations.ts";
import { seedState } from "../src/seed.ts";
import { JsonStore } from "../src/storage.ts";
import { buildApp } from "./release-test-app.ts";
import { assessmentQuestions, type State } from "@eks/contracts";
import { validateState } from "../src/integrity.ts";
import { migrateObjectiveRenewals } from "../src/objective-renewal-migration.ts";
import { freezeCriteria, qualificationHash } from "../src/releases.ts";
import { seedOrganizations } from "../src/organizations.ts";
async function fixture(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-objective-renewals-")),
    s = seedState(true);
  const q = s.qualifications.find((q) => q.id === "demo-qualification")!,
    c = s.courses.find((c) => c.id === q.courseIds[0])!,
    template = s.qualificationTemplates.find((t) => t.id === q.templateId)!;
  q.validity = { type: "months", months: 12, reminderDays: [90, 30, 7] };
  q.renewalLeadMonths = 3;
  q.lifecycleStatus = "Active";
  s.qualificationTemplates.push({
    ...structuredClone(template),
    id: "renewal-template",
    purpose: "renewal",
    title: "정기 재인증",
    scope: "system",
  });
  s.courses.push({
    ...structuredClone(c),
    id: "renewal-course",
    entityId: "renewal-course",
    assessmentKinds: ["objective"],
    practicalQuestions: [],
    subjectiveEnabled: false,
    subjectiveQuestions: [],
  });
  s.qualifications.push({
    ...structuredClone(q),
    id: "renewal-qualification",
    entityId: "renewal-qualification",
    templateId: "renewal-template",
    purpose: "renewal",
    title: "정기 재인증",
    courseIds: ["renewal-course"],
    commonCourseEntityIds: [],
    validity: { type: "unknown", months: null, reminderDays: [] },
  });
  // A second independent held qualification with its own period policy.
  s.qualificationTemplates.push({
    ...structuredClone(template),
    id: "second-template",
    title: "두 번째 자격",
  });
  s.qualifications.push({
    ...structuredClone(q),
    id: "second-q",
    entityId: "second-q",
    templateId: "second-template",
    title: "두 번째 자격",
    validity: { type: "months", months: 13, reminderDays: [90, 30, 7] },
  });
  const original = s.assignments.find((a) => a.learnerId === "learner-1")!;
  s.assignments.push({
    ...structuredClone(original),
    id: "second-assignment",
    qualificationId: "second-q",
  });
  for (const cid of q.courseIds)
    s.enrollments.push({
      id: randomUUID(),
      assignmentId: "second-assignment",
      courseId: cid,
    });
  const second = s.assignments.find((a) => a.id === "second-assignment")!;
  second.frozenCriteria = freezeCriteria(
    s,
    s.qualifications.find((q) => q.id === "second-q")!,
    "admin-1",
    "plan",
    "2026-01-01T00:00:00.000Z",
  );
  delete second.qualificationMetadata;
  const file = path.join(dir, "state.json");
  await new JsonStore(file).initialize(s);
  const store = await new JsonStore(file).load();
  let now = "2026-01-31T01:00:00.000Z";
  const app = await buildApp(store, { clock: () => now }),
    sessions = new Map<string, string>();
  async function call(
    url: string,
    body?: any,
    status = 200,
    who = "learner-1",
    method?: "PUT" | "POST" | "GET",
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
      url: "/api" + url,
      method: method || (body === undefined ? "GET" : "POST"),
      headers: { cookie: sessions.get(who)!, "idempotency-key": key },
      ...(body === undefined ? {} : { payload: body }),
    });
    if (r.statusCode === 503 && url.endsWith("/submit")) {
      const draft = structuredClone(store.snapshot());
      execute(
        draft,
        userView(
          draft.users.find((u) => u.id === who)!,
          store.organizations.snapshot(),
        ),
        "attempt.submit",
        url.split("/")[2]!,
        body,
        store.organizations.snapshot(),
        undefined,
        now,
      );
      validateState(draft, store.organizations.snapshot());
    }
    assert.equal(r.statusCode, status, `${url}: ${r.body}`);
    return r.json();
  }
  async function pass(aid: string) {
    for (const e of store
      .snapshot()
      .enrollments.filter((e) => e.assignmentId === aid)) {
      const course = store.snapshot().courses.find((c) => c.id === e.courseId)!;
      for (const kind of course.assessmentKinds) {
        if (
          store
            .snapshot()
            .attempts.some(
              (t) =>
                t.enrollmentId === e.id &&
                t.kind === kind &&
                t.result === "passed",
            )
        )
          continue;
        const attempt = await call(`/enrollments/${e.id}/attempts`, { kind });
        await call(
          `/attempts/${attempt.id}/draft`,
          {
            revision: attempt.revision,
            answers: Object.fromEntries(
              assessmentQuestions(course, kind).map((q) => [q.id, q.correct]),
            ),
          },
          200,
          "learner-1",
          "PUT",
        );
        await call(`/attempts/${attempt.id}/submit`, {
          revision: attempt.revision + 1,
        });
      }
    }
  }
  async function mutate(fn: (s: State) => void) {
    await store.transact(
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
  async function start(ids?: string[]) {
    const v = await call("/me/renewal-candidates");
    const body = {
      stateRevision: v.stateRevision,
      organizationRevision: v.organizationRevision,
      qualificationId: v.qualification.id,
      qualificationRevision: v.qualification.revision,
      certificationIds:
        ids ||
        v.candidates
          .filter((c: any) => !c.reasons.length)
          .map((c: any) => c.certificationId),
    };
    const before = store.snapshot();
    await call("/renewal-batches/preview", body);
    assert.deepEqual(store.snapshot(), before);
    return { body, result: await call("/renewal-batches", body) };
  }
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  return {
    store,
    call,
    pass,
    mutate,
    start,
    setTime: (v: string) => (now = v),
    originalId: original.id,
  };
}
test("객관식 1회로 두 인증의 각 기간을 갱신하고 별도 인증을 발급하지 않는다", async (t) => {
  const f = await fixture(t);
  await f.pass(f.originalId);
  await f.pass("second-assignment");
  f.setTime("2026-12-01T00:00:00.000Z");
  const before = f.store.snapshot(),
    { result, body } = await f.start(),
    b = f.store.snapshot().renewalBatches[0]!;
  await f.call("/renewal-batches", body, 409);
  await f.call(`/renewal-batches/${b.id}`, undefined, 403, "learner-2");
  await f.pass(b.assignmentId);
  const after = f.store.snapshot();
  assert.equal(after.certifications.length, before.certifications.length);
  assert.equal(after.plans.length, before.plans.length);
  assert.equal(after.renewalBatches[0]!.status, "completed");
  assert.equal(
    after.renewals.filter(
      (r) => r.batchId === result.id && r.status === "completed",
    ).length,
    2,
  );
  for (const c of after.certifications) {
    const old = before.certifications.find((x) => x.id === c.id)!;
    assert.deepEqual(c.evidence, old.evidence);
    assert.equal(c.periods!.length, 2);
    assert.equal(c.periods![1]!.baseOn, old.periods![0]!.expiresOn);
  }
  validateState(after, f.store.organizations.snapshot());
  await f.call(
    `/certifications/${after.certifications[0]!.id}/renewals`,
    { certificationRevision: after.certifications[0]!.revision },
    410,
  );
  const r = after.renewals[0]!;
  await f.call(
    `/renewals/${r.id}/complete`,
    {
      revision: r.revision,
      certificationRevision: 99,
      confirmation: "종합평가 완료",
    },
    410,
  );
});
test("Hold 대상만 보류하고 해제 후 같은 평가 근거로 갱신한다", async (t) => {
  const f = await fixture(t);
  await f.pass(f.originalId);
  await f.pass("second-assignment");
  f.setTime("2026-12-01T00:00:00.000Z");
  const { result } = await f.start(),
    b = f.store.snapshot().renewalBatches[0]!,
    cid = f.store.snapshot().certifications[0]!.id;
  await f.mutate((s) => {
    s.certifications.find((c) => c.id === cid)!.lifecycleStatus = "Hold";
  });
  await f.pass(b.assignmentId);
  assert.equal(f.store.snapshot().renewalBatches[0]!.status, "passed");
  assert.equal(
    f.store.snapshot().renewals.filter((r) => r.status === "completed").length,
    1,
  );
  const v = await f.call(`/renewal-batches/${result.id}`);
  assert.ok(
    v.targets.find((t: any) => t.certificationId === cid).reasons.length,
  );
  await f.mutate((s) => {
    s.certifications.find((c) => c.id === cid)!.lifecycleStatus = "Active";
  });
  const key = randomUUID(),
    body = { revision: v.batch.revision };
  const done = await f.call(
    `/renewal-batches/${result.id}/apply`,
    body,
    200,
    "learner-1",
    "POST",
    key,
  );
  assert.deepEqual(
    await f.call(
      `/renewal-batches/${result.id}/apply`,
      body,
      200,
      "learner-1",
      "POST",
      key,
    ),
    done,
  );
  assert.equal(f.store.snapshot().certifications[0]!.periods!.length, 2);
});
test("만료 후 적용 금지·닫기·구성 위조 차단·시작 응답 유실 재시도", async (t) => {
  const f = await fixture(t);
  await f.pass(f.originalId);
  f.setTime("2026-12-01T00:00:00.000Z");
  const v = await f.call("/me/renewal-candidates"),
    body = {
      stateRevision: v.stateRevision,
      organizationRevision: v.organizationRevision,
      qualificationId: v.qualification.id,
      qualificationRevision: v.qualification.revision,
      certificationIds: [v.candidates[0].certificationId],
    },
    key = randomUUID();
  const [one, two] = await Promise.all([
    f.call("/renewal-batches", body, 200, "learner-1", "POST", key),
    f.call("/renewal-batches", body, 200, "learner-1", "POST", key),
  ]);
  assert.deepEqual(one, two);
  assert.equal(f.store.snapshot().renewalBatches.length, 1);
  const b = f.store.snapshot().renewalBatches[0]!;
  await f.mutate((s) => {
    s.certifications[0]!.lifecycleStatus = "Hold";
  });
  f.setTime("2027-02-02T00:00:00.000Z");
  const e = f.store
    .snapshot()
    .enrollments.find((e) => e.assignmentId === b.assignmentId)!;
  await f.call(`/enrollments/${e.id}/attempts`, { kind: "objective" }, 409);
  await f.call(`/renewal-batches/${b.id}/close`, { revision: b.revision });
  assert.equal(f.store.snapshot().renewalBatches[0]!.status, "closed");
  const tampered = structuredClone(f.store.snapshot());
  tampered.courses.find((c) => c.id === "renewal-course")!.subjectiveEnabled =
    true;
  assert.throws(() =>
    validateState(tampered, f.store.organizations.snapshot()),
  );
});
test("명시 이관은 기존 기준 해시·업무를 보존하고 재실행은 무변경", () => {
  const raw: any = seedState(true);
  raw.schemaVersion = 27;
  delete raw.renewalBatches;
  for (const q of [...raw.qualifications, ...raw.qualificationTemplates])
    delete q.purpose;
  const hashes = raw.qualifications.map(qualificationHash),
    before = structuredClone(raw),
    org = seedOrganizations();
  const next = migrateObjectiveRenewals(raw, org, "2026-10-27T00:00:00.000Z");
  assert.equal(next.state.schemaVersion, 28);
  assert.deepEqual(next.state.qualifications.map(qualificationHash), hashes);
  for (const key of [
    "assignments",
    "attempts",
    "certifications",
    "completions",
    "plans",
    "courses",
  ])
    assert.deepEqual((next.state as any)[key], before[key]);
  assert.deepEqual(migrateObjectiveRenewals(next.state, org).state, next.state);
  assert.deepEqual(raw, before);
  const invalid = structuredClone(raw);
  invalid.qualifications[0].purpose = "renewal";
  assert.throws(() => migrateObjectiveRenewals(invalid, org));
  assert.deepEqual(raw, before);
});
test("모든 대상 Hold도 합격 근거를 보존하고 만료 후에는 갱신하지 않는다", async (t) => {
  const f = await fixture(t);
  await f.pass(f.originalId);
  f.setTime("2026-12-01T00:00:00.000Z");
  const { result } = await f.start(),
    b = f.store.snapshot().renewalBatches[0]!;
  await f.mutate((s) => {
    s.certifications[0]!.lifecycleStatus = "Hold";
  });
  await f.pass(b.assignmentId);
  assert.equal(f.store.snapshot().renewalBatches[0]!.status, "passed");
  f.setTime("2027-02-02T00:00:00.000Z");
  const v = await f.call(`/renewal-batches/${result.id}`);
  await f.call(`/renewal-batches/${result.id}/apply`, {
    revision: v.batch.revision,
  });
  assert.equal(f.store.snapshot().certifications[0]!.periods!.length, 1);
  assert.ok(
    (await f.call(`/renewal-batches/${result.id}`)).targets[0].reasons.length,
  );
});
test("기본 용도 잠금·전역 단일 원본·권한·시작 실패 원자성·미리보기 충돌", async (t) => {
  const f = await fixture(t),
    template = f.store
      .snapshot()
      .qualificationTemplates.find((t) => t.id === "renewal-template")!;
  await f.call(
    "/system/qualification-templates",
    {
      title: "두 번째 재인증",
      englishName: "",
      description: "",
      qualificationType: "auditee",
      purpose: "renewal",
    },
    422,
    "operator-1",
  );
  await f.call(
    "/system/qualification-templates/renewal-template",
    {
      revision: template.revision,
      title: template.title,
      englishName: template.englishName,
      description: "",
      qualificationType: "auditee",
      purpose: "acquisition",
    },
    409,
    "operator-1",
    "PUT",
  );
  await f.call("/me/renewal-candidates", undefined, 403, "admin-1");
  await f.pass(f.originalId);
  f.setTime("2026-12-01T00:00:00.000Z");
  const v = await f.call("/me/renewal-candidates"),
    body = {
      stateRevision: v.stateRevision,
      organizationRevision: v.organizationRevision,
      qualificationId: v.qualification.id,
      qualificationRevision: v.qualification.revision,
      certificationIds: [v.candidates[0].certificationId],
    },
    before = f.store.snapshot();
  f.store.beforeReplace = async () => {
    throw Error("test failure");
  };
  await f.call("/renewal-batches", body, 503);
  assert.deepEqual(f.store.snapshot(), before);
  f.store.beforeReplace = undefined;
  await f.mutate((s) => {
    s.qualifications.find((q) => q.id === "renewal-qualification")!.revision++;
  });
  await f.call("/renewal-batches", body, 409);
  assert.equal(f.store.snapshot().renewalBatches.length, 0);
});
test("팀 풀 등록은 용도를 보존하고 미완성 Hold 저장·준비 완료 Active 전환·비객관식 전파 보류", async (t) => {
  const f = await fixture(t);
  await f.mutate((s) => {
    s.qualifications = s.qualifications.filter(
      (q) => q.id !== "renewal-qualification",
    );
  });
  const result = await f.call(
    "/qualification-templates/import",
    {
      templateIds: ["renewal-template"],
      templateRevisions: {
        "renewal-template": f.store
          .snapshot()
          .qualificationTemplates.find((t) => t.id === "renewal-template")!
          .revision,
      },
    },
    200,
    "admin-1",
  );
  const id = result.imported[0],
    q = f.store.snapshot().qualifications.find((q) => q.id === id)!;
  assert.equal(q.purpose, "renewal");
  assert.equal(q.lifecycleStatus, "Ready");
  await f.call(
    `/qualifications/${id}`,
    { ...q, courseIds: ["renewal-course"] },
    200,
    "admin-1",
    "PUT",
  );
  const current = f.store.snapshot().qualifications.find((q) => q.id === id)!;
  assert.equal(current.lifecycleStatus, "Hold");
  const impact = await f.call(
    `/qualifications/${id}/lifecycle-impact`,
    undefined,
    200,
    "admin-1",
  );
  await f.call(
    `/qualifications/${id}/lifecycle`,
    {
      status: "Active",
      reason: "객관식 기준 준비",
      revision: current.revision,
      stateRevision: impact.revision,
      organizationRevision: impact.organizationRevision,
    },
    200,
    "admin-1",
  );
  const before = f.store.snapshot().qualifications.find((q) => q.id === id)!,
    course = f.store.snapshot().courses.find((c) => c.id === "renewal-course")!;
  const saved = await f.call(
    `/courses/${course.id}`,
    {
      ...course,
      subjectiveEnabled: true,
      subjectiveQuestions: [{ id: "new-question", prompt: "추가 답변" }],
    },
    200,
    "admin-1",
    "PUT",
  );
  assert.notEqual(saved.id, course.id);
  assert.deepEqual(
    f.store.snapshot().qualifications.find((q) => q.id === id)!.courseIds,
    before.courseIds,
  );
  const updated = f.store.snapshot().qualifications.find((q) => q.id === id)!;
  await f.call(
    `/qualifications/${id}`,
    { ...updated, courseIds: [saved.id] },
    409,
    "admin-1",
    "PUT",
  );
  const planState = await f.call("/workspace");
  assert.ok(
    !planState.planningOptions.some((r: any) =>
      r.candidates.some((c: any) => c.qualificationId === id),
    ),
  );
});
test("미완료 이전 Auditee 갱신만 감사와 함께 종료하고 실제 인증·평가를 보존한다", async (t) => {
  const f = await fixture(t);
  await f.pass(f.originalId);
  const raw: any = structuredClone(f.store.snapshot());
  raw.schemaVersion = 27;
  raw.renewalBatches = [];
  raw.qualifications = raw.qualifications.filter(
    (q: any) => q.purpose !== "renewal",
  );
  raw.qualificationTemplates = raw.qualificationTemplates.filter(
    (q: any) => q.purpose !== "renewal",
  );
  const c = raw.certifications[0],
    q = raw.qualifications.find((q: any) => q.id === c.qualificationId);
  raw.renewals.push({
    id: "old-draft",
    certificationId: c.id,
    periodId: c.periods[0].id,
    learnerId: c.learnerId,
    lv1OrganizationId: q.lv1OrganizationId,
    qualificationId: q.id,
    qualificationRevision: q.revision,
    validity: q.validity,
    renewalLeadMonths: 3,
    revision: 1,
    status: "draft",
    startedAt: "2026-10-31T00:00:00.000Z",
    method: "mvp_completion",
  });
  const before = structuredClone(raw),
    next = migrateObjectiveRenewals(
      raw,
      f.store.organizations.snapshot(),
      "2026-11-01T00:00:00.000Z",
    );
  assert.equal(next.report.closedLegacyRenewals, 1);
  assert.equal(next.state.renewals[0]!.status, "closed");
  assert.equal(next.state.renewals[0]!.revision, 2);
  assert.deepEqual(next.state.certifications, before.certifications);
  assert.deepEqual(next.state.attempts, before.attempts);
  assert.deepEqual(next.state.completions, before.completions);
  assert.deepEqual(raw, before);
  assert.deepEqual(
    migrateObjectiveRenewals(next.state, f.store.organizations.snapshot())
      .state,
    next.state,
  );
});
