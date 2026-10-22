import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  readdir,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import {
  type State,
  type CatalogWorkbook,
  catalogTables,
} from "@eks/contracts";
import { seedState } from "../src/seed.ts";
import { seedOrganizations } from "../src/organizations.ts";
import { preparePhotoSetup } from "../src/photo-setup.ts";
import {
  exportCatalog,
  prepareCatalog,
  saveCatalogBatch,
  publishCatalogBatch,
} from "../src/catalog.ts";
import {
  readCatalogWorkbook,
  writeCatalogWorkbook,
} from "../src/catalog-workbook.ts";
import { validateState } from "../src/integrity.ts";
import { migrateState } from "../src/migration.ts";
import { JsonStore } from "../src/storage.ts";
import { buildApp } from "../src/app.ts";
import {
  decorate,
  mergeVisible,
  duplicateRows,
  rowKey,
} from "../../frontend/src/catalog-editor.ts";
const org = seedOrganizations();
test("다른 개정 초안이 있어도 무변경 왕복은 허용하고 실제 변경은 차단한다", () => {
  const state = seedState(true),
    q = state.qualifications.find((q) => q.id === "demo-qualification")!;
  state.qualifications.push({
    ...structuredClone(q),
    id: "preserved-v2",
    parentId: q.id,
    version: 2,
    status: "draft",
    revision: 1,
  });
  const data = exportCatalog(state, "org-photo", [q.id]);
  const unchanged = prepareCatalog(state, data, "org-photo");
  assert.equal(unchanged.issues.length, 0);
  assert.equal(unchanged.changes[0]!.kind, "unchanged");
  data.sheets[0]!.title = "실제 변경";
  assert.ok(
    prepareCatalog(state, data, "org-photo").issues.some((i) =>
      i.message.includes("다른 초안"),
    ),
  );
});
test("사용자 양식 v3은 동일한 기준으로 왕복하며 연결 이름 변경은 ID를 유지한다", async () => {
  const s = photo(),
    data = workbook(s);
  for (const version of [3] as const) {
    const parsed = await readCatalogWorkbook(
      await writeCatalogWorkbook(data, [], version),
    );
    assert.deepEqual(parsed.workbook, data);
    assert.ok(
      prepareCatalog(s, parsed.workbook, "org-photo").changes.every(
        (c) => c.kind === "unchanged",
      ),
    );
  }
  const copiedTemplates = structuredClone(data);
  copiedTemplates.sheets = [0, 1].map((i) => ({
    ...structuredClone(data.sheets[0]!),
    mode: "new" as const,
    sourceId: "",
    sourceRevision: undefined,
    title: `신규 자격 ${i + 1}`,
  }));
  const generated = await readCatalogWorkbook(
    await writeCatalogWorkbook(copiedTemplates),
  );
  assert.deepEqual(generated.issues, []);
  assert.notEqual(
    generated.workbook.sheets[0]!.code,
    generated.workbook.sheets[1]!.code,
  );
  assert.equal(
    prepareCatalog(s, generated.workbook, "org-photo").changes.filter(
      (c) => c.kind === "new",
    ).length,
    2,
  );
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await writeCatalogWorkbook(data)) as any);
  const ws = book.worksheets[2]!;
  const ct = (ws.getTables() as any[]).find((t) =>
    t.name.startsWith("EKS_courses_"),
  ).table;
  const start = Number(/\d+/.exec(ct.tableRef)![0]),
    titleColumn = ct.columns.findIndex((c: any) => c.name === "인증Set명") + 1;
  ws.getCell(start + 1, titleColumn).value = "새 과정 이름";
  const p = await readCatalogWorkbook(
    Buffer.from(await book.xlsx.writeBuffer()),
  );
  assert.equal(
    p.workbook.sheets[0]!.tables.objective[0]!.courseCode,
    data.sheets[0]!.tables.courses[0]!.code,
  );
  assert.equal(
    p.workbook.sheets[0]!.tables.courses[0]!.sourceId,
    data.sheets[0]!.tables.courses[0]!.sourceId,
  );
  assert.deepEqual(p.issues, []);
  assert.ok(
    prepareCatalog(s, p.workbook, "org-photo").changes[0]!.details?.some(
      (d) => d.before === "대상 설비·구성 식별" && d.after === "새 과정 이름",
    ),
  );
});
test("부분 등록은 선택 자격만 원자적으로 처리하며 재시도와 최신 revision을 확인한다", () => {
  const s = photo(),
    data = workbook(s);
  data.sheets = data.sheets.slice(0, 2);
  data.sheets.forEach((q) => (q.description += " 개정"));
  const saved = saveCatalogBatch(s, data, "org-photo", "admin-1");
  assert.equal(saved.workbook.sheets.length, 2);
  assert.ok(saved.workbook.sheets.every((q) => q.sourceRevision === 1));
  const [a, b] = saved.qualificationIds;
  assert.ok(a && b);
  const result = publishCatalogBatch(s, saved.id, "org-photo", "admin-1", [a]);
  assert.equal(result.status, "partial");
  assert.equal(s.qualifications.find((q) => q.id === b)!.status, "draft");
  const auditCount = s.audits.length;
  publishCatalogBatch(s, saved.id, "org-photo", "admin-1", [a]);
  assert.equal(s.audits.length, auditCount);
  assert.throws(
    () => publishCatalogBatch(s, saved.id, "org-photo", "admin-1", ["foreign"]),
    /선택/,
  );
  s.qualifications.find((q) => q.id === b)!.revision++;
  assert.throws(
    () => publishCatalogBatch(s, saved.id, "org-photo", "admin-1", [b]),
    /변경/,
  );
  s.qualifications.find((q) => q.id === b)!.revision--;
  publishCatalogBatch(s, saved.id, "org-photo", "admin-1", [b]);
  assert.equal(s.catalogBatches.at(-1)!.status, "published");
  assert.equal(s.catalogBatches.at(-1)!.publicationResults!.length, 2);
  validateState(s, org);
});
test("과정 필터 편집은 숨은 행과 학습·평가를 유지하고 복제는 독립 연결을 만든다", () => {
  const w = decorate(workbook(photo())),
    q = w.sheets[0]!,
    before = structuredClone(q);
  const visible = [q.tables.courses[1]!],
    next = structuredClone(visible);
  next[0]!.title = "편집한 과정";
  q.tables.courses = mergeVisible(q.tables.courses, visible, next);
  assert.deepEqual(
    q.tables.courses.filter((_, i) => i !== 1),
    before.tables.courses.filter((_, i) => i !== 1),
  );
  assert.deepEqual(q.tables.objective, before.tables.objective);
  duplicateRows(q, "courses", [rowKey(q.tables.courses[1]!)]);
  const copy = q.tables.courses.at(-1)!;
  assert.notEqual(copy.code, q.tables.courses[1]!.code);
  assert.equal(copy.sourceId, "");
  assert.equal(
    q.tables.objective.filter((r) => r.courseCode === copy.code).length,
    3,
  );
});
function photo() {
  const s = seedState(true);
  s.qualifications.push({
    ...s.qualifications.find((q) => q.id === "demo-qualification")!,
    id: "bad-backup",
    entityId: "bad-backup",
    title: "설비 Backup 검증 자격",
    templateId: "eqp-backup",
    courseIds: ["recipe-create"],
  });
  return preparePhotoSetup(s, org, "operator-1", "2026-10-19T00:00:00.000Z")
    .state;
}
function workbook(s: State) {
  return exportCatalog(
    s,
    "org-photo",
    s.qualifications
      .filter(
        (q) => q.lv1OrganizationId === "org-photo" && q.status === "published",
      )
      .map((q) => q.id),
  );
}

test("Photo 15자격·75과정·450항목 XLSX 왕복은 값·순서·정답·기간 무변경, 5초 이내", async (t) => {
  const s = photo(),
    before = structuredClone(s),
    data = workbook(s),
    start = performance.now();
  const buffer = await writeCatalogWorkbook(data),
    parsed = await readCatalogWorkbook(buffer),
    preview = prepareCatalog(s, parsed.workbook, "org-photo");
  t.diagnostic(
    `XLSX ${buffer.length} bytes, write+parse+validate ${Math.round(performance.now() - start)}ms`,
  );
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(preview.issues, []);
  assert.ok(preview.changes.every((c) => c.kind === "unchanged"));
  assert.equal(preview.courses.length, 0);
  assert.equal(preview.qualifications.length, 0);
  assert.deepEqual(s, before);
  assert.deepEqual(parsed.workbook, data);
  const response = saveCatalogBatch(s, parsed.workbook, "org-photo", "admin-1");
  assert.equal(response.unchanged, true);
  assert.deepEqual(s, before);
  assert.ok(performance.now() - start < 5000);
});
test("완전 개정안의 과정·문항 제외는 새 버전에만 적용하고 자격별 수정은 독립적", () => {
  const s = photo(),
    before = structuredClone(s),
    data = workbook(s);
  data.sheets = data.sheets.slice(0, 2);
  const q = data.sheets[0]!,
    removedCode = q.tables.courses[4]!.code;
  for (const table of catalogTables)
    q.tables[table] = q.tables[table].filter(
      (r) => (table === "courses" ? r.code : r.courseCode) !== removedCode,
    );
  q.tables.objective.splice(0, 1);
  q.title += " 개정";
  const result = saveCatalogBatch(s, data, "org-photo", "operator-1");
  assert.equal(result.qualificationIds.length, 1);
  assert.equal(result.courseIds.length, 1);
  const revised = s.qualifications.find(
    (v) => v.id === result.qualificationIds[0],
  )!;
  assert.equal(revised.version, 2);
  assert.equal(revised.courseIds.length, 4);
  assert.equal(revised.status, "draft");
  assert.deepEqual(
    s.qualifications.filter((v) =>
      before.qualifications.some((q) => q.id === v.id),
    ),
    before.qualifications,
  );
  assert.deepEqual(
    s.courses.filter((v) => before.courses.some((c) => c.id === v.id)),
    before.courses,
  );
  publishCatalogBatch(s, result.id, "org-photo", "operator-1");
  assert.equal(
    s.qualifications.find((q) => q.id === revised.id)?.status,
    "published",
  );
  validateState(s, org);
  const copy = workbook(before);
  copy.sheets = [copy.sheets[0]!];
  copy.sheets[0]!.mode = "new";
  copy.sheets[0]!.code = "NEW-INDEPENDENT";
  const copied = saveCatalogBatch(s, copy, "org-photo", "operator-1");
  const other = s.qualifications.find(
    (q) => q.id === copied.qualificationIds[0],
  )!;
  assert.ok(
    other.courseIds.every((id) => !before.courses.some((c) => c.id === id)),
  );
});
test("초안 준비 부족과 구조 오류 구분, 중복 코드·참조·정답·원본 revision 차단", () => {
  const s = photo(),
    data = workbook(s);
  data.sheets = data.sheets.slice(0, 1);
  const q = data.sheets[0]!;
  q.description = "";
  let p = prepareCatalog(s, data, "org-photo");
  assert.ok(p.issues.some((i) => i.severity === "readiness"));
  assert.ok(!p.issues.some((i) => i.severity === "structure"));
  const result = saveCatalogBatch(s, data, "org-photo", "admin-1");
  const old = structuredClone(s);
  assert.throws(
    () => publishCatalogBatch(s, result.id, "org-photo", "admin-1"),
    /설명/,
  );
  assert.deepEqual(s.qualifications, old.qualifications);
  const broken = workbook(photo());
  broken.sheets = broken.sheets.slice(0, 1);
  const b = broken.sheets[0]!;
  b.tables.courses.push({ ...b.tables.courses[0]! });
  b.tables.objective[0]!.correct = 99;
  b.tables.practical[0]!.courseCode = "missing";
  const issues = prepareCatalog(photo(), broken, "org-photo").issues;
  assert.ok(issues.some((i) => i.column === "code"));
  assert.ok(issues.some((i) => i.column === "correct"));
  assert.ok(issues.some((i) => i.column === "courseCode"));
  b.sourceRevision = 999;
  assert.throws(
    () => saveCatalogBatch(photo(), broken, "org-photo", "admin-1"),
    /원본/,
  );
});
test("이름 있는 표: 시트 이름·행 위치·다섯 번째 선택지·한글 줄바꿈·수식 오류 셀", async () => {
  const s = photo(),
    data = workbook(s);
  data.sheets = data.sheets.slice(0, 1);
  data.sheets[0]!.tables.objective[0]!.choice5 = "추가 선택지\n두 번째 줄";
  const buffer = await writeCatalogWorkbook(data);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer as any);
  const ws = book.worksheets[2]!;
  ws.name = "이름을 바꾼 시트";
  const courses = (ws.getTables() as any[]).find((t) =>
    t.name.startsWith("EKS_courses_"),
  )!;
  const raw = (courses as any).table;
  const start = Number(/\d+/.exec(raw.tableRef)![0]);
  // Moving a table must not make the parser depend on its original fixed coordinates.
  const movedRows = Array.from({ length: 5 }, (_, i) =>
    Array.from(
      { length: raw.columns.length },
      (_, j) => ws.getCell(start + i + 1, j + 1).value,
    ),
  );
  ws.removeTable(courses.name);
  ws.addTable({
    ...raw,
    ref: `A${start + 150}`,
    headerRow: true,
    rows: movedRows,
  });
  const obj = (ws.getTables() as any[]).find((t) =>
    t.name.startsWith("EKS_objective_"),
  )!;
  const objStart = Number(/\d+/.exec((obj as any).table.tableRef)![0]);
  ws.getCell(objStart + 1, 6).value = { formula: "1+1", result: 2 };
  const parsed = await readCatalogWorkbook(
    Buffer.from(await book.xlsx.writeBuffer()),
  );
  assert.equal(parsed.workbook.sheets[0]!.sheetName, "이름을 바꾼 시트");
  assert.equal(parsed.workbook.sheets[0]!.tables.courses.length, 5);
  assert.equal(
    parsed.workbook.sheets[0]!.tables.objective[0]!.choice5,
    "추가 선택지\n두 번째 줄",
  );
  assert.ok(
    parsed.issues.some(
      (i) => i.cell === `F${objStart + 1}` && i.severity === "structure",
    ),
  );
  ws.removeTable(obj.name);
  const broken = Buffer.from(await book.xlsx.writeBuffer());
  await assert.rejects(() => readCatalogWorkbook(broken), /표가 없거나/);
});
async function fixture(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-catalog-")),
    file = path.join(dir, "runtime", "state.json");
  await new JsonStore(file).initialize(photo());
  const store = await new JsonStore(file).load(),
    app = await buildApp(store);
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const sessions = new Map<string, string>();
  const call = async (
    actor: string,
    url: string,
    body?: any,
    key = randomUUID(),
    status = 200,
    method?: "PUT",
  ) => {
    if (!sessions.has(actor)) {
      const login = await app.inject({
        method: "POST",
        url: "/api/session",
        payload: { actorId: actor },
      });
      sessions.set(
        actor,
        `${login.cookies[0]!.name}=${login.cookies[0]!.value}`,
      );
    }
    const r = await app.inject({
      method: method || (body === undefined ? "GET" : "POST"),
      url: `/api${url}`,
      headers: { cookie: sessions.get(actor)!, "idempotency-key": key },
      ...(body === undefined ? {} : { payload: body }),
    });
    assert.equal(r.statusCode, status, r.body);
    return r.json();
  };
  return { store, app, dir, file, call };
}
test("API 권한·Lv1 필수·구조 검사·중복 재시도·영구 백업·일괄 게시·최신 역할", async (t) => {
  const f = await fixture(t),
    data = workbook(f.store.snapshot());
  data.sheets = data.sheets.slice(0, 1);
  data.sheets[0]!.title += " 수정";
  const url = "/catalog/batches?lv1OrganizationId=org-photo";
  await f.call(
    "learner-1",
    "/catalog/batches/validate?lv1OrganizationId=org-photo",
    { workbook: data },
    undefined,
    403,
  );
  await f.call(
    "operator-1",
    "/catalog/batches",
    { workbook: data },
    undefined,
    403,
  );
  await f.call(
    "admin-1",
    "/catalog/batches?lv1OrganizationId=org-etch",
    { workbook: data },
    undefined,
    403,
  );
  const key = randomUUID(),
    result = await f.call("operator-1", url, { workbook: data }, key);
  assert.deepEqual(
    await f.call("operator-1", url, { workbook: data }, key),
    result,
  );
  assert.equal(f.store.snapshot().catalogBatches.length, 1);
  await f.call(
    "operator-1",
    "/catalog/batches?lv1OrganizationId=org-etch",
    { workbook: data },
    key,
    409,
  );
  assert.ok(
    (await readdir(f.store.backupDir)).some((n) =>
      n.startsWith("before-catalog-import-"),
    ),
  );
  await f.call(
    "operator-1",
    `/catalog/batches/${result.id}/publish?lv1OrganizationId=org-photo`,
    {},
  );
  assert.equal(f.store.snapshot().catalogBatches[0]!.status, "published");
  await f.store.transact(
    "operator-1",
    randomUUID(),
    "revoke",
    () => {},
    (s) => {
      s.users.find((u) => u.id === "admin-1")!.roles = ["learner"];
      return {};
    },
  );
  await f.call("admin-1", url, { workbook: data }, undefined, 403);
});
test("백업 실패·동시 변경·게시 실패에서 부분 저장이 없고 조직은 무변경", async (t) => {
  const f = await fixture(t),
    data = workbook(f.store.snapshot());
  data.sheets = data.sheets.slice(0, 2);
  data.sheets.forEach((q) => (q.title += " 변경"));
  const before = await readFile(f.file, "utf8"),
    orgBefore = await readFile(f.store.organizations.file, "utf8");
  f.store.beforeReplace = () => {
    throw new Error("write failure");
  };
  await f.call(
    "admin-1",
    "/catalog/batches",
    { workbook: data },
    undefined,
    503,
  );
  assert.equal(await readFile(f.file, "utf8"), before);
  f.store.beforeReplace = undefined;
  data.sheets[1]!.sourceRevision = 999;
  await f.call(
    "admin-1",
    "/catalog/batches",
    { workbook: data },
    undefined,
    409,
  );
  assert.equal(await readFile(f.file, "utf8"), before);
  data.sheets[1]!.sourceRevision = 1;
  data.sheets[1]!.description = "";
  const result = await f.call("admin-1", "/catalog/batches", {
    workbook: data,
  });
  const saved = await readFile(f.file, "utf8");
  await f.call(
    "admin-1",
    `/catalog/batches/${result.id}/publish`,
    {},
    undefined,
    422,
  );
  assert.equal(await readFile(f.file, "utf8"), saved);
  assert.equal(await readFile(f.store.organizations.file, "utf8"), orgBefore);
});
test("10,000 평가 행 상한·숫자/0 구분·메타정보 오류 위치", () => {
  const s = photo(),
    data = workbook(s);
  data.sheets = data.sheets.slice(0, 1);
  const sheet = data.sheets[0]!;
  sheet.mode = "new";
  sheet.code = "LARGE";
  const c = sheet.tables.courses[0]!,
    question = sheet.tables.objective[0]!;
  sheet.tables.courses = Array.from({ length: 20 }, (_, i) => ({
    ...c,
    code: `C${i}`,
    order: i + 1,
    sourceId: "",
    sourceRevision: null,
    kinds: "objective",
  }));
  sheet.tables.learning = sheet.tables.courses.map((c) => ({
    courseCode: c.code,
    code: "L1",
    order: 1,
    type: "ojt",
    title: "학습",
    required: true,
  }));
  sheet.tables.materials = [];
  sheet.tables.practical = [];
  sheet.tables.objective = sheet.tables.courses.flatMap((c) =>
    Array.from({ length: 500 }, (_, i) => ({
      ...question,
      courseCode: c.code,
      code: `Q${i}`,
      order: i + 1,
    })),
  );
  const at = performance.now(),
    p = prepareCatalog(s, data, "org-photo");
  assert.equal(p.issues.length, 0);
  assert.equal(p.courses.length, 20);
  assert.equal(
    p.courses.reduce((n, c) => n + c.questions.length, 0),
    10000,
  );
  sheet.tables.objective.push({ ...question, code: "over" });
  assert.throws(() => prepareCatalog(s, data, "org-photo"), /10,000/);
  sheet.tables.objective.pop();
  sheet.months = 0;
  const issues = prepareCatalog(s, data, "org-photo").issues;
  assert.ok(
    issues.some((i) => i.table === "metadata" && i.column === "months"),
  );
  assert.ok(performance.now() - at < 5000);
});
test("사전 백업 생성 실패는 업무 파일을 변경하지 않는다", async (t) => {
  const f = await fixture(t),
    data = workbook(f.store.snapshot());
  data.sheets = data.sheets.slice(0, 1);
  data.sheets[0]!.title += " 변경";
  const before = await readFile(f.file, "utf8");
  const old = f.store.backupDir;
  (f.store as any).backupDir = path.join(f.dir, "blocked-backup");
  await writeFile(f.store.backupDir, "not a directory");
  await f.call(
    "admin-1",
    "/catalog/batches",
    { workbook: data },
    undefined,
    503,
  );
  assert.equal(await readFile(f.file, "utf8"), before);
  (f.store as any).backupDir = old;
});
test("미변경 기존 초안도 버전 추가 없이 일괄 등록하고 개별 편집의 다른 자격 과정은 독립 복제한다", async (t) => {
  const f = await fixture(t),
    data = workbook(f.store.snapshot());
  data.sheets = data.sheets.slice(0, 1);
  data.sheets[0]!.title += " 준비";
  const result = await f.call("admin-1", "/catalog/batches", {
    workbook: data,
  });
  const draftExport = exportCatalog(
    f.store.snapshot(),
    "org-photo",
    result.qualificationIds,
  );
  const second = await f.call("admin-1", "/catalog/batches", {
    workbook: draftExport,
  });
  assert.deepEqual(second.qualificationIds, result.qualificationIds);
  assert.equal(
    f.store
      .snapshot()
      .qualifications.filter((q) => q.title === data.sheets[0]!.title).length,
    1,
  );
  await f.call("admin-1", `/catalog/batches/${second.id}/publish`, {});
  const q = await f.call("admin-1", "/qualifications", {}),
    original = f.store.snapshot().courses[0]!;
  await f.call(
    "admin-1",
    `/qualifications/${q.id}`,
    {
      ...f.store.snapshot().qualifications.find((v) => v.id === q.id),
      title: "독립 연결",
      courseIds: [original.id],
    },
    undefined,
    200,
    "PUT",
  );
  const copied = f.store.snapshot().qualifications.find((v) => v.id === q.id)!
    .courseIds[0]!;
  assert.notEqual(copied, original.id);
  assert.notEqual(
    f.store.snapshot().courses.find((c) => c.id === copied)!.entityId,
    original.entityId,
  );
});
