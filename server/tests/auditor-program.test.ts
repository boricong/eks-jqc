import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { seedState } from "../src/seed.ts";
import { JsonStore } from "../src/storage.ts";
import { buildApp } from "../src/app.ts";
import { validateState } from "../src/integrity.ts";
import { migrateAuditorProgram } from "../src/auditor-program-migration.ts";
import {
  exportMaster,
  readMaster,
  masterCandidate,
  contentHash,
} from "../src/master-data.ts";

async function setup(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-auditor-program-")),
    file = path.join(dir, "runtime/state.json");
  const seed = seedState(true);
  seed.users.push({
    id: "detail-auditor",
    name: "세부 관리자",
    roles: ["learner"],
    organizationId: "org-photo",
    revision: 1,
    organizationAdministration: {
      organizationId: "org-photo",
      grantedBy: "admin-1",
      grantedAt: "2026-10-26T00:00:00.000Z",
    },
  });
  await new JsonStore(file).initialize(seed);
  const store = await new JsonStore(file).load();
  let at = "2026-10-26T01:00:00.000Z";
  const app = await buildApp(store, { clock: () => at }),
    cookies = new Map<string, string>();
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  async function call(
    actor: string,
    url: string,
    body?: any,
    status = 200,
    method = body === undefined ? "GET" : "POST",
    key = randomUUID(),
  ) {
    if (!cookies.has(actor)) {
      const r = await app.inject({
        method: "POST",
        url: "/api/session",
        payload: { actorId: actor },
      });
      cookies.set(actor, `${r.cookies[0]!.name}=${r.cookies[0]!.value}`);
    }
    const r = await app.inject({
      method: method as any,
      url: "/api" + url,
      headers: { cookie: cookies.get(actor)!, "idempotency-key": key },
      ...(body === undefined ? {} : { payload: body }),
    });
    assert.equal(r.statusCode, status, `${method} ${url}: ${r.body}`);
    return r.json();
  }
  async function update(fn: (s: ReturnType<typeof seedState>) => void) {
    return store.transact(
      "operator-1",
      randomUUID(),
      randomUUID(),
      () => {},
      (s) => {
        fn(s);
        return {};
      },
    );
  }
  async function program(level: "general" | "main" = "general") {
    const p = (await call("admin-1", "/auditor-program")).program;
    const created = await call("admin-1", "/auditor-program/qualifications", {
      revision: p?.revision || 0,
      level,
      title: level === "general" ? "일반 심사원" : "메인 심사원",
      description: "",
    });
    await update((s) => {
      const q = s.qualifications.find((q) => q.id === created.id)!;
      const c = structuredClone(
        s.courses.find((c) => c.id === "demo-course-1")!,
      );
      c.id = randomUUID();
      c.entityId = c.id;
      c.qualificationType = "auditor";
      c.assessmentKinds = [];
      c.questions = [];
      c.practicalQuestions = [];
      c.learningItems = [
        {
          id: randomUUID(),
          title: "운영 기준 원문 확인",
          type: "team",
          required: true,
        },
      ];
      s.courses.push(c);
      q.courseIds = [c.id];
      q.validity = { type: "months", months: 12, reminderDays: [] };
      q.lifecycleStatus = "Active";
    });
    const current = await call("admin-1", "/auditor-program");
    await call(
      "admin-1",
      "/auditor-program",
      {
        revision: current.program.revision,
        notice: {
          title: "Auditor 지정 안내",
          body: "필수 교육 및 인증기준을 확인해 주세요.",
          links: [{ title: "자료", url: "https://example.com/training" }],
        },
      },
      200,
      "PUT",
    );
    return created.id as string;
  }
  async function designate(
    roles = ["learner", "evaluator"],
    status = 200,
    key = randomUUID(),
  ) {
    const u = store.snapshot().users.find((u) => u.id === "learner-2")!;
    return call(
      "operator-1",
      `/system/users/${u.id}`,
      {
        revision: u.revision,
        name: u.name,
        organizationId: u.organizationId,
        roles,
      },
      status,
      "PATCH",
      key,
    );
  }
  async function complete(id: string) {
    for (const e of store
      .snapshot()
      .enrollments.filter((e) => e.assignmentId === id)) {
      const c = store.snapshot().courses.find((c) => c.id === e.courseId)!;
      for (const item of c.learningItems.filter((i) => i.required)) {
        const revision =
          store
            .snapshot()
            .learningChecklists.find((l) => l.enrollmentId === e.id)
            ?.revision || 0;
        await call(
          "learner-2",
          `/enrollments/${e.id}/checklist`,
          { revision, itemId: item.id, checked: true },
          200,
          "PUT",
        );
      }
    }
  }
  return {
    store,
    app,
    file,
    call,
    update,
    program,
    designate,
    complete,
    setTime: (value: string) => {
      at = value;
    },
  };
}

test("Auditor 지정은 준비 검사·알림과 원자적이며 재시도·일반 수정·재지정·재발송을 구별한다", async (t) => {
  const f = await setup(t),
    before = f.store.snapshot();
  await f.designate(undefined, 409);
  assert.deepEqual(f.store.snapshot(), before);
  await f.program();
  const u = f.store.snapshot().users.find((u) => u.id === "learner-2")!,
    key = randomUUID(),
    body = {
      revision: u.revision,
      name: u.name,
      organizationId: u.organizationId,
      roles: ["learner", "evaluator"],
    };
  f.store.beforeReplace = () => {
    throw new Error("simulated write failure");
  };
  await f.call("operator-1", `/system/users/${u.id}`, body, 503, "PATCH", key);
  f.store.beforeReplace = undefined;
  assert(
    !f.store.snapshot().users.find((x) => x.id === u.id)?.auditorDesignation,
  );
  const result = await f.call(
    "operator-1",
    `/system/users/${u.id}`,
    body,
    200,
    "PATCH",
    key,
  );
  assert.deepEqual(
    await f.call(
      "operator-1",
      `/system/users/${u.id}`,
      body,
      200,
      "PATCH",
      key,
    ),
    result,
  );
  const first = f.store
    .snapshot()
    .notifications.filter((n) => n.type === "auditor_designation");
  assert.equal(first.length, 1);
  await f.designate();
  assert.equal(
    f.store
      .snapshot()
      .notifications.filter((n) => n.type === "auditor_designation").length,
    1,
  );
  await f.designate(["learner"]);
  await f.designate();
  assert.equal(
    f.store
      .snapshot()
      .notifications.filter((n) => n.type === "auditor_designation").length,
    2,
  );
  const p = (await f.call("admin-1", "/auditor-program")).program;
  await f.call(
    "admin-1",
    "/auditor-program",
    {
      revision: p.revision,
      notice: { title: "새 안내", body: "개정 기준", links: [] },
    },
    200,
    "PUT",
  );
  assert.deepEqual(
    f.store.snapshot().notifications.find((n) => n.id === first[0]!.id),
    first[0],
  );
  const sendKey = randomUUID(),
    send = { revision: p.revision + 1, recipientIds: ["learner-2"] };
  await f.call(
    "admin-1",
    "/auditor-program/notices/send",
    send,
    200,
    "POST",
    sendKey,
  );
  await f.call(
    "admin-1",
    "/auditor-program/notices/send",
    send,
    200,
    "POST",
    sendKey,
  );
  assert.equal(
    f.store
      .snapshot()
      .notifications.filter((n) => n.type === "auditor_designation").length,
    3,
  );
  await f.call("detail-auditor", "/auditor-program", undefined, 403);
  const scoped = await f.call("detail-auditor", "/dashboard/auditor");
  assert(
    scoped.members.every(
      (m: { id: string }) =>
        f.store.snapshot().users.find((u) => u.id === m.id)?.organizationId ===
        "org-photo",
    ),
  );
  await f.call(
    "admin-1",
    "/dashboard/auditor?lv1OrganizationId=org-etch",
    undefined,
    403,
  );
  await f.call(
    "admin-1",
    "/auditor-program?lv1OrganizationId=org-etch",
    undefined,
    403,
  );
  await f.call(
    "admin-1",
    "/auditor-program",
    {
      revision: p.revision,
      notice: { title: "stale", body: "stale", links: [] },
    },
    409,
    "PUT",
  );
});

test("계획 없이 일반→메인 자동 취득, 일반 Hold 중 메인 대기와 회복, 지정 해제 후 기존 학습 완료", async (t) => {
  const f = await setup(t);
  await f.program();
  await f.program("main");
  await f.designate();
  await f.call("learner-2", "/me/auditor/starts", { level: "main" }, 409);
  const starts = await Promise.all([
    f.call("learner-2", "/me/auditor/starts", { level: "general" }),
    f.call("learner-2", "/me/auditor/starts", { level: "general" }),
  ]);
  assert.equal(starts[0].assignmentId, starts[1].assignmentId);
  const a = f.store
    .snapshot()
    .assignments.find((a) => a.id === starts[0].assignmentId)!;
  assert.equal(a.planId, undefined);
  assert.equal(a.createdBy, "learner-2");
  await f.complete(a.id);
  const general = f.store
    .snapshot()
    .certifications.find((c) => c.assignmentId === a.id)!;
  assert.equal(general.auditor?.level, "general");
  const main = await f.call("learner-2", "/me/auditor/starts", {
    level: "main",
  });
  await f.call("admin-1", `/certifications/${general.id}/status`, {
    revision: general.revision,
    status: "Hold",
    reason: "효력 확인",
  });
  await f.designate(["learner"]);
  await f.complete(main.assignmentId);
  assert(
    !f.store
      .snapshot()
      .certifications.some((c) => c.assignmentId === main.assignmentId),
  );
  assert((await f.call("learner-2", "/me/auditor")).levels[1].pendingAward);
  const held = f.store
    .snapshot()
    .certifications.find((c) => c.id === general.id)!;
  await f.call("admin-1", `/certifications/${general.id}/status`, {
    revision: held.revision,
    status: "Active",
    reason: "효력 회복",
  });
  const mainCert = f.store
    .snapshot()
    .certifications.find((c) => c.assignmentId === main.assignmentId)!;
  assert.equal(mainCert.auditor?.prerequisiteCertificationId, general.id);
  const restored = f.store
    .snapshot()
    .certifications.find((c) => c.id === general.id)!;
  await f.call("admin-1", `/certifications/${general.id}/status`, {
    revision: restored.revision,
    status: "Hold",
    reason: "일반 독립 정지",
  });
  assert.equal((await f.call("learner-2", "/me/auditor")).currentLevel, "main");
  await f.call("learner-2", "/me/auditor/starts", { level: "main" }, 403);
  await f.call(
    "admin-1",
    "/planning-requests",
    { qualificationType: "auditor", learnerIds: ["learner-2"] },
    410,
  );
  assert.equal(
    f.store.snapshot().plans.filter((p) => p.learnerId === "learner-2").length,
    0,
  );
  validateState(f.store.snapshot(), f.store.organizations.snapshot());
});

test("본인 교육·인증기준 확인 갱신은 발급 근거를 유지하고 만료 후 재취득은 새 학습을 만든다", async (t) => {
  const f = await setup(t);
  await f.program();
  await f.program("main");
  await f.designate();
  const a = await f.call("learner-2", "/me/auditor/starts", {
    level: "general",
  });
  await f.complete(a.assignmentId);
  const c = f.store
    .snapshot()
    .certifications.find((c) => c.assignmentId === a.assignmentId)!;
  f.setTime("2027-07-26T01:00:00.000Z");
  await f.store.refreshNotifications("2027-07-19T01:00:00.000Z");
  await f.store.refreshNotifications("2027-07-19T01:00:00.000Z");
  assert.equal(
    f.store
      .snapshot()
      .notifications.filter(
        (n) => n.type === "renewal" && n.certificationId === c.id,
      ).length,
    1,
  );
  const start = await f.call("learner-2", `/certifications/${c.id}/renewals`, {
    certificationRevision: c.revision,
  });
  const count = f.store.snapshot().completions.length;
  await f.designate(["learner"]);
  await f.call(
    "learner-2",
    `/renewals/${start.id}/complete`,
    {
      certificationRevision: start.certificationRevision,
      revision: start.revision,
      confirmation: "교육·인증기준 확인",
    },
    409,
  );
  await f.designate();
  await f.call(
    "learner-2",
    `/renewals/${start.id}/complete`,
    {
      certificationRevision: start.certificationRevision,
      revision: start.revision,
      confirmation: "종합평가 완료",
    },
    422,
  );
  await f.call("learner-2", `/renewals/${start.id}/complete`, {
    certificationRevision: start.certificationRevision,
    revision: start.revision,
    confirmation: "교육·인증기준 확인",
  });
  const updated = f.store.snapshot().certifications.find((x) => x.id === c.id)!;
  assert.equal(updated.date, c.date);
  assert.equal(updated.periods!.at(-1)!.expiresOn, "2028-10-26");
  assert.equal(f.store.snapshot().completions.length, count);
  assert.equal(
    f.store.snapshot().renewals.find((r) => r.id === start.id)!.method,
    "auditor_self_confirmation",
  );
  const proof = f.store
    .snapshot()
    .renewals.find((r) => r.id === start.id)!.confirmation!;
  assert.equal(proof.confirmedBy, "learner-2");
  assert.equal(proof.qualificationVersion, 1);
  assert.equal(proof.templateRevision, 1);
  f.setTime("2028-10-26T15:00:00.000Z");
  const again = await f.call("learner-2", "/me/auditor/starts", {
    level: "general",
  });
  assert.notEqual(again.assignmentId, a.assignmentId);
  const enrollments = f.store
    .snapshot()
    .enrollments.filter((e) => e.assignmentId === again.assignmentId);
  assert(
    enrollments.every(
      (e) =>
        !f.store
          .snapshot()
          .learningChecklists.some((l) => l.enrollmentId === e.id),
    ),
  );
  // Checklist mutation clock follows the API's injected clock.
  await f.complete(again.assignmentId);
  const reacquired = f.store
    .snapshot()
    .certifications.find((x) => x.assignmentId === again.assignmentId)!;
  assert.notEqual(reacquired.id, c.id);
  assert.equal(reacquired.previousCertificationId, c.id);
  validateState(f.store.snapshot(), f.store.organizations.snapshot());
});

test("갱신 확인 중 이름·교육 기준이 바뀌면 다시 확인하고 확인 원문을 보존한다", async (t) => {
  const f = await setup(t);
  await f.program();
  await f.designate();
  const a = await f.call("learner-2", "/me/auditor/starts", {
    level: "general",
  });
  await f.complete(a.assignmentId);
  const c = f.store
    .snapshot()
    .certifications.find((c) => c.assignmentId === a.assignmentId)!;
  f.setTime("2027-07-26T01:00:00.000Z");
  const old = await f.call("learner-2", `/certifications/${c.id}/renewals`, {
    certificationRevision: c.revision,
  });
  const p = (await f.call("admin-1", "/auditor-program")).program;
  await f.call(
    "admin-1",
    "/auditor-program",
    {
      revision: p.revision,
      notice: {
        title: p.notice.title,
        body: p.notice.body,
        links: p.notice.links,
      },
      titles: [
        {
          level: "general",
          title: "개정한 일반 기준",
          description: "새 기준 원문",
        },
      ],
    },
    200,
    "PUT",
  );
  await f.call(
    "learner-2",
    `/renewals/${old.id}/complete`,
    {
      certificationRevision: old.certificationRevision,
      revision: old.revision,
      confirmation: "교육·인증기준 확인",
    },
    409,
  );
  const history = await f.call("learner-2", `/certifications/${c.id}/history`);
  assert.equal(history.renewal.auditorCriteria.title, "개정한 일반 기준");
  assert.equal(
    history.renewal.auditorCriteria.courses[0].learningItems[0].title,
    "운영 기준 원문 확인",
  );
  const next = await f.call("learner-2", `/certifications/${c.id}/renewals`, {
    certificationRevision: old.certificationRevision,
  });
  assert.notEqual(next.id, old.id);
  await f.call("learner-2", `/renewals/${next.id}/complete`, {
    certificationRevision: next.certificationRevision,
    revision: next.revision,
    confirmation: "교육·인증기준 확인",
  });
  const proof = structuredClone(
    f.store.snapshot().renewals.find((r) => r.id === next.id)!.confirmation,
  );
  assert.equal(proof!.title, "개정한 일반 기준");
  assert.equal(proof!.courses.length, 1);
  await f.update((s) => {
    s.qualificationTemplates.find(
      (t) => t.id === proof!.templateId,
    )!.description = "이후의 설명";
  });
  assert.deepEqual(
    f.store.snapshot().renewals.find((r) => r.id === next.id)!.confirmation,
    proof,
  );
});

test("업무20·JSON10은 팀 소유 기준을 보존하고 변조·정상 시작 자동 이관을 거부한다", async (t) => {
  const f = await setup(t),
    qid = await f.program();
  await f.designate();
  const s = f.store.snapshot(),
    org = f.store.organizations.snapshot(),
    master = exportMaster(s, org, "2026-10-26T00:00:00.000Z");
  assert.equal(master.formatVersion, 13);
  assert.deepEqual(readMaster(master).payload, master.payload);
  const reset = masterCandidate(
    master.payload,
    s.revision + 1,
    org.revision + 1,
  );
  assert.deepEqual(reset.state.auditorPrograms, s.auditorPrograms);
  assert.equal(reset.state.notifications.length, 0);
  assert.deepEqual(reset.state.users, s.users);
  const oldExport: any = exportMaster(
    seedState(true),
    org,
    "2026-10-26T00:00:00.000Z",
  );
  delete oldExport.payload.commonCourses;
  delete oldExport.counts.commonCourses;
  oldExport.formatVersion = 6;
  delete oldExport.counts.organizationQualificationRequirements;
  delete oldExport.counts.subjectiveQuestions;
  oldExport.organizationSchemaVersion = 2;
  oldExport.payload.organizations.qualificationPools = [];
  oldExport.counts.poolEntries = 0;
  oldExport.stateSchemaVersion = 16;
  delete oldExport.payload.auditorPrograms;
  oldExport.payload.users.find((u: any) => u.id === "learner-2").roles = [
    "evaluator",
  ];
  oldExport.sha256 = contentHash(oldExport.payload);
  const converted = readMaster(oldExport);
  assert.equal(
    converted.payload.users.find((u) => u.id === "learner-2")!
      .auditorDesignation?.source,
    "migration",
  );
  assert.deepEqual(readMaster(oldExport), converted);
  assert.equal(
    masterCandidate(converted.payload, 1, 1).state.notifications.length,
    0,
  );
  const legacy: any = seedState(true);
  legacy.schemaVersion = 16;
  delete legacy.auditorPrograms;
  legacy.users.find((u: any) => u.id === "learner-2").roles = ["evaluator"];
  const migrated = migrateAuditorProgram(legacy, org);
  assert.equal(migrated.state.schemaVersion, 23);
  assert.equal(
    migrated.state.users.find((u) => u.id === "learner-2")!.auditorDesignation
      ?.source,
    "migration",
  );
  assert.deepEqual(migrated.state.notifications, legacy.notifications);
  assert.deepEqual(
    migrateAuditorProgram(migrated.state, org).state,
    migrated.state,
  );
  assert.throws(() => validateState(legacy, org));
  const bytes = await readFile(f.file);
  assert.equal(JSON.parse(bytes.toString()).schemaVersion, 23);
});

test("재시작은 수료 근거가 있는 메인 발급 대기를 보충하고 다시 시작해도 중복 발급하지 않는다", async (t) => {
  const f = await setup(t);
  await f.program();
  await f.program("main");
  await f.designate();
  const general = await f.call("learner-2", "/me/auditor/starts", {
    level: "general",
  });
  await f.complete(general.assignmentId);
  const c = f.store
    .snapshot()
    .certifications.find((c) => c.assignmentId === general.assignmentId)!;
  const main = await f.call("learner-2", "/me/auditor/starts", {
    level: "main",
  });
  await f.call("admin-1", `/certifications/${c.id}/status`, {
    revision: c.revision,
    status: "Hold",
    reason: "일반 효력 확인",
  });
  await f.complete(main.assignmentId);
  await f.update((s) => {
    s.certifications.find((v) => v.id === c.id)!.lifecycleStatus = "Active";
  });
  assert(
    !f.store
      .snapshot()
      .certifications.some((c) => c.assignmentId === main.assignmentId),
  );
  await f.app.close();
  for (let i = 0; i < 2; i++) {
    const fresh = await new JsonStore(f.file).load();
    const app = await buildApp(fresh, {
      clock: () => "2026-10-26T01:00:00.000Z",
    });
    try {
      assert.equal(
        fresh
          .snapshot()
          .certifications.filter((c) => c.assignmentId === main.assignmentId)
          .length,
        1,
      );
      assert.equal(
        fresh
          .snapshot()
          .notifications.filter(
            (n) =>
              n.assignmentId === main.assignmentId &&
              n.type === "certification",
          ).length,
        1,
      );
      validateState(fresh.snapshot(), fresh.organizations.snapshot());
    } finally {
      await app.close();
    }
  }
});

test("명시적 16→17 이관의 실패는 세 파일을 복구하고 재실행은 데이터·알림을 중복 생성하지 않는다", async (t) => {
  const f = await setup(t);
  await f.app.close();
  const raw: any = JSON.parse(await readFile(f.file, "utf8"));
  raw.schemaVersion = 16;
  delete raw.auditorPrograms;
  await writeFile(f.file, JSON.stringify(raw, null, 2));
  const disk = new JsonStore(f.file),
    before = await readFile(f.file),
    org = await readFile(disk.organizations.file),
    maintenance = await readFile(disk.maintenanceFile);
  const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const expected = {
    revision: raw.revision,
    stateHash: hash(before),
    organizationHash: hash(org),
  };
  disk.beforeReplace = () => {
    throw new Error("v17 disk failure");
  };
  await assert.rejects(
    disk.migratePolicies(expected, migrateAuditorProgram, "auditor-workflow"),
    /v17 disk failure/,
  );
  assert.deepEqual(await readFile(f.file), before);
  assert.deepEqual(await readFile(disk.organizations.file), org);
  assert.deepEqual(await readFile(disk.maintenanceFile), maintenance);
  disk.beforeReplace = undefined;
  const report: any = await disk.migratePolicies(
    expected,
    migrateAuditorProgram,
    "auditor-workflow",
  );
  assert.deepEqual(await readFile(report.stateBackup), before);
  assert.deepEqual(await readFile(report.organizationBackup), org);
  assert.deepEqual(await readFile(report.maintenanceBackup), maintenance);
  const after = await readFile(f.file),
    afterMaintenance = await readFile(disk.maintenanceFile);
  await disk.migratePolicies(
    {
      ...expected,
      revision: JSON.parse(after.toString()).revision,
      stateHash: hash(after),
    },
    migrateAuditorProgram,
    "auditor-workflow",
  );
  assert.deepEqual(await readFile(f.file), after);
  assert.deepEqual(await readFile(disk.maintenanceFile), afterMaintenance);
  assert.deepEqual(
    JSON.parse(after.toString()).notifications,
    raw.notifications,
  );
});

test("시작 당시 기준·자료를 보존하고 과거 메인 취득자는 일반 만료 후 메인을 재취득한다", async (t) => {
  const f = await setup(t),
    qid = await f.program();
  await f.program("main");
  await f.designate();
  const generalStart = await f.call("learner-2", "/me/auditor/starts", {
    level: "general",
  });
  const original = f.store.snapshot().qualifications.find((q) => q.id === qid)!,
    beforeAssignment = f.store
      .snapshot()
      .assignments.find((a) => a.id === generalStart.assignmentId)!;
  const impact = await f.call(
    "admin-1",
    `/qualifications/${qid}/deletion-impact`,
  );
  assert.equal(impact.canDelete, true);
  assert.equal(impact.replacement, null);
  const revised = await f.call(
    "admin-1",
    `/qualifications/${qid}`,
    {
      ...original,
      validity: { type: "months", months: 24, reminderDays: [] },
      versionMode: "new",
    },
    200,
    "PUT",
  );
  const program = (await f.call("admin-1", "/auditor-program")).program;
  await f.call(
    "admin-1",
    "/auditor-program",
    {
      revision: program.revision,
      notice: {
        title: program.notice.title,
        body: program.notice.body,
        links: program.notice.links,
      },
    },
    200,
    "PUT",
  );
  assert.deepEqual(
    f.store
      .snapshot()
      .assignments.find((a) => a.id === generalStart.assignmentId)
      ?.qualificationPolicySnapshot,
    beforeAssignment.qualificationPolicySnapshot,
  );
  await f.complete(generalStart.assignmentId);
  const general = f.store
    .snapshot()
    .certifications.find((c) => c.assignmentId === generalStart.assignmentId)!;
  assert.equal(general.validity?.months, 12);
  const main = await f.call("learner-2", "/me/auditor/starts", {
    level: "main",
  });
  await f.complete(main.assignmentId);
  const firstMain = f.store
    .snapshot()
    .certifications.find((c) => c.assignmentId === main.assignmentId)!;
  await f.update((s) => {
    s.users.find((u) => u.id === "learner-2")!.certificationEligibility =
      "hold";
  });
  assert.equal((await f.call("learner-2", "/me/auditor")).currentLevel, "main");
  await f.call("learner-2", "/me/auditor/starts", { level: "general" }, 403);
  await f.update((s) => {
    s.users.find((u) => u.id === "learner-2")!.certificationEligibility =
      "eligible";
  });
  f.setTime("2027-10-26T15:00:00.000Z");
  await f.store.refreshNotifications("2027-10-26T15:00:00.000Z");
  const next = await f.call("learner-2", "/me/auditor/starts", {
    level: "main",
  });
  await f.complete(next.assignmentId);
  const renewed = f.store
    .snapshot()
    .certifications.find((c) => c.assignmentId === next.assignmentId)!;
  assert.equal(renewed.previousCertificationId, firstMain.id);
  assert.equal(renewed.auditor?.kind, "reacquisition");
  assert.equal(renewed.auditor?.prerequisiteCertificationId, undefined);
  assert.equal((await f.call("learner-2", "/me/auditor")).currentLevel, "main");
});
