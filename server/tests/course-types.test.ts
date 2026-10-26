import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { seedState } from "../src/seed.ts";
import { seedOrganizations } from "../src/organizations.ts";
import { JsonStore } from "../src/storage.ts";
import { buildApp } from "../src/app.ts";
import { courseTypeEditing } from "../src/course-types.ts";
import { migrateCourseTypes } from "../src/course-type-migration.ts";
import { validateState } from "../src/integrity.ts";
import {
  exportCatalog,
  prepareCatalog,
  saveCatalogBatch,
} from "../src/catalog.ts";
import { exportMaster, readMaster, contentHash } from "../src/master-data.ts";
import {
  readCatalogWorkbook,
  writeCatalogWorkbook,
} from "../src/catalog-workbook.ts";
import { addQualification } from "./dashboard-fixtures.ts";
async function fixture(
  t: TestContext,
  prepare?: (s: ReturnType<typeof seedState>) => void,
) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-template-")),
    file = path.join(dir, "runtime/state.json"),
    seed = seedState(true);
  seed.users.push({
    id: "detail",
    name: "세부 관리자",
    organizationId: "org-photo",
    roles: ["learner"],
    revision: 1,
    organizationAdministration: {
      organizationId: "org-photo",
      grantedBy: "admin-1",
      grantedAt: "2026-10-23T00:00:00.000Z",
    },
  });
  prepare?.(seed);
  await new JsonStore(file).initialize(seed);
  const store = await new JsonStore(file).load(),
    app = await buildApp(store),
    cookies = new Map<string, string>();
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  async function call(
    actor: string,
    url: string,
    body?: any,
    status: number | number[] = 200,
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
    assert(
      (Array.isArray(status) ? status : [status]).includes(r.statusCode),
      `${r.statusCode}: ${r.body}`,
    );
    return r.json();
  }
  return { store, app, call, file };
}
async function auditorQualification(f: Awaited<ReturnType<typeof fixture>>) {
  const template = await f.call(
    "operator-1",
    "/system/qualification-templates",
    {
      title: "Auditor 기준",
      englishName: "Auditor",
      description: "시험",
      qualificationType: "auditor",
    },
  );
  const r = await f.call("admin-1", "/qualification-templates/import", {
    templateIds: [template.id],
  });
  return f.store.snapshot().qualifications.find((q) => q.id === r.imported[0])!;
}
test("인증Set 생성 유형·권한·입력 검증과 미사용 첫 버전의 유형 변경·기존 호출 보존", async (t) => {
  const f = await fixture(t);
  await f.call(
    "learner-1",
    "/courses",
    { title: "권한 없음", qualificationType: "auditor" },
    403,
  );
  await f.call(
    "admin-1",
    "/courses",
    { title: "  ", qualificationType: "auditor" },
    422,
  );
  await f.call(
    "admin-1",
    "/courses",
    { title: "잘못된 유형", qualificationType: "other" },
    422,
  );
  const r = await f.call("admin-1", "/courses", {
    title: "새 인증Set",
    qualificationType: "auditor",
  });
  let c = f.store.snapshot().courses.find((c) => c.id === r.id)!;
  assert.equal(c.qualificationType, "auditor");
  assert.equal(courseTypeEditing(f.store.snapshot(), c).canChangeType, true);
  let preview = await f.call("admin-1", `/courses/${c.id}/save-preview`, {
    ...c,
    qualificationType: "auditee",
  });
  assert.equal(preview.newVersion, false);
  assert(
    preview.changes.some(
      (x: any) =>
        x.label === "인증 유형" &&
        x.before === "Auditor" &&
        x.after === "Auditee",
    ),
  );
  const key = randomUUID(),
    body = {
      ...c,
      qualificationType: "auditee",
      stateRevision: preview.stateRevision,
      organizationRevision: preview.organizationRevision,
    };
  const result = await f.call(
    "admin-1",
    `/courses/${c.id}`,
    body,
    200,
    "PUT",
    key,
  );
  assert.deepEqual(
    await f.call("admin-1", `/courses/${c.id}`, body, 200, "PUT", key),
    result,
  );
  c = f.store.snapshot().courses.find((c) => c.id === r.id)!;
  assert.equal(c.qualificationType, "auditee");
  assert.equal(c.version, 1);
  assert.equal(c.revision, 2);
  const legacy: any = { ...c, title: "기존 호출" };
  delete legacy.qualificationType;
  await f.call("admin-1", `/courses/${c.id}`, legacy, 200, "PUT");
  assert.equal(
    f.store.snapshot().courses.find((x) => x.id === c.id)!.qualificationType,
    "auditee",
  );
  const w = await f.call("admin-1", "/workspace");
  assert.equal(
    w.courses.find((x: any) => x.id === c.id).typeEditing.canChangeType,
    true,
  );
  assert(
    !("typeEditing" in f.store.snapshot().courses.find((x) => x.id === c.id)!),
  );
});
test("같은 유형만 자격에 연결하며 연결·삭제·버전 이력 이후 유형 변경은 차단한다", async (t) => {
  const f = await fixture(t),
    q = await auditorQualification(f);
  await f.call(
    "admin-1",
    `/qualifications/${q.id}`,
    { ...q, courseIds: ["demo-course-1"] },
    422,
    "PUT",
  );
  const created = await f.call("admin-1", "/courses", {
    title: "Auditor 전용",
    qualificationType: "auditor",
  });
  const c = f.store.snapshot().courses.find((x) => x.id === created.id)!;
  await f.call(
    "admin-1",
    `/qualifications/${q.id}`,
    { ...q, courseIds: [c.id] },
    200,
    "PUT",
  );
  await f.call(
    "admin-1",
    `/courses/${c.id}/save-preview`,
    { ...c, qualificationType: "auditee" },
    409,
  );
  await f.call(
    "admin-1",
    `/courses/${c.id}`,
    { ...c, qualificationType: "auditee" },
    409,
    "PUT",
  );
  const saved = await f.call(
    "admin-1",
    `/courses/${c.id}`,
    { ...c, title: "버전 수정" },
    200,
    "PUT",
  );
  assert.equal(saved.version, 2);
  assert.equal(
    f.store.snapshot().courses.find((x) => x.id === saved.id)!
      .qualificationType,
    "auditor",
  );
  await f.call(
    "admin-1",
    `/courses/${saved.id}`,
    {
      ...f.store.snapshot().courses.find((x) => x.id === saved.id),
      qualificationType: "auditee",
    },
    409,
    "PUT",
  );
  const snapshot = f.store.snapshot();
  for (const item of snapshot.qualifications.filter((x) =>
    x.courseIds.includes(c.id),
  ))
    item.deletedAt = new Date().toISOString();
  assert.equal(courseTypeEditing(snapshot, c).canChangeType, false);
});
test("유형 변경 검토 뒤 자격 연결 또는 동시 수정이 생기면 저장을 보류한다", async (t) => {
  const f = await fixture(t),
    created = await f.call("admin-1", "/courses", { title: "경합 대상" });
  const c = f.store.snapshot().courses.find((x) => x.id === created.id)!,
    q = f.store.snapshot().qualifications[0]!;
  const preview = await f.call("admin-1", `/courses/${c.id}/save-preview`, {
    ...c,
    qualificationType: "auditor",
  });
  await f.call(
    "admin-1",
    `/qualifications/${q.id}`,
    { ...q, courseIds: [...q.courseIds, c.id] },
    200,
    "PUT",
  );
  const before = await readFile(f.file, "utf8");
  await f.call(
    "admin-1",
    `/courses/${c.id}`,
    {
      ...c,
      qualificationType: "auditor",
      stateRevision: preview.stateRevision,
      organizationRevision: preview.organizationRevision,
    },
    409,
    "PUT",
  );
  assert.equal(await readFile(f.file, "utf8"), before);
  await f.call(
    "admin-1",
    `/courses/${c.id}`,
    { ...c, revision: 0, title: "경합" },
    409,
    "PUT",
  );
});
test("Excel v9 유형 보존·읽기 전용 검토와 구형 새 행 상속·다른 유형 연결 차단", async (t) => {
  const f = await fixture(t),
    q = await auditorQualification(f),
    s = f.store.snapshot();
  const book = exportCatalog(s, "org-photo", [q.id]);
  book.sheets[0]!.tables.courses.push({
    code: "new-auditor",
    title: "심사 준비",
    order: 1,
    kinds: "",
    sourceId: "",
    sourceRevision: null,
    passScore: null,
    practicalPassScore: null,
  });
  book.format = "eks-catalog-v8";
  const p = prepareCatalog(s, book, "org-photo");
  assert(!p.issues.some((x) => x.severity === "structure"));
  assert.equal(
    p.workbook.sheets[0]!.tables.courses[0]!.qualificationType,
    "auditor",
  );
  await f.store.transact(
    "admin-1",
    randomUUID(),
    "new auditor bulk",
    () => {},
    (state) =>
      saveCatalogBatch(
        state,
        book,
        "org-photo",
        "admin-1",
        undefined,
        f.store.organizations.snapshot(),
      ),
  );
  const now = f.store.snapshot(),
    updated = now.qualifications
      .filter((x) => x.entityId === q.entityId)
      .sort((a, b) => b.version - a.version)[0]!;
  const exported = exportCatalog(now, "org-photo", [updated.id]);
  assert.equal(exported.format, "eks-catalog-v11");
  assert.deepEqual(
    (await readCatalogWorkbook(await writeCatalogWorkbook(exported))).workbook,
    exported,
  );
  const altered = structuredClone(exported);
  altered.sheets[0]!.tables.courses[0]!.qualificationType = "auditee";
  assert(
    prepareCatalog(now, altered, "org-photo").issues.some(
      (x) => x.column === "qualificationType" && x.severity === "structure",
    ),
  );
  const crossed = structuredClone(exported),
    source = now.courses.find((c) => c.id === "demo-course-1")!;
  Object.assign(crossed.sheets[0]!.tables.courses[0]!, {
    sourceId: source.id,
    sourceRevision: source.revision,
    qualificationType: "auditee",
  });
  assert(
    prepareCatalog(now, crossed, "org-photo").issues.some(
      (x) => x.column === "qualificationType" && x.severity === "structure",
    ),
  );
});
test("14→15은 모든 버전·삭제 자격·과거 계획 근거로 계보를 분류하고 혼합 계보는 보류한다", () => {
  const state = seedState(true),
    org = seedOrganizations();
  const q = addQualification({ state, orgs: org }, "auditor-history", {
    qualificationType: "auditor",
  });
  q.deletedAt = new Date().toISOString();
  q.deletedBy = "admin-1";
  q.deletionReason = "시험";
  const c = state.courses.find((c) => c.id === q.courseIds[0])!;
  state.courses.push({
    ...structuredClone(c),
    id: "future-version",
    version: 2,
    parentId: c.id,
  });
  const unused = {
    ...structuredClone(c),
    id: "unused",
    entityId: "unused",
    parentId: undefined,
    version: 1,
  };
  state.courses.push(unused);
  const raw: any = structuredClone(state);
  raw.schemaVersion = 14;
  raw.courses.forEach((c: any) => delete c.qualificationType);
  const before = structuredClone(raw),
    result = migrateCourseTypes(raw, org);
  assert.deepEqual(raw, before);
  assert.equal(result.state.schemaVersion, 18);
  for (const id of [c.id, "future-version"])
    assert.equal(
      result.state.courses.find((c) => c.id === id)!.qualificationType,
      "auditor",
    );
  assert.equal(
    result.state.courses.find((c) => c.id === "unused")!.qualificationType,
    "auditee",
  );
  const stripped: any = structuredClone(result.state);
  stripped.schemaVersion = 14;
  stripped.revision -= 4;
  stripped.audits.splice(-4);
  stripped.qualificationTemplates.forEach((t: any) => delete t.scope);
  stripped.courses.forEach((c: any) => delete c.qualificationType);
  assert.deepEqual(stripped, raw);
  assert.deepEqual(migrateCourseTypes(result.state, org).state, result.state);
  const mixed = structuredClone(raw);
  mixed.qualifications
    .find((x: any) => x.id === "demo-qualification")
    .courseIds.push(c.id);
  assert.throws(() => migrateCourseTypes(mixed, org), /함께 연결/);
  const bad: any = structuredClone(result.state);
  bad.courses.find((x: any) => x.id === "future-version").qualificationType =
    "auditee";
  assert.throws(() => validateState(bad, org), /계보 유형 불일치/);
  delete bad.courses[0].qualificationType;
  assert.throws(() => validateState(bad, org), /인증 유형 누락/);
});
test("인증Set 유형 이관 실패는 파일 쌍을 보존하고 백업·재시작·재실행과 기본정보4/5를 지원한다", async (t) => {
  const f = await fixture(t),
    raw: any = f.store.snapshot();
  await f.app.close();
  raw.schemaVersion = 14;
  raw.courses.forEach((c: any) => delete c.qualificationType);
  await writeFile(f.file, JSON.stringify(raw));
  const before = await readFile(f.file),
    org = await readFile(f.store.organizations.file),
    hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const expected = {
    revision: raw.revision,
    stateHash: hash(before),
    organizationHash: hash(org),
  };
  const disk = new JsonStore(f.file);
  disk.beforeReplace = () => {
    throw new Error("migration interrupted");
  };
  await assert.rejects(
    disk.migratePolicies(expected, migrateCourseTypes, "course-types"),
    /interrupted/,
  );
  assert.deepEqual(await readFile(f.file), before);
  assert.deepEqual(await readFile(disk.organizations.file), org);
  disk.beforeReplace = undefined;
  const result: any = await disk.migratePolicies(
    expected,
    migrateCourseTypes,
    "course-types",
  );
  assert.deepEqual(await readFile(result.stateBackup), before);
  const after = await readFile(f.file);
  await disk.migratePolicies(
    { ...expected, revision: raw.revision + 4, stateHash: hash(after) },
    migrateCourseTypes,
    "course-types",
  );
  assert.deepEqual(await readFile(f.file), after);
  const restarted = await new JsonStore(f.file).load();
  const file = exportMaster(
    restarted.snapshot(),
    restarted.organizations.snapshot(),
    new Date().toISOString(),
  );
  assert.equal(file.formatVersion, 8);
  assert.equal(file.stateSchemaVersion, 18);
  assert.deepEqual(readMaster(file).payload, file.payload);
  const old: any = structuredClone(file);
  old.formatVersion = 4;
  old.organizationSchemaVersion = 2;
  old.payload.organizations.qualificationPools = [];
  old.counts.poolEntries = 0;
  old.stateSchemaVersion = 14;
  old.payload.courses.forEach((c: any) => delete c.qualificationType);
  old.sha256 = contentHash(old.payload);
  assert.deepEqual(readMaster(old).payload, file.payload);
  const missing: any = structuredClone(file);
  delete missing.payload.courses[0].qualificationType;
  missing.sha256 = contentHash(missing.payload);
  assert.throws(() => readMaster(missing), /인증 유형이 누락/);
  await restarted.close();
});

test("팀 등록의 기대 유형이 바뀌거나 혼합되면 전체 등록을 보류한다", async (t) => {
  const f = await fixture(t);
  const template = await f.call(
    "operator-1",
    "/system/qualification-templates",
    { title: "등록 대기", englishName: "", description: "" },
  );
  await f.call(
    "operator-1",
    `/system/qualification-templates/${template.id}`,
    {
      title: template.title,
      englishName: template.englishName,
      description: template.description,
      revision: template.revision,
      qualificationType: "auditor",
    },
    200,
    "PUT",
  );
  const before = await readFile(f.file, "utf8");
  const result = await f.call(
    "admin-1",
    "/qualification-templates/import",
    { templateIds: [template.id], qualificationType: "auditee" },
    409,
  );
  assert.equal(result.code, "QUALIFICATION_TYPE_CHANGED");
  assert.equal(await readFile(f.file, "utf8"), before);
  await f.call("admin-1", "/qualification-templates/import", {
    templateIds: [template.id],
    qualificationType: "auditor",
  });
});
