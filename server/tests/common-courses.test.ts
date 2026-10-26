import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CourseContentSchema, qualificationUseErrors } from "@eks/contracts";
import { seedState } from "../src/seed.ts";
import { JsonStore } from "../src/storage.ts";
import { buildApp } from "../src/app.ts";
import {
  courseContentHash,
  teamCourseModified,
} from "../src/common-courses.ts";
import {
  exportMaster,
  readMaster,
  masterCandidate,
} from "../src/master-data.ts";
import { migrateCommonCourses } from "../src/common-course-migration.ts";
import { validateState } from "../src/integrity.ts";
async function fixture(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-common-")),
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
  async function common(type: "auditee" | "auditor" = "auditee") {
    const content = CourseContentSchema.parse(seedState(true).courses[0]);
    content.title = "공통 교육 " + randomUUID();
    if (type === "auditor") {
      content.qualificationType = "auditor";
      content.assessmentKinds = [];
      content.questions = [];
      content.practicalQuestions = [];
      content.passScore = null;
      content.practicalPassScore = null;
    }
    return call("operator-1", "/system/common-courses", content);
  }
  async function template(c: any) {
    return call("operator-1", "/system/qualification-templates", {
      title: "기본자격 " + randomUUID(),
      englishName: "",
      qualificationType: c.qualificationType,
      defaultCommonCourseIds: [c.id],
      commonCourseRevisions: { [c.id]: c.revision },
    });
  }
  async function register(base: any, c: any, team = "org-photo") {
    const result = await call(
      "operator-1",
      `/qualification-templates/import?lv1OrganizationId=${team}`,
      {
        templateIds: [base.id],
        qualificationType: base.qualificationType,
        templateRevisions: { [base.id]: base.revision },
        commonCourseRevisions: { [c.id]: c.revision },
      },
    );
    return store
      .snapshot()
      .qualifications.find((q) => q.id === result.imported[0])!;
  }
  return { call, common, template, register, store, file };
}
test("공통 원본 권한·유형·기본 목록 수정 확인과 사용 이력 잠금", async (t) => {
  const f = await fixture(t),
    c = await f.common();
  const body = CourseContentSchema.parse(c);
  for (const actor of ["admin-1", "learner-1"])
    await f.call(actor, "/system/common-courses", body, 403);
  await f.call(
    "operator-1",
    "/system/qualification-templates",
    { title: "잘못된 목록", englishName: "", defaultCommonCourseIds: [c.id] },
    409,
  );
  await f.call(
    "operator-1",
    "/system/qualification-templates",
    {
      title: "유형 불일치",
      englishName: "",
      qualificationType: "auditor",
      defaultCommonCourseIds: [c.id],
      commonCourseRevisions: { [c.id]: c.revision },
    },
    422,
  );
  const base = await f.template(c);
  await f.call(
    "operator-1",
    `/system/common-courses/${c.id}/retire`,
    { revision: c.revision, reason: "사용 중 종료" },
    409,
  );
  const other = {
    ...body,
    qualificationType: "auditor",
    assessmentKinds: [],
    passScore: null,
    practicalPassScore: null,
    questions: [],
    practicalQuestions: [],
  };
  await f.call(
    "operator-1",
    `/system/common-courses/${c.id}`,
    { ...other, revision: c.revision },
    409,
    "PUT",
  );
  await f.call(
    "operator-1",
    `/system/qualification-templates/${base.id}`,
    {
      title: base.title,
      englishName: "",
      revision: base.revision,
      defaultCommonCourseIds: [],
    },
    200,
    "PUT",
  );
  const retired = await f.call(
    "operator-1",
    `/system/common-courses/${c.id}/retire`,
    { revision: c.revision, reason: "목록 해제 후 종료" },
  );
  await f.call(
    "operator-1",
    `/system/common-courses/${c.id}`,
    { ...body, revision: retired.revision },
    409,
    "PUT",
  );
  await f.call("operator-1", `/system/common-courses/${c.id}/restore`, {
    revision: retired.revision,
    reason: "재사용",
  });
});
test("등록은 독립 사본·고정 선택 범위를 생성하고 원본 변경은 이후 신규 등록에만 반영한다", async (t) => {
  const f = await fixture(t),
    c = await f.common(),
    base = await f.template(c),
    q = await f.register(base, c);
  assert.equal(q.version, null);
  assert.equal(q.lifecycleStatus, "Ready");
  assert.equal(q.courseIds.length, 1);
  const copied = f.store
    .snapshot()
    .courses.find((x) => x.id === q.courseIds[0])!;
  assert.equal(copied.category, "common");
  assert.notEqual(copied.learningItems[0]?.id, c.learningItems[0]?.id);
  assert.equal(teamCourseModified(copied), false);
  const next = await f.call(
    "operator-1",
    `/system/common-courses/${c.id}`,
    {
      ...CourseContentSchema.parse(c),
      title: "변경된 공통",
      revision: c.revision,
    },
    200,
    "PUT",
  );
  await f.call(
    "operator-1",
    "/qualification-templates/import?lv1OrganizationId=org-etch",
    {
      templateIds: [base.id],
      templateRevisions: { [base.id]: base.revision },
      commonCourseRevisions: { [c.id]: c.revision },
    },
    409,
  );
  const q2 = await f.register(base, next, "org-etch"),
    copy2 = f.store.snapshot().courses.find((x) => x.id === q2.courseIds[0])!;
  assert.equal(copy2.title, "변경된 공통");
  assert.equal(
    f.store.snapshot().courses.find((x) => x.id === copied.id)!.title,
    c.title,
  );
  assert.notEqual(copy2.entityId, copied.entityId);
  await f.call(
    "admin-1",
    `/qualifications/${q.id}`,
    { ...q, courseIds: [copy2.id] },
    422,
    "PUT",
  );
  const options = await f.call(
    "admin-1",
    `/qualifications/${q.id}/common-course-options`,
  );
  assert.equal(options.length, 1);
});
test("공통 기본값의 Ready 무변경 저장·명시 최초 확정·제외/재포함은 이력을 보존한다", async (t) => {
  const f = await fixture(t),
    c = await f.common(),
    base = await f.template(c);
  let q = await f.register(base, c);
  const no = await f.call("admin-1", `/qualifications/${q.id}`, q, 200, "PUT");
  assert.equal(no.unchanged, true);
  assert.equal(no.version, null);
  const preview = await f.call(
    "admin-1",
    `/qualifications/${q.id}/save-preview`,
    { ...q, confirmInitialConfiguration: true },
  );
  assert.equal(preview.initialConfiguration, true);
  const saved = await f.call(
    "admin-1",
    `/qualifications/${q.id}`,
    {
      ...q,
      confirmInitialConfiguration: true,
      validity: { type: "unlimited", months: null, reminderDays: [] },
    },
    200,
    "PUT",
  );
  assert.equal(saved.id, q.id);
  assert.equal(saved.version, 1);
  q = f.store.snapshot().qualifications.find((x) => x.id === q.id)!;
  const removed = await f.call(
    "admin-1",
    `/qualifications/${q.id}`,
    { ...q, courseIds: [] },
    200,
    "PUT",
  );
  assert.equal(removed.newVersion, true);
  const next = f.store
    .snapshot()
    .qualifications.find((x) => x.id === removed.id)!;
  await f.call(
    "admin-1",
    `/qualifications/${next.id}`,
    { ...next, courseIds: q.courseIds },
    200,
    "PUT",
  );
  assert.deepEqual(
    f.store.snapshot().qualifications.find((x) => x.id === q.id)!.courseIds,
    q.courseIds,
  );
  assert.deepEqual(
    f.store.snapshot().qualifications.find((x) => x.id === next.id)!
      .commonCourseEntityIds,
    q.commonCourseEntityIds,
  );
});
test("팀 수정은 공통 구분·출처를 유지하고 위조와 다른 자격의 공통 연결을 차단한다", async (t) => {
  const f = await fixture(t),
    c = await f.common(),
    base = await f.template(c),
    q = await f.register(base, c);
  const copy = f.store.snapshot().courses.find((x) => x.id === q.courseIds[0])!;
  await f.call(
    "admin-1",
    `/courses/${copy.id}`,
    { ...copy, category: "specialized" },
    422,
    "PUT",
  );
  await f.call(
    "admin-1",
    `/qualifications/${q.id}`,
    { ...q, commonCourseEntityIds: [] },
    422,
    "PUT",
  );
  const edited = await f.call(
    "admin-1",
    `/courses/${copy.id}`,
    { ...copy, title: "팀에서 수정한 공통" },
    200,
    "PUT",
  );
  assert.equal(edited.newVersion, true);
  const changed = f.store.snapshot().courses.find((x) => x.id === edited.id)!;
  assert.equal(changed.category, "common");
  assert.equal(teamCourseModified(changed), true);
  const restored = await f.call(
    "admin-1",
    `/courses/${changed.id}`,
    { ...changed, title: copy.title },
    200,
    "PUT",
  );
  assert.equal(
    teamCourseModified(
      f.store.snapshot().courses.find((x) => x.id === restored.id)!,
    ),
    false,
  );
  const otherBase = await f.template(c),
    other = await f.register(otherBase, c);
  await f.call(
    "admin-1",
    `/qualifications/${other.id}`,
    { ...other, courseIds: [copy.id] },
    422,
    "PUT",
  );
});
test("JSON10 왕복은 공통·특화·선택 범위와 무변경 Ready를 보존한다", async (t) => {
  const f = await fixture(t),
    c = await f.common(),
    base = await f.template(c),
    q = await f.register(base, c),
    before = await readFile(f.file, "utf8");
  const m = exportMaster(
    f.store.snapshot(),
    f.store.organizations.snapshot(),
    new Date().toISOString(),
  );
  assert.equal(m.formatVersion, 13);
  assert.deepEqual(readMaster(m).payload, m.payload);
  const candidate = masterCandidate(readMaster(m).payload, 0, 0);
  assert.deepEqual(candidate.state.commonCourses, m.payload.commonCourses);
  assert.deepEqual(
    candidate.state.qualifications.find((x) => x.id === q.id)!
      .commonCourseEntityIds,
    q.commonCourseEntityIds,
  );
  assert.equal(await readFile(f.file, "utf8"), before);
});
test("업무19→20 명시 이관은 기존 기준·업무·조직을 보존하고 반복 실행은 무변경이다", async (t) => {
  const f = await fixture(t),
    old: any = structuredClone(f.store.snapshot());
  old.schemaVersion = 19;
  delete old.commonCourses;
  for (const c of old.courses) delete c.category;
  for (const q of old.qualifications) delete q.commonCourseEntityIds;
  for (const x of old.qualificationTemplates) delete x.defaultCommonCourseIds;
  const before = structuredClone(old),
    org = f.store.organizations.snapshot(),
    r = migrateCommonCourses(old, org);
  assert.equal(r.state.schemaVersion, 23);
  assert.equal(r.state.revision, old.revision + 4);
  assert.deepEqual(r.organizations, org);
  for (const key of [
    "users",
    "plans",
    "assignments",
    "enrollments",
    "attempts",
    "completions",
    "certifications",
    "requests",
  ] as const)
    assert.deepEqual(r.state[key], before[key]);
  assert.ok(r.state.courses.every((c) => c.category === "specialized"));
  assert.ok(
    r.state.qualifications.every((q) => !q.commonCourseEntityIds.length),
  );
  assert.deepEqual(migrateCommonCourses(r.state, org).state, r.state);
  assert.throws(() => validateState(old, org));
});
test("Auditor 공통도 학습 확인 기준을 복사하고 유형 잠금·기존 팀 비소급을 지킨다", async (t) => {
  const f = await fixture(t),
    c = await f.common("auditor"),
    base = await f.template(c),
    q = await f.register(base, c);
  const copy = f.store.snapshot().courses.find((x) => x.id === q.courseIds[0])!;
  assert.equal(q.qualificationType, "auditor");
  assert.equal(copy.category, "common");
  assert.deepEqual(copy.assessmentKinds, []);
  await f.call(
    "admin-1",
    `/courses/${copy.id}`,
    { ...copy, qualificationType: "auditee" },
    409,
    "PUT",
  );
  const saved = await f.call(
    "admin-1",
    `/qualifications/${q.id}`,
    { ...q, validity: { type: "unlimited", months: null, reminderDays: [] } },
    200,
    "PUT",
  );
  const next = f.store
    .snapshot()
    .qualifications.find((x) => x.id === saved.id)!;
  assert.deepEqual(
    qualificationUseErrors(next, f.store.snapshot().courses),
    [],
  );
  await f.call(
    "operator-1",
    `/system/qualification-templates/${base.id}`,
    {
      title: base.title,
      englishName: "",
      revision: base.revision,
      qualificationType: "auditor",
      defaultCommonCourseIds: [],
    },
    200,
    "PUT",
  );
  assert.deepEqual(
    f.store.snapshot().qualifications.find((x) => x.id === q.id)!.courseIds,
    q.courseIds,
  );
});
test("등록 저장 실패·중복 재시도·동시 등록은 자격과 공통 사본을 부분 생성하지 않는다", async (t) => {
  const f = await fixture(t),
    c = await f.common(),
    base = await f.template(c),
    before = await readFile(f.file),
    snapshot = f.store.snapshot();
  const body = {
      templateIds: [base.id],
      templateRevisions: { [base.id]: base.revision },
      commonCourseRevisions: { [c.id]: c.revision },
    },
    url = "/qualification-templates/import";
  f.store.beforeReplace = () => {
    throw new Error("공통 사본 저장 실패");
  };
  await f.call("admin-1", url, body, 503);
  assert.deepEqual(await readFile(f.file), before);
  assert.deepEqual(f.store.snapshot(), snapshot);
  f.store.beforeReplace = undefined;
  const key = randomUUID(),
    a = await f.call("admin-1", url, body, 200, "POST", key),
    b = await f.call("admin-1", url, body, 200, "POST", key);
  assert.deepEqual(a, b);
  await Promise.all([
    f.call("admin-1", url, body),
    f.call("admin-1", url, body),
  ]);
  assert.equal(
    f.store.snapshot().qualifications.filter((q) => q.templateId === base.id)
      .length,
    1,
  );
  assert.equal(
    f.store
      .snapshot()
      .courses.filter(
        (c) => c.commonCourseSource?.id === base.defaultCommonCourseIds[0],
      ).length,
    1,
  );
});
test("제거된 기본 목록을 본 이전 등록 화면과 공통 분류 생성 위조를 거부한다", async (t) => {
  const f = await fixture(t),
    c = await f.common(),
    base = await f.template(c);
  await f.call(
    "operator-1",
    `/system/qualification-templates/${base.id}`,
    {
      title: base.title,
      englishName: "",
      revision: base.revision,
      defaultCommonCourseIds: [],
    },
    200,
    "PUT",
  );
  await f.call(
    "admin-1",
    "/qualification-templates/import",
    {
      templateIds: [base.id],
      templateRevisions: { [base.id]: base.revision },
      commonCourseRevisions: { [c.id]: c.revision },
    },
    409,
  );
  await f.call(
    "admin-1",
    "/courses",
    { title: "위조", category: "common" },
    422,
  );
  assert.equal(
    f.store.snapshot().qualifications.filter((q) => q.templateId === base.id)
      .length,
    0,
  );
});
