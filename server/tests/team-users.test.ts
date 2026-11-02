import { saveTemplate } from "../src/qualification-templates.ts";
import { executeWorkflow as mutate } from "../src/workflow.ts";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { organizationEntries } from "@eks/contracts";
import { JsonStore } from "../src/storage.ts";
import { seedState } from "../src/seed.ts";
import { seedOrganizations, userView } from "../src/organizations.ts";
import { buildApp } from "./release-test-app.ts";
import { saveAuditorProgram } from "../src/auditor-program.ts";

async function fixture(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-team-users-")),
    file = path.join(dir, "runtime/state.json");
  const seed = seedState(true),
    doc = seedOrganizations();
  const leaf = "test-level-5";
  doc.roots[0]!.children.push({
    id: "test-level-2",
    name: "시험 하위2",
    active: true,
    children: [
      {
        id: "test-level-3",
        name: "시험 하위3",
        active: true,
        children: [
          {
            id: "test-level-4",
            name: "시험 하위4",
            active: true,
            children: [
              { id: leaf, name: "시험 하위5", active: true, children: [] },
            ],
          },
        ],
      },
    ],
  });
  seed.users.push(
    {
      id: "leaf-member",
      name: "최하위 구성원",
      roles: ["learner"],
      organizationId: leaf,
      revision: 1,
    },
    {
      id: "outsider",
      name: "다른 팀",
      roles: ["learner"],
      organizationId: "org-etch",
      revision: 1,
    },
    {
      id: "detail-user",
      name: "세부 관리자",
      roles: ["learner"],
      organizationId: leaf,
      revision: 1,
      organizationAdministration: {
        organizationId: leaf,
        grantedBy: "admin-1",
        grantedAt: new Date().toISOString(),
      },
    },
  );
  const orgFile = path.join(dir, "master/organizations.json");
  await mkdir(path.dirname(orgFile), { recursive: true });
  await writeFile(orgFile, JSON.stringify(doc));
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
    assert.equal(r.statusCode, status, `${url}: ${r.body}`);
    return r.json();
  }
  const input = (id?: string, overrides: any = {}) => {
    const u = store.snapshot().users.find((u) => u.id === id);
    return {
      name: u?.name || "새 구성원",
      organizationId: u?.organizationId || leaf,
      roles: ["learner"],
      organizationRevision: store.organizations.snapshot().revision,
      ...(u ? { revision: u.revision } : {}),
      ...overrides,
    };
  };
  const update = (fn: (s: ReturnType<typeof seedState>) => void) =>
    store.transact(
      "operator-1",
      randomUUID(),
      randomUUID(),
      () => {},
      (s) => {
        fn(s);
        return {};
      },
    );
  return { store, app, call, input, update, file, leaf };
}

test("팀 직속·최하위 구성원 조회/추가/이동과 다른 팀·세부 관리자·운영자 수정 차단", async (t) => {
  const f = await fixture(t),
    view = await f.call("admin-1", "/team-users");
  assert(view.users.some((u: any) => u.id === "leaf-member"));
  assert(view.users.some((u: any) => u.id === "admin-1"));
  assert(!view.users.some((u: any) => u.id === "outsider"));
  assert(
    view.organizations.entries.every(
      (o: any) => o.lv1OrganizationId === "org-photo",
    ),
  );
  assert.equal(
    view.users.find((u: any) => u.id === "operator-1").canEdit,
    false,
  );
  assert.deepEqual(view.editableRoles, ["learner", "evaluator"]);
  const created = await f.call("admin-1", "/team-users", f.input());
  await f.call(
    "admin-1",
    "/team-users/" + created.id,
    f.input(created.id, { organizationId: "org-photo" }),
    200,
    "PATCH",
  );
  assert.equal(
    f.store.snapshot().users.find((u) => u.id === created.id)!.organizationId,
    "org-photo",
  );
  for (const who of ["detail-user", "learner-1"]) {
    await f.call(who, "/team-users", undefined, 403);
    await f.call(who, "/team-users", f.input(), 403);
  }
  await f.call(
    "admin-1",
    "/team-users?lv1OrganizationId=org-etch",
    undefined,
    403,
  );
  await f.call(
    "admin-1",
    "/team-users/outsider",
    f.input("outsider"),
    403,
    "PATCH",
  );
  await f.call(
    "admin-1",
    "/team-users",
    f.input(undefined, { organizationId: "org-etch" }),
    403,
  );
  for (const who of ["admin-1", "operator-1"]) {
    const result = await f.call(
      who,
      "/team-users/operator-1?lv1OrganizationId=org-photo",
      f.input("operator-1"),
      403,
      "PATCH",
    );
    assert.equal(result.code, "TEAM_USER_READ_ONLY");
  }
  await f.call("operator-1", "/team-users", undefined, 403);
  const other = await f.call(
    "operator-1",
    "/team-users?lv1OrganizationId=org-etch",
  );
  assert.deepEqual(
    other.users.map((u: any) => u.id),
    ["outsider"],
  );
});

test("역할 위조 금지·기존 팀 관리자 유지·현재 사용자/조직 revision과 권한 재검사", async (t) => {
  const f = await fixture(t);
  for (const role of ["admin", "system_operator", "organization_admin"]) {
    const before = await readFile(f.file);
    const result = await f.call(
      "admin-1",
      "/team-users",
      f.input(undefined, { roles: [role] }),
      403,
    );
    assert.equal(result.code, "TEAM_USER_ROLE_FORBIDDEN");
    assert.deepEqual(await readFile(f.file), before);
  }
  await f.call(
    "admin-1",
    "/team-users/admin-1",
    f.input("admin-1", { roles: [] }),
    200,
    "PATCH",
  );
  assert.deepEqual(
    f.store.snapshot().users.find((u) => u.id === "admin-1")!.roles,
    ["admin"],
  );
  await f.call(
    "admin-1",
    "/team-users",
    f.input(undefined, { roles: [] }),
    422,
  );
  const body = f.input("leaf-member"),
    key = randomUUID();
  const results = await Promise.all([
    f.call("admin-1", "/team-users/leaf-member", body, 200, "PATCH", key),
    f.call("admin-1", "/team-users/leaf-member", body, 200, "PATCH", key),
  ]);
  assert.deepEqual(results[0], results[1]);
  await f.call("admin-1", "/team-users/leaf-member", body, 409, "PATCH");
  await f.call(
    "admin-1",
    "/team-users/leaf-member",
    { ...body, name: "다른 내용" },
    409,
    "PATCH",
    key,
  );
  const stale = f.input();
  await f.store.organizations.transact(
    "operator-1",
    randomUUID(),
    randomUUID(),
    () => {},
    () => ({}),
  );
  await f.call("admin-1", "/team-users", stale, 409);
  const assignment = f.store
    .snapshot()
    .assignments.find((a) => a.learnerId === "learner-1");
  assert(assignment);
  await f.call(
    "admin-1",
    "/team-users/learner-1",
    f.input("learner-1", { roles: ["evaluator"] }),
    409,
    "PATCH",
  );
  const past = f.store.snapshot().assignments;
  await f.call(
    "admin-1",
    "/team-users/detail-user",
    f.input("detail-user", { organizationId: "org-photo" }),
    200,
    "PATCH",
  );
  assert.equal(
    f.store.snapshot().users.find((u) => u.id === "detail-user")!
      .organizationAdministration,
    undefined,
  );
  assert.deepEqual(f.store.snapshot().assignments, past);
  await f.update((s) => {
    s.users.find((u) => u.id === "admin-1")!.roles = ["learner"];
  });
  await f.call("admin-1", "/team-users/leaf-member", body, 403, "PATCH", key);
});

test("팀 사용자 편집은 개인 Auditor 부여를 거부한다", async (t) => {
  const f = await fixture(t),
    before = await readFile(f.file);
  await f.call(
    "admin-1",
    "/team-users/leaf-member",
    f.input("leaf-member", { roles: ["learner", "evaluator"] }),
    422,
    "PATCH",
  );
  assert.deepEqual(await readFile(f.file), before);
  await f.call(
    "admin-1",
    "/team-users/leaf-member",
    f.input("leaf-member", { name: "이름 수정" }),
    200,
    "PATCH",
  );
  assert.equal(
    f.store
      .snapshot()
      .notifications.filter((n) => n.type === "auditor_designation").length,
    0,
  );
});
