import { historicalContent } from "./historical-content.ts";
import { legacyPlanFixture } from "./legacy-plan-fixture.ts";
import { prerequisiteCertification } from "../src/auditor-pool.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { setup } from "./auditor-test-fixture.ts";
import { startInput } from "./auditor-fixture.ts";
import { migrateAuditorPool } from "../src/auditor-pool-migration.ts";
import { JsonStore } from "../src/storage.ts";
import { seedState } from "../src/seed.ts";
import { exportMaster, readMaster, contentHash } from "./legacy-master-data.ts";

async function status(
  f: Awaited<ReturnType<typeof setup>>,
  id: string,
  value: string,
  expected = 200,
) {
  const s = f.store.snapshot();
  return f.call(
    "admin-1",
    `/qualifications/${id}/lifecycle`,
    {
      revision: s.qualifications.find((q) => q.id === id)!.revision,
      stateRevision: s.revision,
      organizationRevision: f.store.organizations.snapshot().revision,
      status: value,
      reason: "운영 전환",
    },
    expected,
  );
}
async function template(
  f: Awaited<ReturnType<typeof setup>>,
  extra: object = {},
) {
  return f.call("operator-1", "/system/qualification-templates", {
    title: "풀 " + randomUUID(),
    englishName: "",
    qualificationType: "auditor",
    ...extra,
  });
}
async function register(
  f: Awaited<ReturnType<typeof setup>>,
  t: any,
  expected = 200,
) {
  return f.call(
    "admin-1",
    "/qualification-templates/import",
    { templateIds: [t.id], templateRevisions: { [t.id]: t.revision } },
    expected,
  );
}

test("등급·선행 기본자격 검증, Hold 등록, 등록 후 잠금, 동시 Active 충돌과 교체", async (t) => {
  const f = await setup(t),
    missing = await template(f);
  await register(f, missing, 409);
  const main = await template(f, { auditorLevel: "main" });
  await register(f, main, 409);
  await f.call(
    "operator-1",
    "/system/qualification-templates",
    {
      title: "잘못된 연결",
      englishName: "",
      qualificationType: "auditor",
      auditorLevel: "general",
      prerequisiteTemplateId: missing.id,
    },
    422,
  );
  const incompleteView = await template(f, { auditorLevel: "general" });
  await f.call(
    "admin-1",
    "/qualification-templates/import",
    { templateIds: [incompleteView.id] },
    409,
  );
  const general = await template(f, { auditorLevel: "general" }),
    r = await register(f, general),
    id = r.imported[0];
  assert.equal(
    f.store.snapshot().qualifications.find((q) => q.id === id)!.lifecycleStatus,
    "Hold",
  );
  assert.equal(
    f.store.snapshot().qualifications.find((q) => q.id === id)!.version,
    1,
  );
  await f.call(
    "operator-1",
    "/system/qualification-templates/" + general.id,
    {
      revision: general.revision,
      title: general.title,
      englishName: "",
      auditorLevel: "main",
    },
    409,
    "PUT",
  );
  await status(f, id, "Active", 409);
  const active = await f.program();
  await f.update((s) => {
    const source = s.qualifications.find((q) => q.id === active)!,
      q = s.qualifications.find((q) => q.id === id)!;
    q.courseIds = [...source.courseIds];
    q.validity = structuredClone(source.validity);
  });
  await status(f, id, "Active", 409);
  await status(f, active, "Hold");
  await status(f, id, "Active");
  await status(f, active, "Active", 409);
  const q = f.store.snapshot().qualifications.find((q) => q.id === id)!;
  await f.call(
    "admin-1",
    "/qualifications/" + id,
    {
      ...q,
      auditorCriteria: { level: "main", prerequisiteTemplateId: general.id },
    },
    422,
    "PUT",
  );
  const other = await template(f, { auditorLevel: "general" }),
    second = (await register(f, other)).imported[0];
  await f.update((s) => {
    const q = s.qualifications.find((q) => q.id === second)!;
    q.courseIds = [...s.qualifications.find((q) => q.id === id)!.courseIds];
    q.validity = { type: "unlimited", months: null, reminderDays: [] };
  });
  await status(f, id, "Hold");
  const before = f.store.snapshot(),
    body = (qid: string) => ({
      revision: before.qualifications.find((q) => q.id === qid)!.revision,
      stateRevision: before.revision,
      organizationRevision: f.store.organizations.snapshot().revision,
      status: "Active",
      reason: "동시 활성화",
    });
  const [a, b] = await Promise.all([
    f.call("admin-1", `/qualifications/${id}/lifecycle`, body(id)),
    f.call("admin-1", `/qualifications/${second}/lifecycle`, body(second), 409),
  ]);
  assert(a);
  assert(b);
});

test("정확한 일반 기본자격·현재 팀만 인정하며 다른 메인 이력으로 신규 선행 조건을 면제하지 않는다", async (t) => {
  const f = await setup(t),
    g = await f.program(),
    m = await f.program("main");
  await f.designate();
  const ga = await f.call(
    "learner-2",
    "/me/auditor/starts",
    startInput(f.store.snapshot(), "general"),
  );
  await f.complete(ga.assignmentId);
  const mainInput = startInput(f.store.snapshot(), "main"),
    ma = await f.call("learner-2", "/me/auditor/starts", mainInput);
  await f.complete(ma.assignmentId);
  await status(f, m, "Hold");
  const different = await template(f, { auditorLevel: "general" });
  const newMain = await template(f, {
    auditorLevel: "main",
    prerequisiteTemplateId: different.id,
  });
  const newid = (await register(f, newMain)).imported[0];
  await f.update((s) => {
    const q = s.qualifications.find((q) => q.id === newid)!,
      old = s.qualifications.find((q) => q.id === m)!;
    q.courseIds = [...old.courseIds];
    q.validity = structuredClone(old.validity);
  });
  await status(f, newid, "Active");
  const q = f.store.snapshot().qualifications.find((q) => q.id === newid)!;
  const body = {
    qualificationId: newid,
    qualificationRevision: q.revision,
    templateRevision: newMain.revision,
  };
  await f.call("learner-2", "/me/auditor/starts", body, 409);
  // Same exact predecessor from another team must not satisfy this team's initial main.
  const elsewhere = f.store.snapshot(),
    a = elsewhere.assignments.find((a) => a.id === ga.assignmentId)!;
  a.lv1OrganizationId = "org-etch";
  assert.equal(
    prerequisiteCertification(
      elsewhere,
      "learner-2",
      "org-photo",
      elsewhere.qualifications.find((q) => q.id === g)!.templateId,
      "2026-10-26T01:00:00.000Z",
    ),
    undefined,
  );
});

test("폐지 API·이전 등급 시작·대표 편집 입력은 권한 검사 후 410, 안내문 저장은 발송하지 않는다", async (t) => {
  const f = await setup(t);
  for (const [url, method] of [
    ["/auditor-program/qualifications", "POST"],
    ["/auditor-program/members", "GET"],
    ["/auditor-program/notices/send", "POST"],
  ]) {
    await f.call(
      "learner-2",
      url,
      method === "GET" ? undefined : {},
      403,
      method,
    );
    await f.call(
      "admin-1",
      url,
      method === "GET" ? undefined : {},
      410,
      method,
    );
  }
  await f.call("learner-2", "/me/auditor/starts", { level: "general" }, 410);
  await f.call(
    "admin-1",
    "/auditor-program",
    { revision: 0, titles: [], notice: { title: "", body: "", links: [] } },
    410,
    "PUT",
  );
  const body = {
      revision: 0,
      notice: { title: "안내", body: "본문", links: [] },
    },
    key = randomUUID();
  const saved = await f.call(
    "admin-1",
    "/auditor-program",
    body,
    200,
    "PUT",
    key,
  );
  assert.deepEqual(
    await f.call("admin-1", "/auditor-program", body, 200, "PUT", key),
    saved,
  );
  assert.equal(
    f.store
      .snapshot()
      .notifications.filter((n) => n.type === "auditor_designation").length,
    0,
  );
  assert.deepEqual(Object.keys(saved).sort(), ["program", "readiness"]);
});

test("23→24 명시 이관·JSON13 호환은 등급을 추정하지 않고 실패·재실행·기존 기록을 보존한다", async (t) => {
  const f = await setup(t),
    raw: any = seedState(true),
    org = f.store.organizations.snapshot();
  raw.schemaVersion = 23;
  legacyPlanFixture(raw);
  const old = structuredClone(raw),
    converted = migrateAuditorPool(raw, org);
  assert.equal(converted.state.schemaVersion, 26);
  assert.equal(converted.state.revision, old.revision + 3);
  const stripped: any = structuredClone(converted.state);
  stripped.schemaVersion = 23;
  stripped.revision -= 3;
  stripped.audits.splice(-3);
  assert.deepEqual(historicalContent(stripped), historicalContent(old));
  assert.deepEqual(
    migrateAuditorPool(converted.state, org).state,
    converted.state,
  );
  const master: any = exportMaster(
    converted.state,
    org,
    new Date().toISOString(),
  );
  master.formatVersion = 13;
  master.stateSchemaVersion = 23;
  master.sha256 = contentHash(master.payload);
  assert.equal(readMaster(master).formatVersion, 15);
  await f.app.close();
  await writeFile(f.file, JSON.stringify(raw));
  const files = [f.file, f.store.organizations.file, f.store.maintenanceFile],
    before = await Promise.all(files.map((x) => readFile(x))),
    hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const expected = {
    revision: raw.revision,
    stateHash: hash(before[0]!),
    organizationHash: hash(before[1]!),
  };
  await assert.rejects(new JsonStore(f.file).load());
  const broken = new JsonStore(f.file);
  broken.beforeReplace = () => {
    throw Error("failure");
  };
  await assert.rejects(
    broken.migratePolicies(expected, migrateAuditorPool, "auditor-pool"),
  );
  assert.deepEqual(await Promise.all(files.map((x) => readFile(x))), before);
  await new JsonStore(f.file).migratePolicies(
    expected,
    migrateAuditorPool,
    "auditor-pool",
  );
  const after = await Promise.all(files.map((x) => readFile(x)));
  await new JsonStore(f.file).migratePolicies(
    {
      ...expected,
      revision: JSON.parse(after[0]!.toString()).revision,
      stateHash: hash(after[0]!),
    },
    migrateAuditorPool,
    "auditor-pool",
  );
  assert.deepEqual(await Promise.all(files.map((x) => readFile(x))), after);
  assert.deepEqual(after[1], before[1]);
});

test("기존 미지정 등급은 모든 연결 버전 Hold 후 최초 보완하며 stale 등록과 파일 위장을 거부한다", async (t) => {
  const f = await setup(t),
    qId = await f.program();
  await f.update((s) => {
    const q = s.qualifications.find((q) => q.id === qId)!,
      base = s.qualificationTemplates.find((t) => t.id === q.templateId)!;
    delete q.auditorCriteria;
    delete base.auditorLevel;
  });
  const q = f.store.snapshot().qualifications.find((q) => q.id === qId)!,
    base = f.store
      .snapshot()
      .qualificationTemplates.find((t) => t.id === q.templateId)!;
  const input = {
    revision: base.revision,
    title: base.title,
    englishName: "",
    auditorLevel: "general",
  };
  await f.call(
    "operator-1",
    "/system/qualification-templates/" + base.id,
    input,
    409,
    "PUT",
  );
  await status(f, qId, "Hold");
  await f.call(
    "operator-1",
    "/system/qualification-templates/" + base.id,
    input,
    200,
    "PUT",
  );
  await status(f, qId, "Active");
  const pending = await template(f, { auditorLevel: "general" });
  await f.call(
    "operator-1",
    "/system/qualification-templates/" + pending.id,
    { revision: pending.revision, title: "변경됨", englishName: "" },
    200,
    "PUT",
  );
  await register(f, pending, 409);
  const current = exportMaster(
    f.store.snapshot(),
    f.store.organizations.snapshot(),
    new Date().toISOString(),
  );
  assert.deepEqual(readMaster(current).payload, current.payload);
  const fake: any = structuredClone(current);
  fake.formatVersion = 13;
  fake.stateSchemaVersion = 23;
  fake.sha256 = contentHash(fake.payload);
  assert.throws(() => readMaster(fake), /구형|Auditor/);
});
