import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  mkdir,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { seedState } from "../src/seed.ts";
import { seedOrganizations, userView } from "../src/organizations.ts";
import { JsonStore } from "../src/storage.ts";
import { buildApp } from "../src/app.ts";
import { migrateAdministration } from "../src/administration-migration.ts";
import { workspace } from "../src/domain.ts";

const own = "org-photo-pyeongtaek-1",
  root = "org-photo";
async function fixture(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-administration-")),
    file = path.join(dir, "runtime", "state.json");
  const seed = seedState(true);
  for (const id of ["learner-2", "ft-1"])
    seed.users.find((u) => u.id === id)!.organizationId = own;
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
    status = 200,
    method: any = body === undefined ? "GET" : "POST",
    key = randomUUID(),
  ) {
    if (!cookies.has(actor)) {
      const login = await app.inject({
        method: "POST",
        url: "/api/session",
        payload: { actorId: actor },
      });
      cookies.set(
        actor,
        `${login.cookies[0]!.name}=${login.cookies[0]!.value}`,
      );
    }
    const result = await app.inject({
      method,
      url: "/api" + url,
      headers: { cookie: cookies.get(actor)!, "idempotency-key": key },
      ...(body === undefined ? {} : { payload: body }),
    });
    assert.equal(
      result.statusCode,
      status,
      `${actor} ${method} ${url}: ${result.body}`,
    );
    return result.json();
  }
  const grantBody = (ids: string[]) => ({
    revision: store.snapshot().revision,
    organizationRevision: store.organizations.snapshot().revision,
    userIds: ids,
  });
  const grant = (
    ids: string[],
    status = 200,
    actor = "admin-1",
    target = own,
  ) =>
    call(
      actor,
      `/organization-policies/${target}/administrators`,
      grantBody(ids),
      status,
      "PUT",
    );
  const policy = () => ({
    revision: store.organizations.snapshot().revision,
    description: "설비 검증 조직",
    duties: "설정 관리",
    requiredQualifications: [],
  });
  return { store, app, call, grant, grantBody, policy, file, dir };
}

test("복수 세부 관리자 지정·소속 조직 한 곳 설정·팀 후보 및 다른 관리 API 차단", async (t) => {
  const { store, call, grant, policy } = await fixture(t);
  const before = store.snapshot().users.find((u) => u.id === "learner-2")!;
  await grant(["learner-2", "ft-1"]);
  const actor = (await call("learner-2", "/session")).actor;
  assert.deepEqual(actor.roles, ["learner", "organization_admin"]);
  assert.equal(actor.revision, before.revision + 1);
  const view = await call("learner-2", "/organization-policies");
  assert.deepEqual(
    view.entries.map((e: any) => e.id),
    [own],
  );
  assert.equal(view.canManagePool, false);
  await call(
    "learner-2",
    `/organization-policies/${own}`,
    policy(),
    200,
    "PUT",
  );
  for (const target of [
    root,
    "org-photo-pyeongtaek",
    "org-photo-pyeongtaek-2",
    "org-etch",
  ])
    await call(
      "learner-2",
      `/organization-policies/${target}`,
      policy(),
      403,
      "PUT",
    );
  await call(
    "learner-2",
    `/organization-policies/${root}/qualification-pool`,
    { revision: store.organizations.snapshot().revision, qualificationIds: [] },
    403,
    "PUT",
  );
  await grant([], 403, "learner-2");
  for (const [url, body, method] of [
    ["/courses", {}, "POST"],
    ["/planning-requests", {}, "POST"],
    ["/notices", {}, "POST"],
    ["/system/users", {}, "POST"],
    ["/system/organizations", undefined, "GET"],
    ["/catalog/workbook-template", undefined, "GET"],
  ] as const)
    await call("learner-2", url, body, 403, method);
  const ws = await call("learner-2", "/workspace");
  assert.equal(ws.management.canManage, false);
  assert.equal(ws.management.canManagePolicies, true);
  assert.deepEqual(ws.management.editableOrganizationIds, [own]);
  assert.equal(ws.assignments.length, 0);
  assert.equal(ws.comparisons.length, 0);
  assert.equal(ws.audits.length, 0);
  assert(
    ws.courses.every((c: any) =>
      [...c.questions, ...c.practicalQuestions].every(
        (q: any) => q.correct === undefined,
      ),
    ),
  );
  const administrators = await call(
    "learner-2",
    `/organization-policies/${own}/administrators`,
  );
  assert.equal(administrators.candidates.length, 2);
  await call(
    "learner-2",
    `/organization-policies/${root}/administrators`,
    undefined,
    403,
  );
  await grant(["learner-2"]);
  assert.deepEqual((await call("ft-1", "/session")).actor.roles, ["learner"]);
  await grant([]);
  await call(
    "learner-2",
    `/organization-policies/${own}`,
    policy(),
    403,
    "PUT",
  );
});

test("관리자 후보와 저장은 정확한 소속만 사용하고 부모·자식·형제 구성원을 제외", async (t) => {
  const { store, call, grant } = await fixture(t);
  const child = await call("operator-1", "/system/organizations", {
    revision: store.organizations.snapshot().revision,
    parentId: own,
    name: "하위 검증 조직",
  });
  const outsiders: string[] = [];
  for (const organizationId of [
    "org-photo-pyeongtaek",
    child.id,
    "org-photo-pyeongtaek-2",
    "org-etch",
  ]) {
    const user = await call("operator-1", "/system/users", {
      name: `외부 소속 ${organizationId}`,
      roles: ["learner"],
      organizationId,
    });
    outsiders.push(user.id);
  }
  const candidates = await call(
    "admin-1",
    `/organization-policies/${own}/administrators`,
  );
  assert.deepEqual(candidates.candidates.map((u: any) => u.id).sort(), [
    "ft-1",
    "learner-2",
  ]);
  const before = store.snapshot();
  for (const id of outsiders) {
    await grant(["learner-2", id], 422);
    assert.deepEqual(store.snapshot(), before);
  }
  await grant(["learner-2", "ft-1"]);
  assert.equal(
    store.snapshot().users.filter((u) => u.organizationAdministration).length,
    2,
  );
});

test("지정 대상·revision·중복 요청·권한 회수·백업 실패를 원자적으로 검사", async (t) => {
  const { store, call, grant, grantBody, policy } = await fixture(t);
  await grant(["learner-1"], 422);
  const body = grantBody(["learner-2"]),
    key = randomUUID(),
    url = `/organization-policies/${own}/administrators`;
  const first = await call("admin-1", url, body, 200, "PUT", key),
    state = store.snapshot();
  assert.deepEqual(await call("admin-1", url, body, 200, "PUT", key), first);
  assert.deepEqual(store.snapshot(), state);
  await call("admin-1", url, { ...body, userIds: [] }, 409, "PUT", key);
  await call("admin-1", url, body, 409, "PUT");
  store.beforeReplace = () => {
    throw new Error("backup/save failure");
  };
  await grant([], 503);
  assert.deepEqual(store.snapshot(), state);
  store.beforeReplace = undefined;
  const user = store.snapshot().users.find((u) => u.id === "learner-2")!;
  await call(
    "operator-1",
    `/system/users/${user.id}`,
    {
      name: user.name,
      roles: user.roles,
      organizationId: "org-photo-pyeongtaek-2",
      revision: user.revision,
    },
    200,
    "PATCH",
  );
  const moved = store.snapshot().users.find((u) => u.id === user.id)!;
  assert.equal(moved.organizationAdministration, undefined);
  assert.deepEqual(moved.roles, ["learner"]);
  await call(
    "learner-2",
    `/organization-policies/${own}`,
    policy(),
    403,
    "PUT",
  );
  assert(
    store
      .snapshot()
      .audits.some(
        (a) =>
          a.action === "organization.administrator.revoke" &&
          a.reason.includes("소속 이동"),
      ),
  );
  await grant(["learner-2"], 422);
});

test("관리자 지정의 사전 백업 경로가 실패하면 역할·파일·요청 이력을 변경하지 않는다", async (t) => {
  const { store, grant, file } = await fixture(t);
  const before = store.snapshot(),
    bytes = await readFile(file);
  await mkdir(path.dirname(store.backupDir), { recursive: true });
  await writeFile(store.backupDir, "backup unavailable");
  await grant(["learner-2"], 503);
  assert.deepEqual(store.snapshot(), before);
  assert.deepEqual(await readFile(file), bytes);
});

test("Lv1 직속 세부 관리자도 팀 전체 권한을 갖지 않으며 복수 역할 순서와 운영자 대상 검사를 유지", async (t) => {
  const { store, call, grantBody, grant } = await fixture(t);
  await grant(["learner-1"], 200, "admin-1", root);
  assert.deepEqual(
    (await call("learner-1", "/organization-policies")).entries.map(
      (e: any) => e.id,
    ),
    [root],
  );
  await call(
    "admin-1",
    "/organization-policies?lv1OrganizationId=org-etch",
    undefined,
    403,
  );
  await call(
    "operator-1",
    `/organization-policies/${own}/administrators`,
    grantBody([]),
    403,
    "PUT",
  );
  await call(
    "operator-1",
    `/organization-policies/${own}/administrators?lv1OrganizationId=org-etch`,
    grantBody([]),
    403,
    "PUT",
  );
  await call(
    "operator-1",
    `/organization-policies/${own}/administrators?lv1OrganizationId=org-photo`,
    grantBody(["ft-1"]),
    200,
    "PUT",
  );
  const s = store.snapshot(),
    doc = store.organizations.snapshot(),
    user = s.users.find((u) => u.id === "admin-1")!;
  const a = workspace(
    s,
    userView({ ...user, roles: ["learner", "admin"] }, doc),
    doc,
  );
  const b = workspace(
    s,
    userView({ ...user, roles: ["admin", "learner"] }, doc),
    doc,
  );
  assert.deepEqual(a.management, b.management);
  assert.deepEqual(a.assignments, b.assignments);
});

test("시스템 공지 전 조직 공개·팀 공지 소속 격리·초안 비공개·대상 변조 및 충돌 차단", async (t) => {
  const { call, store } = await fixture(t);
  const data = {
    title: "전체 안내",
    body: "전 조직 공통 안내\n두 번째 문단",
    published: true,
  };
  await call("admin-1", "/system/notices", data, 403);
  await call("learner-2", "/system/notices", undefined, 403);
  const system = await call("operator-1", "/system/notices", data);
  await call("operator-1", "/system/notices", {
    ...data,
    title: "미게시 시스템",
    published: false,
  });
  await call("admin-1", "/notices", { ...data, title: "Photo 공지" });
  await call("operator-1", "/notices?lv1OrganizationId=org-etch", {
    ...data,
    title: "Etch 공지",
  });
  await call("admin-1", "/notices", {
    ...data,
    title: "미게시 팀",
    published: false,
  });
  const ws = await call("operator-1", "/workspace?lv1OrganizationId=org-etch");
  assert(ws.notices.some((n: any) => n.title === "Etch 공지"));
  assert(ws.homeNotices.some((n: any) => n.title === "Photo 공지"));
  assert(!ws.homeNotices.some((n: any) => /Etch|미게시/.test(n.title)));
  assert(ws.homeNotices.some((n: any) => n.id === system.id));
  const home = await call("learner-2", "/home");
  assert(home.notices.some((n: any) => n.id === system.id));
  assert(!home.notices.some((n: any) => /Etch|미게시/.test(n.title)));
  await call(
    "admin-1",
    "/notices",
    { ...data, id: system.id, revision: system.revision },
    403,
  );
  await call("admin-1", "/notices", { ...data, scope: "system" }, 422);
  await call(
    "admin-1",
    "/notices",
    { ...data, lv1OrganizationId: "org-etch" },
    403,
  );
  const updated = await call("operator-1", "/system/notices", {
    ...data,
    id: system.id,
    revision: system.revision,
    title: "개정 안내",
  });
  assert.equal(updated.revision, 2);
  await call(
    "operator-1",
    "/system/notices",
    { ...data, id: system.id, revision: system.revision },
    409,
  );
  assert.equal(
    store.snapshot().notices.find((n) => n.id === system.id)?.lv1OrganizationId,
    undefined,
  );
});

test("진행 초기화는 세부 관리자 지정·두 공지 종류를 보존", async (t) => {
  const { call, store, grant } = await fixture(t);
  await grant(["learner-2"]);
  await call("operator-1", "/system/notices", {
    title: "보존 공지",
    body: "공지 본문",
    published: true,
  });
  const before = store.snapshot();
  const preview = await call("operator-1", "/testing/progress?scope=all");
  await call("operator-1", "/testing/progress/reset", {
    revision: preview.revision,
    confirmation: "초기화",
    scope: { type: "all" },
  });
  const after = store.snapshot();
  assert.deepEqual(after.users, before.users);
  assert.deepEqual(after.notices, before.notices);
});

test("7→8 이관은 기존 기록·조직 바이트 보존, 백업 쌍·재실행 무변경·해시 변경 거부", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-admin-migration-")),
    file = path.join(dir, "runtime", "state.json"),
    store = new JsonStore(file);
  t.after(() => rm(dir, { recursive: true, force: true }));
  const raw: any = seedState(true);
  raw.schemaVersion = 7;
  for (const n of raw.notices) delete n.scope;
  await mkdir(path.dirname(file), { recursive: true });
  await mkdir(path.dirname(store.organizations.file), { recursive: true });
  await writeFile(file, JSON.stringify(raw));
  await writeFile(
    store.organizations.file,
    JSON.stringify(seedOrganizations()),
  );
  const hash = (v: Buffer) => createHash("sha256").update(v).digest("hex");
  const original = await readFile(file),
    org = await readFile(store.organizations.file),
    expected = {
      revision: raw.revision,
      stateHash: hash(original),
      organizationHash: hash(org),
    };
  await assert.rejects(
    store.migratePolicies(
      { ...expected, stateHash: "wrong" },
      migrateAdministration,
      "administration",
    ),
  );
  store.beforeReplace = () => {
    throw new Error("replace failure");
  };
  await assert.rejects(
    store.migratePolicies(expected, migrateAdministration, "administration"),
  );
  assert.deepEqual(await readFile(file), original);
  assert.deepEqual(await readFile(store.organizations.file), org);
  store.beforeReplace = undefined;
  await store.migratePolicies(
    expected,
    migrateAdministration,
    "administration",
  );
  const after = JSON.parse(await readFile(file, "utf8"));
  assert.equal(after.schemaVersion, 13);
  assert.equal(after.revision, raw.revision + 6);
  for (const key of [
    "users",
    "plans",
    "assignments",
    "attempts",
    "completions",
    "certifications",
    "courses",
    "qualifications",
  ])
    assert.deepEqual(
      after[key].map((r: any) => {
        const copy = { ...r };
        delete copy.certificationEligibility;
        delete copy.lifecycleStatus;
        delete copy.renewalLeadMonths;
        delete copy.renewalNoticeDaysBefore;
        delete copy.acquisitionCycleId;
        return copy;
      }),
      raw[key].map((r: any) => {
        const copy = { ...r };
        delete copy.certificationEligibility;
        delete copy.lifecycleStatus;
        delete copy.renewalLeadMonths;
        delete copy.renewalNoticeDaysBefore;
        delete copy.acquisitionCycleId;
        return copy;
      }),
    );
  assert(after.notices.every((n: any) => n.scope === "team"));
  assert.deepEqual(await readFile(store.organizations.file), org);
  const backups = await readdir(store.backupDir),
    bytes = await readFile(file);
  await store.migratePolicies(
    { ...expected, revision: after.revision, stateHash: hash(bytes) },
    migrateAdministration,
    "administration",
  );
  assert.deepEqual(await readFile(file), bytes);
  assert.deepEqual(await readdir(store.backupDir), backups);
  assert((await readdir(store.organizations.backupDir)).length > 0);
});
