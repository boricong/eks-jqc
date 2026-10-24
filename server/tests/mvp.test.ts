import {
  linkFixtureTemplates,
  registerFixtureQualification,
} from "./template-helpers.ts";
import { configureTestPolicies } from "./policy-helpers.ts";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { State, Kind, Course } from "@eks/contracts";
import { seedState } from "../src/seed.ts";
import { JsonStore } from "../src/storage.ts";
import { validateState } from "../src/integrity.ts";
import { buildApp } from "../src/app.ts";
import { organizationEntries } from "@eks/contracts";
import { seedOrganizations } from "../src/organizations.ts";
import { migrateState } from "../src/migration.ts";

async function createUser(
  f: Fixture,
  name: string,
  roles: string[],
  organizationId = "org-photo",
) {
  return (
    await f.call("operator-1", "/system/users", { name, roles, organizationId })
  ).id as string;
}
async function secondOrganization(f: Fixture) {
  const learner = await createUser(
    f,
    "Etch 학습자",
    ["learner"],
    "org-etch-equipment-1",
  );
  const ft = await createUser(f, "Etch FT", ["learner"], "org-etch");
  const course = await f.call("admin-2", "/courses", {});
  await f.call(
    "admin-2",
    `/courses/${course.id}`,
    {
      ...f.store.snapshot().courses[0],
      title: "Etch 과정",
      revision: 1,
    },
    undefined,
    undefined,
    "PUT",
  );
  const qualification = await registerFixtureQualification(
    f.store,
    "Etch 자격",
    "Etch 직무 검증",
    "org-etch",
  );
  await f.call(
    "admin-2",
    `/qualifications/${qualification.id}`,
    {
      title: "Etch 자격",
      description: "Etch 직무 검증",
      validity: { type: "unlimited", months: null, reminderDays: [] },
      courseIds: [course.id],
      revision: 1,
    },
    undefined,
    undefined,
    "PUT",
  );
  const assignment = await planAssignment(f, "admin-2", {
    qualificationId: qualification.id,
    learnerId: learner,
    ftId: ft,
  });
  const enrollment = f.store
    .snapshot()
    .enrollments.find((e) => e.assignmentId === assignment.id)!.id;
  return {
    learner,
    ft,
    course: course.id,
    qualification: qualification.id,
    assignment: assignment.id,
    enrollment,
  };
}

test("조직표 35개 노드·전체 경로·동명 조직 구분", () => {
  const entries = organizationEntries(seedOrganizations());
  assert.equal(entries.length, 35);
  assert.deepEqual(
    [1, 2, 3, 4].map(
      (level) => entries.filter((e) => e.level === level).length,
    ),
    [3, 4, 7, 21],
  );
  assert.deepEqual(
    ["org-photo", "org-etch", "org-fab"].map(
      (id) => entries.filter((e) => e.lv1OrganizationId === id).length,
    ),
    [20, 11, 4],
  );
  assert.deepEqual(
    entries
      .filter((e) => e.level === 4)
      .map((e) =>
        e.path
          .slice(1)
          .map((p) => p.name)
          .join("/"),
      ),
    [
      "FMG/평택/RE A조",
      "FMG/평택/RE B조",
      "FMG/평택/RE C조",
      "FMG/평택/RE D조",
      "FMG/평택/현장운영",
      "FMG/화성/현장운영",
      "인증 업무/설비/12인치",
      "인증 업무/설비/8인치",
      "인증 업무/설비/혁신",
      "인증 업무/설비/FMG",
      "인증 업무/공정/12인치",
      "인증 업무/공정/8인치",
      "인증 업무/공정/혁신",
      "인증 업무/설비/12인치",
      "인증 업무/설비/8인치",
      "인증 업무/설비/혁신",
      "인증 업무/설비/FMG",
      "인증 업무/공정/12인치",
      "인증 업무/공정/8인치",
      "인증 업무/공정/혁신",
      "인재양성/인재양성/인재양성",
    ],
  );
  assert.equal(new Set(entries.map((e) => e.id)).size, 35);
});

test("조직 CRUD 권한·레벨·이동·중복 이름·충돌·재시도·재시작", async (t) => {
  const f = await fixture(t);
  for (const actor of ["admin-1", "ft-1", "learner-1"]) {
    await f.call(actor, "/system/organizations", undefined, 403);
    await f.call(
      actor,
      "/system/organizations",
      { revision: 0, parentId: null, name: "불가" },
      403,
    );
  }
  const create = { revision: 0, parentId: "org-photo", name: "시험 조직" },
    key = randomUUID();
  const added = await f.call(
    "operator-1",
    "/system/organizations",
    create,
    200,
    key,
  );
  assert.deepEqual(
    await f.call("operator-1", "/system/organizations", create, 200, key),
    added,
  );
  await f.call(
    "operator-1",
    "/system/organizations",
    { ...create, revision: 1 },
    422,
  );
  const edit = (id: string, body: object, code = 200) =>
    f.call(
      "operator-1",
      `/system/organizations/${id}`,
      { revision: f.store.organizations.snapshot().revision, ...body },
      code,
      randomUUID(),
      "PATCH",
    );
  await edit(added.id, { name: "변경된 시험 조직", order: 0 });
  assert.equal(
    organizationEntries(f.store.organizations.snapshot()).find(
      (e) => e.id === added.id,
    )!.order,
    0,
  );
  await f.call(
    "operator-1",
    `/system/organizations/${added.id}`,
    { revision: 0, name: "오래된 수정" },
    409,
    randomUUID(),
    "PATCH",
  );
  await edit("org-photo-fmg", { parentId: "org-etch" }, 422);
  await edit("org-photo-fmg", { parentId: "org-photo-pyeongtaek" }, 422);
  await f.call(
    "operator-1",
    "/system/organizations",
    { revision: 2, parentId: "org-photo-pyeongtaek-1", name: "Lv5" },
    200,
  );
  await edit("org-photo-pyeongtaek-1", { parentId: "org-photo-hwaseong" });
  await edit(added.id, { active: false });
  await f.call(
    "operator-1",
    "/system/users",
    { name: "중지 조직 사용자", organizationId: added.id, roles: ["learner"] },
    422,
  );
  await edit(added.id, { active: true });
  const before = await readFile(f.store.organizations.file, "utf8");
  await f.restart();
  assert.equal(await readFile(f.store.organizations.file, "utf8"), before);
  const view = await f.call("operator-1", "/system/organizations");
  assert.equal(
    view.entries.find((e: any) => e.id === "org-photo-pyeongtaek-1").parentId,
    "org-photo-hwaseong",
  );
  assert.ok(view.audits.length >= 5);
});

test("Lv1 데이터 격리·동일 조직 관리자 공동 관리·운영자 명시적 관리 대상 필수", async (t) => {
  const f = await fixture(t),
    other = await secondOrganization(f);
  const photo = await f.call("admin-1", "/workspace"),
    etch = await f.call("admin-2", "/workspace");
  assert.ok(
    photo.qualifications.every((q: any) => q.lv1OrganizationId === "org-photo"),
  );
  assert.ok(etch.users.every((u: any) => u.lv1OrganizationId === "org-etch"));
  assert.equal(etch.assignments.length, 1);
  assert.equal(
    (await f.call("operator-1", "/workspace")).assignments.length,
    2,
  );
  assert.equal(
    (await f.call("operator-1", "/workspace?lv1OrganizationId=org-etch"))
      .assignments.length,
    1,
  );
  await f.call(
    "admin-1",
    "/workspace?lv1OrganizationId=org-etch",
    undefined,
    403,
  );
  await f.call("admin-1", `/assignments/${other.assignment}`, undefined, 404);
  await f.call("admin-2", "/courses/demo-course-1", undefined, 404);
  await f.call("operator-1", "/courses", {}, 403);
  await f.call(
    "operator-1",
    "/assignments/assignment-1/ft",
    { revision: 1, ftId: "ft-2", reason: "운영자 우회" },
    403,
  );
  await f.call(
    "admin-1",
    "/assignments",
    {
      qualificationId: "demo-qualification",
      learnerId: "learner-2",
    },
    409,
  );
  await f.call(
    "admin-1",
    "/assignments",
    {
      qualificationId: other.qualification,
      learnerId: "learner-2",
    },
    403,
  );
  const q = await registerFixtureQualification(
    f.store,
    "잘못 연결",
    "",
    "org-etch",
  );
  await f.call(
    "admin-2",
    `/qualifications/${q.id}`,
    { title: "잘못 연결", courseIds: ["demo-course-1"], revision: 1 },
    422,
    undefined,
    "PUT",
  );
  const admin = await createUser(
    f,
    "Photo 공동 관리자",
    ["admin"],
    "org-photo-pyeongtaek-1",
  );
  await f.call(admin, "/assignments/assignment-1/results");
  assert.equal(f.store.snapshot().assignments[0]!.ownerAdminId, "admin-1");
  const attempt = await start(f, other.enrollment, "practical", other.learner);
  await f.call(
    "ft-1",
    `/attempts/${attempt.id}/draft`,
    { revision: 1, answers: {} },
    403,
    randomUUID(),
    "PUT",
  );
  await f.call(
    "operator-1",
    `/attempts/${attempt.id}/submit`,
    { revision: 1 },
    403,
  );
  await saved(f, attempt.id, true, other.ft);
  await submit(f, attempt.id, other.ft);
});

test("쓰기 대기열에서 최신 역할을 다시 검사", async (t) => {
  const f = await fixture(t);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.store.beforeReplace = async () => {
    f.store.beforeReplace = undefined;
    entered();
    await gate;
  };
  const first = f.call("admin-1", "/courses", {});
  await waiting;
  let queuedDemotion!: () => void, queuedStale!: () => void;
  const demotionQueued = new Promise<void>((resolve) => {
    queuedDemotion = resolve;
  });
  const staleQueued = new Promise<void>((resolve) => {
    queuedStale = resolve;
  });
  const transact = f.store.transact.bind(f.store);
  f.store.transact = ((...args: any[]) => {
    const result = (transact as any)(...args);
    if (args[0] === "operator-1") queuedDemotion();
    else if (args[0] === "admin-1") queuedStale();
    return result;
  }) as typeof f.store.transact;
  const current = f.store.snapshot().users.find((u) => u.id === "admin-1")!;
  const demote = f.call(
    "operator-1",
    "/system/users/admin-1",
    {
      name: current.name,
      organizationId: current.organizationId,
      revision: current.revision,
      roles: ["learner"],
    },
    200,
    randomUUID(),
    "PATCH",
  );
  await demotionQueued;
  const stale = f.call("admin-1", "/courses", {}, 403);
  await staleQueued;
  release();
  await Promise.all([first, demote, stale]);
});

test("선택 Lv1 초기화가 다른 조직·조직 JSON·소속·운영 이력을 보존", async (t) => {
  const f = await fixture(t),
    other = await secondOrganization(f);
  await start(f, eid, "practical");
  const otherAttempt = await start(
    f,
    other.enrollment,
    "practical",
    other.learner,
  );
  await saved(f, otherAttempt.id, true, other.ft);
  const before = f.store.snapshot(),
    master = await readFile(f.store.organizations.file, "utf8");
  const preview = await f.call(
    "operator-1",
    "/testing/progress?scope=organization&lv1OrganizationId=org-photo",
  );
  await f.call("operator-1", "/testing/progress/reset", {
    revision: preview.revision,
    confirmation: "초기화",
    scope: preview.scope,
  });
  const after = f.store.snapshot();
  assert.deepEqual(
    after.attempts,
    before.attempts.filter((a) => a.enrollmentId === other.enrollment),
  );
  assert.deepEqual(
    after.requests.filter((r) => r.lv1OrganizationId === "org-etch"),
    before.requests.filter((r) => r.lv1OrganizationId === "org-etch"),
  );
  assert.deepEqual(after.users, before.users);
  assert.equal(await readFile(f.store.organizations.file, "utf8"), master);
  assert.deepEqual(
    after.audits.filter((e) => e.action.startsWith("user.")),
    before.audits.filter((e) => e.action.startsWith("user.")),
  );
  await f.call("operator-1", "/testing/progress", undefined, 422);
  await f.call(
    "operator-1",
    "/testing/progress/reset",
    { revision: after.revision, confirmation: "초기화" },
    422,
  );
});

test("조직 백업·실패 보존·일반 데이터 복구가 조직 파일을 변경하지 않음", async (t) => {
  const f = await fixture(t),
    backup = await f.store.backup(),
    orgBackup = await f.store.organizations.backup();
  const edit = () =>
    f.call(
      "operator-1",
      "/system/organizations/org-photo",
      { revision: 0, name: "Photo 변경" },
      200,
      randomUUID(),
      "PATCH",
    );
  f.store.organizations.beforeReplace = () => {
    throw new Error("조직 교체 실패");
  };
  await f.call(
    "operator-1",
    "/system/organizations/org-photo",
    { revision: 0, name: "실패한 이름" },
    503,
    randomUUID(),
    "PATCH",
  );
  assert.deepEqual(f.store.organizations.snapshot(), seedOrganizations());
  f.store.organizations.beforeReplace = undefined;
  await edit();
  const master = await readFile(f.store.organizations.file, "utf8");
  await f.stop();
  await new JsonStore(f.file).restore(backup);
  assert.equal(await readFile(f.store.organizations.file, "utf8"), master);
  await writeFile(f.store.organizations.file, "조직 파일 손상");
  await assert.rejects(new JsonStore(f.file).load(), /열 수 없습니다/);
  assert.equal(
    await readFile(f.store.organizations.file, "utf8"),
    "조직 파일 손상",
  );
  await assert.rejects(
    new JsonStore(f.file).initialize(seedState(true)),
    /초기화하지 않습니다/,
  );
  assert.equal(
    await readFile(f.store.organizations.file, "utf8"),
    "조직 파일 손상",
  );
  await new JsonStore(f.file).restoreOrganizations(orgBackup);
  const restored = await new JsonStore(f.file).load();
  try {
    assert.equal(
      restored.organizations.snapshot().roots[0]!.name,
      seedOrganizations().roots[0]!.name,
    );
  } finally {
    await restored.close();
  }
  const missingReference = seedOrganizations();
  missingReference.roots.shift();
  const invalid = path.join(f.dir, "invalid-organizations.json");
  await writeFile(invalid, JSON.stringify(missingReference));
  const good = await readFile(f.store.organizations.file, "utf8");
  await assert.rejects(
    new JsonStore(f.file).restoreOrganizations(invalid),
    /조직 참조/,
  );
  assert.equal(await readFile(f.store.organizations.file, "utf8"), good);
  await rm(f.store.organizations.file);
  await new JsonStore(f.file).restoreOrganizations(orgBackup);
  assert.equal(
    organizationEntries(
      JSON.parse(await readFile(f.store.organizations.file, "utf8")),
    ).length,
    35,
  );
});

async function fixture(t: TestContext, change?: (s: State) => void) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "eks-api-")),
    file = path.join(dir, "runtime", "state.json"),
    seed = seedState(true);
  seed.users.push(
    {
      id: "admin-2",
      name: "다른 조직 관리자",
      roles: ["admin"],
      organizationId: "org-etch",
      revision: 1,
    },
    {
      id: "dual",
      name: "겸직 참여자",
      roles: ["learner"],
      organizationId: "org-photo",
      revision: 1,
    },
  );
  change?.(seed);
  await new JsonStore(file).initialize(seed);
  let store = await new JsonStore(file).load(),
    app = await buildApp(store);
  await app.ready();
  let closed = false;
  const cookies = new Map<string, string>();
  async function cookieFor(actor: string) {
    if (!cookies.has(actor)) {
      const r = await app.inject({
        method: "POST",
        url: "/api/session",
        payload: { actorId: actor },
      });
      assert.equal(r.statusCode, 200, r.body);
      cookies.set(actor, r.cookies[0]!.name + "=" + r.cookies[0]!.value);
    }
    return cookies.get(actor)!;
  }
  async function call(
    actor: string,
    url: string,
    body?: unknown,
    expected = 200,
    key = randomUUID(),
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  ) {
    const r = await app.inject({
      method: method || (body === undefined ? "GET" : "POST"),
      url: "/api" + url,
      headers: { cookie: await cookieFor(actor), "idempotency-key": key },
      ...(body === undefined ? {} : { payload: body as any }),
    });
    assert.equal(r.statusCode, expected, `${url}: ${r.body}`);
    return r.json();
  }
  async function restart() {
    await app.close();
    store = await new JsonStore(file).load();
    app = await buildApp(store);
    await app.ready();
    cookies.clear();
  }
  t.after(async () => {
    if (!closed) {
      await app.close();
      closed = true;
    }
    await rm(dir, { recursive: true, force: true });
  });
  return {
    dir,
    file,
    get app() {
      return app;
    },
    get store() {
      return store;
    },
    call,
    cookieFor,
    restart,
    async stop() {
      await app.close();
      closed = true;
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

// Build real pre-workflow JSON; changing only schemaVersion would not exercise migration.
function legacyFields(s: any) {
  for (const c of s.courses) {
    c.mode = c.assessmentKinds.length === 2 ? "both" : c.assessmentKinds[0];
    delete c.assessmentKinds;
    delete c.learningItems;
    delete c.subjectiveQuestions;
    delete c.subjectivePassScore;
  }
  for (const q of s.qualifications) {
    delete q.englishName;
    delete q.description;
    delete q.validity;
  }
  for (const a of s.assignments) delete a.createdBy;
  for (const t of s.attempts) {
    if (t.status === "graded") t.status = "submitted";
    delete t.submittedAt;
  }
  for (const c of [...s.completions, ...s.certifications]) {
    delete c.snapshot;
    delete c.validity;
    delete c.expiresOn;
  }
  delete s.plans;
  delete s.planningRequests;
  delete s.learningRecords;
  delete s.notifications;
}
async function planAssignment(
  f: Fixture,
  manager: string,
  input: { qualificationId: string; learnerId: string; ftId: string | null },
) {
  const q = f.store
    .snapshot()
    .qualifications.find((q) => q.id === input.qualificationId)!;
  await configureTestPolicies(f.store, q.lv1OrganizationId, undefined, [q.id]);
  const request = await f.call(
    manager,
    scoped("/planning-requests", q.lv1OrganizationId),
    {
      learnerIds: [input.learnerId],
      dueOn: "2026-10-31",
      message: "검증용 계획 요청",
    },
  );
  const p = await f.call(input.learnerId, "/plans", {
    requestRevision: f.store
      .snapshot()
      .planningRequests.find((r) => r.id === request.ids[0])!.revision,
    requestId: request.ids[0],
    qualificationId: q.id,
  });
  const plan = f.store.snapshot().plans.find((plan) => plan.id === p.id)!;
  await f.call(
    input.learnerId,
    `/plans/${p.id}`,
    {
      revision: plan.revision,
      targetOn: "2026-11-30",
      schedules: q.courseIds.map((courseId) => ({
        courseId,
        learningStart: "2026-10-01",
        learningEnd: "2026-10-31",
        assessmentOn: "2026-11-15",
        goal: "독립 수행 연습",
      })),
    },
    200,
    randomUUID(),
    "PUT",
  );
  const completed = await f.call(input.learnerId, `/plans/${p.id}/complete`, {
    revision: plan.revision + 1,
  });
  const a = f.store
    .snapshot()
    .assignments.find((a) => a.id === completed.assignmentId)!;
  return { id: a.id };
}

const scoped = (url: string, root = "org-etch") =>
  `${url}?lv1OrganizationId=${root}`;
async function lifecycle(
  f: Fixture,
  id: string,
  action: "retirement" | "reactivation",
  actor = "admin-1",
  root = "org-photo",
) {
  const usage = await f.call(actor, scoped(`/courses/${id}/usage`, root));
  return f.call(actor, scoped(`/courses/${id}/${action}`, root), {
    ...usage,
    reason: "운영 기준 변경",
  });
}

test("초안 삭제 참조·revision·영구 백업·실패 보존·삭제 후 재시도·최신 권한", async (t) => {
  const f = await fixture(t);
  const draft = await f.call("admin-1", "/courses", {});
  const usage = await f.call("admin-1", `/courses/${draft.id}/usage`);
  assert.equal(usage.canDelete, true);
  const q = await registerFixtureQualification(f.store, "초안 연결");
  await f.call(
    "admin-1",
    `/qualifications/${q.id}`,
    { title: "초안 연결", revision: 1, courseIds: [draft.id] },
    200,
    randomUUID(),
    "PUT",
  );
  await f.call(
    "admin-1",
    `/courses/${draft.id}`,
    { ...usage, reason: "삭제" },
    409,
    randomUUID(),
    "DELETE",
  );
  const linked = await f.call("admin-1", `/courses/${draft.id}/usage`);
  assert.equal(linked.canDelete, false);
  assert.equal(linked.qualifications[0].id, q.id);
  await f.call(
    "admin-1",
    `/courses/${draft.id}`,
    { ...linked, reason: "삭제" },
    409,
    randomUUID(),
    "DELETE",
  );
  await f.call(
    "admin-1",
    `/qualifications/${q.id}`,
    { revision: 2, courseIds: [] },
    200,
    randomUUID(),
    "PUT",
  );
  const fresh = await f.call("admin-1", `/courses/${draft.id}/usage`);
  const command = { ...fresh, reason: "미사용 초안 정리" },
    key = randomUUID();
  const before = await readFile(f.file, "utf8");
  const permanentFile = path.join(f.store.backupDir, "blocked");
  // Force the backup directory to be a file, without changing the state file.
  const original = f.store.backupDir;
  await writeFile(permanentFile, "backup unavailable");
  Object.defineProperty(f.store, "backupDir", {
    value: permanentFile,
    configurable: true,
  });
  await f.call("admin-1", `/courses/${draft.id}`, command, 503, key, "DELETE");
  assert.equal(await readFile(f.file, "utf8"), before);
  Object.defineProperty(f.store, "backupDir", {
    value: original,
    configurable: true,
  });
  const result = await f.call(
    "admin-1",
    `/courses/${draft.id}`,
    command,
    200,
    key,
    "DELETE",
  );
  assert.deepEqual(
    await f.call(
      "admin-1",
      `/courses/${draft.id}`,
      command,
      200,
      key,
      "DELETE",
    ),
    result,
  );
  assert.equal(
    f.store.snapshot().courses.some((c) => c.id === draft.id),
    false,
  );
  assert.ok(
    (await readdir(original)).some((n) =>
      n.startsWith("before-course-delete-"),
    ),
  );
  await f.restart();
  assert.deepEqual(
    await f.call(
      "admin-1",
      `/courses/${draft.id}`,
      command,
      200,
      key,
      "DELETE",
    ),
    result,
  );
  await f.call(
    "operator-1",
    "/system/users/admin-1",
    {
      revision: 1,
      name: "이서연",
      organizationId: "org-photo",
      roles: ["learner"],
    },
    200,
    randomUUID(),
    "PATCH",
  );
  await f.call("admin-1", `/courses/${draft.id}`, command, 403, key, "DELETE");
});

test("선택 버전 운영 종료·기존 배정 완료·인증 근거 보존·자격 개정·재개·초기화", async (t) => {
  const f = await fixture(t);
  // Finish the original assignment before retirement, and assign a new untouched one.
  for (const e of f.store.snapshot().enrollments)
    for (const kind of ["objective", "practical"] as Kind[])
      if (
        !f.store
          .snapshot()
          .attempts.some(
            (a) =>
              a.enrollmentId === e.id &&
              a.kind === kind &&
              a.result === "passed",
          )
      )
        await finish(f, e.id, kind);
  const preserved = f.store.snapshot();
  const a = await planAssignment(f, "admin-1", {
    qualificationId: "demo-qualification",
    learnerId: "learner-2",
    ftId: "ft-1",
  });
  const v2 = await f.call("admin-1", "/courses/demo-course-1/versions", {});
  await f.call(
    "admin-1",
    `/courses/${v2.id}`,
    f.store.snapshot().courses.find((c) => c.id === v2.id),
    undefined,
    undefined,
    "PUT",
  );
  let orgBefore = await readFile(f.store.organizations.file, "utf8");
  await lifecycle(f, "demo-course-1", "retirement");
  assert.equal(
    f.store.snapshot().courses.find((c) => c.id === v2.id)!.operationalStatus,
    "active",
  );
  assert.deepEqual(f.store.snapshot().certifications, preserved.certifications);
  assert.deepEqual(f.store.snapshot().completions, preserved.completions);
  assert.deepEqual(f.store.snapshot().attempts, preserved.attempts);
  assert.deepEqual(f.store.snapshot().qualifications, preserved.qualifications);
  await f.call(
    "admin-1",
    "/assignments",
    { qualificationId: "demo-qualification", learnerId: "dual" },
    409,
  );
  const nextQ = await f.call(
    "admin-1",
    "/qualifications/demo-qualification/versions",
    {},
  );
  let q = f.store.snapshot().qualifications.find((q) => q.id === nextQ.id)!;
  await f.call(
    "admin-1",
    `/qualifications/${q.id}`,
    q,
    200,
    randomUUID(),
    "PUT",
  );
  q = f.store.snapshot().qualifications.find((q) => q.id === nextQ.id)!;
  await f.call("admin-1", `/qualifications/${q.id}`, q, 200, undefined, "PUT");
  await f.call(
    "admin-1",
    `/qualifications/${q.id}`,
    {
      ...q,
      courseIds: q.courseIds.map((id) => (id === "demo-course-1" ? v2.id : id)),
    },
    undefined,
    undefined,
    "PUT",
  );
  await planAssignment(f, "admin-1", {
    qualificationId: q.id,
    learnerId: "dual",
    ftId: "ft-1",
  });
  // Not-started learners retain every original required course and may retry.
  const es = f.store
    .snapshot()
    .enrollments.filter((e) => e.assignmentId === a.id);
  await finish(f, es[0]!.id, "practical", false, "learner-2");
  for (const e of es)
    for (const kind of ["objective", "practical"] as Kind[])
      if (
        !f.store
          .snapshot()
          .attempts.some(
            (t) =>
              t.enrollmentId === e.id &&
              t.kind === kind &&
              t.result === "passed",
          )
      )
        await finish(f, e.id, kind, true, "learner-2");
  assert.ok(
    f.store.snapshot().certifications.some((c) => c.assignmentId === a.id),
  );
  const clone = await f.call("admin-1", "/courses/demo-course-1/versions", {});
  const cloned = f.store.snapshot().courses.find((c) => c.id === clone.id)!;
  assert.equal(cloned.operationalStatus, "active");
  assert.equal("status" in cloned, false);
  assert.equal(cloned.retiredAt, undefined);
  await f.restart();
  assert.equal(
    (await f.call("learner-1", "/workspace")).courses.find(
      (c: any) => c.id === "demo-course-1",
    ).operationalStatus,
    "retired",
  );
  assert.deepEqual(
    (await f.call("learner-1", "/assignments/assignment-1/certification"))
      .certification,
    preserved.certifications[0],
  );
  await lifecycle(f, "demo-course-1", "reactivation");
  assert.equal(
    f.store.snapshot().courses.find((c) => c.id === "demo-course-1")!.retiredAt,
    undefined,
  );
  await planAssignment(f, "admin-1", {
    qualificationId: "demo-qualification",
    learnerId: await createUser(f, "재개 후 대상자", ["learner"]),
    ftId: "ft-1",
  });
  await lifecycle(f, "demo-course-1", "retirement");
  const courseStates = f.store.snapshot().courses,
    audits = f.store
      .snapshot()
      .audits.filter((e) => e.action.startsWith("course."));
  orgBefore = await readFile(f.store.organizations.file, "utf8");
  await f.call("operator-1", "/testing/progress/reset", {
    scope: { type: "all" },
    confirmation: "초기화",
    revision: f.store.snapshot().revision,
  });
  assert.deepEqual(f.store.snapshot().courses, courseStates);
  assert.deepEqual(
    f.store.snapshot().audits.filter((e) => e.action.startsWith("course.")),
    audits,
  );
  assert.equal(await readFile(f.store.organizations.file, "utf8"), orgBefore);
});

test("미참조 인증Set 삭제와 종료 상태 위조 방지", async (t) => {
  const f = await fixture(t);
  const draft = await f.call("admin-1", "/courses", {});
  await f.call(
    "admin-1",
    `/courses/${draft.id}`,
    {
      ...f.store.snapshot().courses[0],
      revision: 1,
      operationalStatus: "retired",
      retiredAt: new Date().toISOString(),
      retiredBy: "operator-1",
      retirementReason: "위조",
    },
    undefined,
    undefined,
    "PUT",
  );
  assert.equal(
    f.store.snapshot().courses.find((c) => c.id === draft.id)!
      .operationalStatus,
    "active",
  );
  const usage = await f.call("admin-1", `/courses/${draft.id}/usage`);
  assert.equal(usage.counts.assignments, 0);
  assert.equal(usage.canDelete, true);
  await f.call(
    "admin-1",
    `/courses/${draft.id}`,
    { ...usage, reason: "미참조 정리" },
    200,
    randomUUID(),
    "DELETE",
  );
  assert.ok(!f.store.snapshot().courses.some((c) => c.id === draft.id));
});

test("운영자 관리 요청도 쓰기 대기열에서 변경된 권한을 재검사", async (t) => {
  const f = await fixture(t);
  const second = await createUser(f, "추가 운영자", ["system_operator"]);
  // Establish sessions before holding the serial queue.
  await f.cookieFor(second);
  await f.cookieFor("operator-1");
  let unblock!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => {
    unblock = r;
  });
  const arrived = new Promise<void>((r) => {
    entered = r;
  });
  f.store.beforeReplace = async () => {
    entered();
    await gate;
  };
  const revoking = f.call(
    second,
    "/system/users/operator-1",
    {
      revision: 1,
      name: "시스템 운영자",
      organizationId: "org-photo",
      roles: ["admin"],
    },
    200,
    randomUUID(),
    "PATCH",
  );
  await arrived;
  const pending = f.call("operator-1", scoped("/courses"), {}, 403);
  unblock();
  f.store.beforeReplace = undefined;
  await revoking;
  await pending;
  assert.ok(
    f.store
      .snapshot()
      .courses.every((c) => c.lv1OrganizationId === "org-photo"),
  );
});

test("새 Lv1은 마지막 순서의 사용 조직으로 생성되고 재시도에 중복되지 않음", async (t) => {
  const f = await fixture(t),
    before = f.store.organizations.snapshot(),
    key = randomUUID();
  const input = {
    revision: before.revision,
    name: "새로운 최상위",
    parentId: null,
    active: false,
    order: 0,
  };
  const created = await f.call(
    "operator-1",
    "/system/organizations",
    input,
    200,
    key,
  );
  assert.deepEqual(
    await f.call("operator-1", "/system/organizations", input, 200, key),
    created,
  );
  const roots = f.store.organizations.snapshot().roots;
  assert.equal(roots.length, before.roots.length + 1);
  assert.equal(roots.at(-1)!.id, created.id);
  assert.equal(roots.at(-1)!.active, true);
  const view = await f.call("operator-1", scoped("/workspace", created.id));
  assert.equal(view.courses.length, 0);
  assert.equal(view.users.length, 0);
  assert.equal(view.assignments.length, 0);
});

const eid = "assignment-1:demo-course-1";
async function start(
  f: Fixture,
  enrollmentId: string,
  kind: Kind,
  learner = "learner-1",
) {
  // Existing unrelated tests prepare the newly required knowledge pass first.
  if (
    kind === "practical" &&
    !f.store
      .snapshot()
      .attempts.some(
        (t) =>
          t.enrollmentId === enrollmentId &&
          t.kind === "objective" &&
          t.result === "passed",
      )
  )
    await finish(f, enrollmentId, "objective", true, learner);
  return f.call(
    learner,
    `/enrollments/${encodeURIComponent(enrollmentId)}/attempts`,
    { kind },
  );
}
async function saved(f: Fixture, attemptId: string, pass = true, ft = "ft-1") {
  const t = f.store.snapshot().attempts.find((t) => t.id === attemptId)!,
    c = f.store.snapshot().courses.find((c) => c.id === t.courseId)!;
  const questions = t.kind === "objective" ? c.questions : c.practicalQuestions;
  const answers = Object.fromEntries(
    questions.map((q, i) => [
      q.id,
      !pass && i === 0 ? (q.correct! + 1) % q.choices.length : q.correct,
    ]),
  );
  return f.call(
    t.learnerId,
    `/attempts/${t.id}/draft`,
    { revision: t.revision, answers },
    200,
    randomUUID(),
    "PUT",
  );
}
async function submit(f: Fixture, attemptId: string, ft = "ft-1") {
  const t = f.store.snapshot().attempts.find((t) => t.id === attemptId)!;
  return f.call(t.learnerId, `/attempts/${t.id}/submit`, {
    revision: t.revision,
  });
}
async function finish(
  f: Fixture,
  enrollmentId: string,
  kind: Kind,
  pass = true,
  learner = "learner-1",
  ft = "ft-1",
) {
  const t = await start(f, enrollmentId, kind, learner);
  await saved(f, t.id, pass, ft);
  return submit(f, t.id, ft);
}

test("응시 이어쓰기·새로고침·서버 재시작·미응답 차단", async (t) => {
  const f = await fixture(t),
    enrollmentId = "assignment-1:demo-course-2";
  const first = await start(f, enrollmentId, "objective"),
    again = await start(f, enrollmentId, "objective");
  assert.equal(first.id, again.id);
  await f.call(
    "learner-1",
    `/attempts/${first.id}/draft`,
    { revision: 1, answers: { "d2-q1": 0 } },
    200,
    randomUUID(),
    "PUT",
  );
  await f.call(
    "learner-1",
    `/attempts/${first.id}/submit`,
    { revision: 2 },
    422,
  );
  const oldCookie = await f.cookieFor("learner-1");
  await f.restart();
  assert.equal(
    (
      await f.app.inject({
        url: "/api/workspace",
        headers: { cookie: oldCookie },
      })
    ).statusCode,
    401,
  );
  const resumed = await start(f, enrollmentId, "objective");
  assert.equal(resumed.id, first.id);
  const data = await f.call("learner-1", `/attempts/${first.id}`);
  assert.deepEqual(data.answers, { "d2-q1": 0 });
  await f.call(
    "learner-1",
    `/attempts/${first.id}/draft`,
    { revision: 2, answers: { "d2-q1": 99 } },
    422,
    randomUUID(),
    "PUT",
  );
});

test("부분 통과 유지·실기 재응시·복수 합격 근거·자동 인증", async (t) => {
  const f = await fixture(t);
  await f.call(
    "learner-1",
    `/enrollments/${encodeURIComponent(eid)}/attempts`,
    { kind: "objective" },
    409,
  );
  await finish(f, eid, "practical");
  let s = f.store.snapshot();
  assert.equal(s.completions.length, 1);
  assert.equal(s.certifications.length, 0);
  const completion = s.completions[0]!;
  assert.equal(
    completion.evidence.find((x) => x.kind === "objective")!.attemptId,
    "attempt-1",
  );
  assert.equal(
    s.attempts.find(
      (x) =>
        x.id ===
        completion.evidence.find((ev) => ev.kind === "practical")!.attemptId,
    )!.round,
    2,
  );
  const e2 = "assignment-1:demo-course-2";
  await finish(f, e2, "objective", false);
  assert.equal(f.store.snapshot().certifications.length, 0);
  await finish(f, e2, "objective");
  await finish(f, e2, "practical");
  s = f.store.snapshot();
  assert.equal(s.certifications.length, 1);
  assert.equal(s.completions.length, 2);
  assert.equal(s.certifications[0]!.evidence.length, 2);
  assert.equal(s.attempts.filter((a) => a.result === "failed").length, 2);
  const learner = await f.call(
    "learner-1",
    "/assignments/assignment-1/certification",
  );
  assert.equal(learner.certification.id, s.certifications[0]!.id);
  await f.restart();
  assert.equal(
    f.store.snapshot().certifications[0]!.id,
    s.certifications[0]!.id,
  );
});

test("중복 제출·동시 마지막 평가 확정·요청 식별자 충돌", async (t) => {
  const f = await fixture(t);
  await finish(f, eid, "practical");
  const e2 = "assignment-1:demo-course-2";
  await finish(f, e2, "objective");
  const practical = await start(f, e2, "practical");
  await saved(f, practical.id);
  const key = randomUUID(),
    payload = { revision: 2 };
  const results = await Promise.all([
    f.call("learner-1", `/attempts/${practical.id}/submit`, payload, 200, key),
    f.call("learner-1", `/attempts/${practical.id}/submit`, payload, 200, key),
  ]);
  assert.deepEqual(results[0], results[1]);
  const s = f.store.snapshot();
  assert.equal(s.completions.length, 2);
  assert.equal(s.certifications.length, 1);
  await f.call(
    "learner-1",
    `/attempts/${practical.id}/submit`,
    { revision: 3 },
    409,
    key,
  );
  await f.restart();
  assert.deepEqual(
    await f.call(
      "learner-1",
      `/attempts/${practical.id}/submit`,
      payload,
      200,
      key,
    ),
    results[0],
  );
  assert.equal(f.store.snapshot().certifications.length, 1);
});

test("저장 충돌·파일 저장 실패·동일 요청 복구", async (t) => {
  const f = await fixture(t),
    a = await start(f, "assignment-1:demo-course-2", "objective");
  await f.call(
    "learner-1",
    `/attempts/${a.id}/draft`,
    { revision: 1, answers: { "d2-q1": 0 } },
    200,
    randomUUID(),
    "PUT",
  );
  await f.call(
    "learner-1",
    `/attempts/${a.id}/draft`,
    { revision: 1, answers: { "d2-q1": 1 } },
    409,
    randomUUID(),
    "PUT",
  );
  await saved(f, a.id);
  const before = f.store.snapshot(),
    disk = await readFile(f.file, "utf8"),
    key = randomUUID(),
    payload = { revision: 3 };
  f.store.beforeReplace = () => {
    throw new Error("simulated disk failure");
  };
  await f.call("learner-1", `/attempts/${a.id}/submit`, payload, 503, key);
  assert.deepEqual(f.store.snapshot(), before);
  assert.equal(await readFile(f.file, "utf8"), disk);
  f.store.beforeReplace = undefined;
  await f.call("learner-1", `/attempts/${a.id}/submit`, payload, 200, key);
  assert.equal(
    f.store
      .snapshot()
      .attempts.filter((t) => t.id === a.id && t.status === "graded").length,
    1,
  );
});

test("기준 버전 계보·사용 등록 검증·고정·공지 영속 저장", async (t) => {
  const f = await fixture(t);
  const recipe = f.store
    .snapshot()
    .courses.find((c) => c.id === "recipe-edit")!;
  await f.call(
    "admin-1",
    "/courses/recipe-edit",
    recipe,
    200,
    undefined,
    "PUT",
  );
  const original = f.store.snapshot().courses[0]!;
  await f.call(
    "admin-1",
    `/courses/${original.id}`,
    original,
    200,
    randomUUID(),
    "PUT",
  );
  const v2 = await f.call("admin-1", `/courses/${original.id}/versions`, {}),
    v3 = await f.call("admin-1", `/courses/${original.id}/versions`, {});
  const s = f.store.snapshot();
  assert.equal(s.courses.find((c) => c.id === v2.id)!.version, 2);
  assert.equal(s.courses.find((c) => c.id === v3.id)!.version, 3);
  const draft = s.courses.find((c) => c.id === v2.id)!;
  await f.call(
    "admin-1",
    `/courses/${v2.id}`,
    {
      ...draft,
      materials: [
        {
          id: "url",
          type: "url",
          title: "매뉴얼",
          url: "https://example.com/manual",
          content: "",
          description: "",
        },
      ],
    },
    undefined,
    undefined,
    "PUT",
  );
  assert.equal(f.store.snapshot().enrollments[0]!.courseId, original.id);
  await f.call("admin-1", "/notices", {
    title: "새 공지",
    body: "내용",
    published: true,
  });
  await f.restart();
  assert.ok(
    (await f.call("learner-1", "/notices")).some(
      (n: any) => n.title === "새 공지",
    ),
  );
});

test("검증 제외 후 원본 보존과 모든 새 처리 차단", async (t) => {
  const f = await fixture(t),
    attempt = await start(f, eid, "practical");
  await saved(f, attempt.id);
  const before = f.store.snapshot();
  await f.call("admin-1", "/assignments/assignment-1/exclusion", {
    revision: 1,
    reason: "잘못된 배정",
  });
  await f.call(
    "learner-1",
    `/attempts/${attempt.id}/submit`,
    { revision: 2 },
    409,
  );
  await f.call(
    "learner-1",
    `/enrollments/${encodeURIComponent(eid)}/attempts`,
    { kind: "practical" },
    409,
  );
  const after = f.store.snapshot();
  assert.deepEqual(after.attempts, before.attempts);
  assert.deepEqual(after.completions, before.completions);
  assert.equal((await f.call("learner-1", "/home")).assignments.length, 0);
  assert.equal(
    (await f.call("admin-1", "/assignments/assignment-1/results")).assignment
      .excludedReason,
    "잘못된 배정",
  );
});

test("정확한 합격 경계와 반올림 독립 판정", async (t) => {
  const f = await fixture(t, (s) => {
    for (const score of [66, 67]) {
      const c: Course = {
        ...structuredClone(s.courses[0]!),
        id: `boundary-${score}`,
        entityId: `boundary-${score}`,
        assessmentKinds: ["objective"],
        passScore: score,
      };
      c.questions[0]!.points = 2;
      c.questions[1]!.points = 1;
      s.courses.push(c);
      s.qualifications.push({
        templateId: "rounding-fixture",
        templateRevision: 1,
        englishName: "",
        description: "검증용 직무 수행 기준",
        validity: { type: "unlimited", months: null, reminderDays: [] },
        lv1OrganizationId: "org-photo",
        id: `q-${score}`,
        entityId: `q-${score}`,
        title: "경계 시험",
        version: 1,
        revision: 1,
        courseIds: [c.id],
      });
    }
    linkFixtureTemplates(s);
  });
  for (const score of [66, 67]) {
    const a = await planAssignment(f, "admin-1", {
      qualificationId: `q-${score}`,
      learnerId: "learner-2",
      ftId: null,
    });
    const e = f.store
      .snapshot()
      .enrollments.find((e) => e.assignmentId === a.id)!;
    const t = await start(f, e.id, "objective", "learner-2");
    await f.call(
      "learner-2",
      `/attempts/${t.id}/draft`,
      { revision: 1, answers: { "d1-q1": 0, "d1-q2": 0 } },
      200,
      randomUUID(),
      "PUT",
    );
    const result = await submit(f, t.id);
    assert.equal(result.result, score === 66 ? "passed" : "failed");
  }
});

test("전체 진행 초기화·설정 보존·사전 백업·재시도·첫 회차 재시작", async (t) => {
  const f = await fixture(t);
  const practical = await start(f, eid, "practical");
  await saved(f, practical.id);

  await saved(f, practical.id, true, "ft-2");
  await submit(f, practical.id, "ft-2");
  await finish(f, "assignment-1:demo-course-2", "objective");
  await finish(
    f,
    "assignment-1:demo-course-2",
    "practical",
    true,
    "learner-1",
    "ft-2",
  );
  const original = f.store.snapshot();
  assert.equal(original.certifications.length, 1);
  assert.ok(original.attempts.length > 0);
  const preview = await f.call("operator-1", "/testing/progress?scope=all");
  assert.deepEqual(preview.counts, {
    renewals: 0,
    certificationPeriods: 1,
    credentialEvents: 1,
    objectiveAttempts: 2,
    practicalAttempts: 3,
    learningRecords: 0,
    notifications: 3,
    completions: 2,
    certifications: 1,
    comparisons: 0,
  });
  const key = randomUUID(),
    body = {
      revision: preview.revision,
      confirmation: "초기화",
      scope: { type: "all" },
    };
  const reset = await f.call(
    "operator-1",
    "/testing/progress/reset",
    body,
    200,
    key,
  );
  const cleared = f.store.snapshot();
  for (const field of [
    "attempts",
    "completions",
    "certifications",
    "comparisons",
  ] as const)
    assert.deepEqual(cleared[field], []);
  for (const field of [
    "users",
    "courses",
    "qualifications",
    "assignments",
    "enrollments",
    "notices",
  ] as const)
    assert.deepEqual(cleared[field], original[field]);
  assert.equal(
    cleared.requests.filter((r) => r.action === "progress.reset").length,
    1,
  );
  assert.ok(
    cleared.requests.every(
      (r) =>
        !r.action?.startsWith("attempt.") &&
        !r.action?.startsWith("comparison."),
    ),
  );
  assert.ok(cleared.audits.some((a) => a.action === "progress.reset"));
  assert.ok(
    cleared.audits.every(
      (a) =>
        !a.action.startsWith("attempt.") &&
        !a.action.startsWith("comparison.") &&
        !a.details.archivedDrafts,
    ),
  );
  const backups = (await readdir(f.store.backupDir)).filter((name) =>
    name.startsWith("before-reset-"),
  );
  assert.equal(backups.length, 1);
  assert.deepEqual(
    JSON.parse(
      await readFile(path.join(f.store.backupDir, backups[0]!), "utf8"),
    ),
    original,
  );
  await f.call(
    "ft-2",
    `/attempts/${practical.id}/submit`,
    { revision: 1 },
    404,
  );
  const fresh = await start(f, eid, "objective");
  assert.notEqual(fresh.id, practical.id);
  assert.equal(f.store.snapshot().attempts[0]!.round, 1);
  // A delayed retry of the reset must not clear the newly started attempt.
  assert.deepEqual(
    await f.call("operator-1", "/testing/progress/reset", body, 200, key),
    reset,
  );
  assert.equal(f.store.snapshot().attempts.length, 1);
  await f.restart();
  assert.equal(f.store.snapshot().attempts[0]!.id, fresh.id);
});

test("진행 초기화의 운영자 권한·명시적 확인·동시 변경 검사", async (t) => {
  const f = await fixture(t);
  const preview = await f.call("operator-1", "/testing/progress?scope=all");
  const body = {
    revision: preview.revision,
    confirmation: "초기화",
    scope: { type: "all" },
  };
  for (const actor of ["learner-1", "ft-1", "admin-1"]) {
    await f.call(actor, "/testing/progress?scope=all", undefined, 403);
    await f.call(actor, "/testing/progress/reset", body, 403);
  }
  await f.call(
    "operator-1",
    "/testing/progress/reset",
    { ...body, confirmation: "" },
    422,
  );
  const pending = await start(f, eid, "practical");
  await f.call("operator-1", "/testing/progress/reset", body, 409);
  assert.ok(f.store.snapshot().attempts.some((a) => a.id === pending.id));
  assert.ok(
    !(await readdir(f.store.backupDir)).some((name) =>
      name.startsWith("before-reset-"),
    ),
  );
});

test("초기화 전 백업 실패 시 진행 내역 보존", async (t) => {
  const f = await fixture(t);
  const original = f.store.snapshot();
  await mkdir(path.dirname(f.store.backupDir), { recursive: true });
  await writeFile(f.store.backupDir, "백업 경로 장애 시험");
  await f.call(
    "operator-1",
    "/testing/progress/reset",
    {
      revision: original.revision,
      confirmation: "초기화",
      scope: { type: "all" },
    },
    503,
  );
  assert.deepEqual(f.store.snapshot(), original);
  assert.deepEqual(JSON.parse(await readFile(f.file, "utf8")), original);
});

test("저장소 잠금·손상 중단·백업 복구·잘못된 근거 파일 거부", async (t) => {
  const f = await fixture(t);
  await assert.rejects(new JsonStore(f.file).load(), /잠겨/);
  const backup = await f.store.backup();
  const original = f.store.snapshot();
  await f.stop();
  await writeFile(f.file, "broken json");
  await assert.rejects(new JsonStore(f.file).load(), /열 수 없습니다/);
  assert.equal(await readFile(f.file, "utf8"), "broken json");
  await new JsonStore(f.file).restore(backup);
  const restored = await new JsonStore(f.file).load();
  assert.deepEqual(restored.snapshot(), original);
  await restored.close();
  const corrupt = structuredClone(original);
  corrupt.attempts[0]!.learnerId = "learner-2";
  assert.throws(() => validateState(corrupt), /무결성/);
  const malformed = structuredClone(original);
  malformed.courses[0]!.questions[0]!.correct = 99;
  assert.throws(() => validateState(malformed), /무결성|정답/);
  assert.ok(
    (await readdir(path.dirname(backup))).some((n) =>
      n.startsWith("before-restore"),
    ),
  );
});
