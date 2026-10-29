import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { seedState } from "../src/seed.ts";
import { seedOrganizations, changeOrganization } from "../src/organizations.ts";
import { effectiveRequirements } from "../src/organization-requirements.ts";
import { JsonStore } from "../src/storage.ts";
import { buildApp } from "../src/app.ts";
import {
  resolveRequirementRules,
  type RequirementChange,
} from "@eks/contracts";
import { migrateRequirementExceptions } from "../src/requirement-exception-migration.ts";
const root = "org-photo",
  group = "org-photo-fmg",
  part = "org-photo-pyeongtaek",
  leaf = "org-photo-pyeongtaek-1",
  q = "demo-qualification";
const rule = (
  organizationId: string,
  entityIds: string[] = [],
  excluded = false,
  removal = false,
): RequirementChange => ({
  organizationId,
  entityIds,
  exclusions: excluded
    ? [{ entityId: q, reason: "담당 업무에 해당하지 않음" }]
    : [],
  removalReasons: removal ? [{ entityId: q, reason: "담당 업무 변경" }] : [],
});
async function fixture(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-exceptions-")),
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
    who: string,
    url: string,
    body?: any,
    status = 200,
    method = "POST",
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
      method: body === undefined ? "GET" : (method as any),
      url: "/api" + url,
      headers: {
        cookie: cookies.get(who)!,
        "idempotency-key": key,
        "x-eks-release-contract": "3",
      },
      ...(body === undefined ? {} : { payload: body }),
    });
    assert.equal(r.statusCode, status, r.body);
    return r.json();
  }
  const body = (changes: RequirementChange[]) => ({
    contractVersion: 2,
    stateRevision: store.snapshot().revision,
    organizationRevision: store.organizations.snapshot().revision,
    changes,
  });
  const save = (changes: RequirementChange[], who = "admin-1", status = 200) =>
    call(
      who,
      "/organization-qualification-requirements",
      body(changes),
      status,
      "PUT",
    );
  const change = (fn: (s: ReturnType<typeof seedState>) => void) =>
    store.transact(
      "operator-1",
      randomUUID(),
      "fixture",
      () => {},
      (s) => {
        fn(s);
        return {};
      },
    );
  return { store, app, file, call, body, save, change };
}
test("제외는 누적 출처를 차단하고 아래 직접 지정부터 상속을 재시작한다", () => {
  const p = ["team", "group", "part", "leaf"].map((id) => ({ id, name: id }));
  const exclusion = {
    entityId: q,
    reason: "담당 범위",
    updatedBy: "admin-1",
    updatedAt: new Date().toISOString(),
  };
  const rules = new Map(
    p.map((o) => [
      o.id,
      { entityIds: [] as string[], exclusions: [] as (typeof exclusion)[] },
    ]),
  );
  rules.get("team")!.entityIds = [q];
  rules.get("group")!.exclusions = [exclusion];
  assert.equal(resolveRequirementRules(p, rules).sources.size, 0);
  rules.get("part")!.entityIds = [q];
  assert.deepEqual(
    resolveRequirementRules(p, rules)
      .sources.get(q)
      ?.map((s) => s.id),
    ["part"],
  );
  rules.get("leaf")!.exclusions = [exclusion];
  assert.equal(
    resolveRequirementRules(p, rules).excluded.get(q)?.organization.id,
    "leaf",
  );
  rules.get("leaf")!.exclusions = [];
  rules.get("part")!.entityIds = [];
  assert.equal(
    resolveRequirementRules(p, rules).excluded.get(q)?.organization.id,
    "group",
  );
  rules.get("team")!.entityIds = [];
  assert.equal(
    resolveRequirementRules(p, rules).excluded.get(q)?.hasInherited,
    false,
  );
  rules.get("team")!.entityIds = [q];
  assert.equal(
    resolveRequirementRules(p, rules).excluded.get(q)?.hasInherited,
    true,
  );
  rules.get("group")!.exclusions = [];
  rules.get("group")!.entityIds = [q];
  rules.get("part")!.exclusions = [exclusion];
  assert.deepEqual(
    resolveRequirementRules(p, rules)
      .excluded.get(q)
      ?.sourceOrganizations.map((o) => o.id),
    ["team", "group"],
  );
  assert.equal(resolveRequirementRules(p, rules).sources.size, 0);
  rules.get("leaf")!.entityIds = [q];
  assert.deepEqual(
    resolveRequirementRules(p, rules)
      .sources.get(q)
      ?.map((o) => o.id),
    ["leaf"],
  );
});
test("여러 조직의 최종 상속으로 검증하며 예외·직접 지정 전환과 잠재 예외를 보존한다", async (t) => {
  const f = await fixture(t);
  await f.save([rule(group, [], true), rule(root, [q])]);
  let v = await f.call("admin-1", "/organization-qualification-requirements");
  assert.equal(v.entries.find((e: any) => e.id === leaf).effective.length, 0);
  assert.equal(
    v.entries.find((e: any) => e.id === "org-photo-equipment").effective.length,
    1,
  );
  await f.save([rule(part, [q])]);
  v = await f.call("admin-1", "/organization-qualification-requirements");
  assert.deepEqual(
    v.entries
      .find((e: any) => e.id === leaf)
      .effective[0].sourceOrganizations.map((e: any) => e.id),
    [part],
  );
  await f.save([rule(part)]);
  await f.save([rule(root)]);
  v = await f.call("admin-1", "/organization-qualification-requirements");
  assert.equal(
    v.entries.find((e: any) => e.id === group).excluded[0].hasInherited,
    false,
  );
  await f.save([rule(root, [q])]);
  v = await f.call("admin-1", "/organization-qualification-requirements");
  assert.equal(v.entries.find((e: any) => e.id === group).effective.length, 0);
  await f.save([rule(group, [q], false, true)]);
  assert.equal(
    f.store
      .snapshot()
      .organizationQualificationRequirements.find(
        (r) => r.organizationId === group,
      )!.exclusions.length,
    0,
  );
  assert.ok(f.store.snapshot().audits.at(-1)?.details);
});
test("사유·범위·상호 배타·새 상속 여부를 검증하고 Hold 제외·복원을 허용한다", async (t) => {
  const f = await fixture(t);
  await f.save([rule(root, [q])]);
  await f.save([rule(root, [], true)], "admin-1", 422);
  await f.save(
    [{ ...rule(group, [], true), exclusions: [{ entityId: q, reason: "  " }] }],
    "admin-1",
    422,
  );
  await f.save([rule(group, [q], true)], "admin-1", 422);
  await f.save([rule("org-etch", [], true)], "admin-1", 403);
  await f.change((s) => {
    s.qualifications.find((x) => x.id === q)!.lifecycleStatus = "Hold";
  });
  await f.save([rule(group, [], true)]);
  await f.save([rule(group)], "admin-1", 422);
  await f.save([rule(group, [], false, true)]);
  const v = await f.call("admin-1", "/organization-qualification-requirements");
  assert.ok(
    v.entries.find((e: any) => e.id === group).effective[0].issues.length,
  );
  await f.save([rule(root)]);
  await f.save([rule(group, [], true)], "admin-1", 409);
});
test("세부 관리자는 본인과 하위 조직에 예외 설정하고 구형 요청은 영수증 전에 거부한다", async (t) => {
  const f = await fixture(t);
  await f.save([rule(root, [q])]);
  await f.change((s) => {
    const u = s.users.find((u) => u.id === "learner-2")!;
    u.organizationId = group;
    u.organizationAdministration = {
      organizationId: group,
      grantedBy: "admin-1",
      grantedAt: new Date().toISOString(),
    };
  });
  await f.save([rule(group, [], true)], "learner-2");
  const v = await f.call(
    "learner-2",
    "/organization-qualification-requirements",
  );
  assert.equal(v.entries.length, 9);
  assert.equal(v.ancestorRules[0].organization.id, root);
  await f.save([rule(part, [q])], "learner-2");
  await f.save([rule(root, [q])], "learner-2", 403);
  await f.save([rule(group, [], false, true)], "learner-1", 403);
  const body = f.body([rule(root, [q])]),
    key = randomUUID();
  await f.call(
    "admin-1",
    "/organization-qualification-requirements",
    body,
    200,
    "PUT",
    key,
  );
  const { contractVersion, ...old } = body;
  await f.call(
    "admin-1",
    "/organization-qualification-requirements",
    old,
    409,
    "PUT",
    key,
  );
  await f.call(
    "admin-1",
    "/organization-qualification-requirements/preview",
    old,
    409,
  );
});
test("예외 적용 후 새 요청만 달라지고 재지정 요청에는 당시 경로 규칙을 보존한다", async (t) => {
  const f = await fixture(t);
  await f.save([rule(root, [q])]);
  await f.change((s) => {
    s.users.find((u) => u.id === "learner-2")!.organizationId = leaf;
  });
  const request = async () => {
    const p = await f.call("admin-1", "/planning-requests/preview", {
      learnerIds: ["learner-2"],
    });
    return f.call("admin-1", "/planning-requests", {
      learnerIds: ["learner-2"],
      message: "",
      stateRevision: p.stateRevision,
      organizationRevision: p.organizationRevision,
      replaceRequestIds: [],
    });
  };
  await request();
  const old = structuredClone(f.store.snapshot().planningRequests);
  await f.save([rule(group, [], true)]);
  const preview = await f.call("admin-1", "/planning-requests/preview", {
    learnerIds: ["learner-2"],
  });
  assert.equal(preview.rows[0].status, "excluded");
  assert.deepEqual(f.store.snapshot().planningRequests, old);
  await f.save([rule(part, [q])]);
  await request();
  const next = f.store.snapshot().planningRequests.at(-1)!;
  assert.equal(next.requirementSnapshot?.ruleVersion, 2);
  assert.deepEqual(
    next.requirementSnapshot?.rules?.find((r) => r.organizationId === group)
      ?.excludedEntityIds,
    [q],
  );
  assert.deepEqual(
    next.requirementSnapshot?.sources[0]?.organizations.map((o) => o.id),
    [part],
  );
  const ws = await f.call("learner-2", "/workspace");
  assert.ok(!JSON.stringify(ws).includes("담당 업무에 해당하지 않음"));
});
test("다조직 예외 저장 실패는 원본을 보존하고 같은 키 재시도는 감사·예외를 중복 생성하지 않는다", async (t) => {
  const f = await fixture(t);
  await f.save([rule(root, [q])]);
  const body = f.body([
      rule(group, [], true),
      rule("org-photo-equipment", [], true),
    ]),
    before = f.store.snapshot(),
    key = randomUUID();
  f.store.beforeReplace = () => {
    throw Error("failure");
  };
  await f.call(
    "admin-1",
    "/organization-qualification-requirements",
    body,
    503,
    "PUT",
    key,
  );
  assert.deepEqual(f.store.snapshot(), before);
  f.store.beforeReplace = undefined;
  await f.call(
    "admin-1",
    "/organization-qualification-requirements",
    body,
    200,
    "PUT",
    key,
  );
  const saved = f.store.snapshot();
  await f.call(
    "admin-1",
    "/organization-qualification-requirements",
    body,
    200,
    "PUT",
    key,
  );
  assert.deepEqual(f.store.snapshot(), saved);
});
test("업무26→27은 빈 예외와 감사만 추가하며 실패·재이관·일반 시작 거부를 검증한다", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-exception-migrate-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "runtime/state.json"),
    store = new JsonStore(file),
    raw: any = seedState(true);
  raw.schemaVersion = 26;
  raw.organizationQualificationRequirements = [
    {
      organizationId: root,
      entityIds: [q],
      revision: 3,
      updatedBy: "admin-1",
      updatedAt: new Date().toISOString(),
    },
  ];
  await store.initialize(raw);
  const org = seedOrganizations(),
    before = structuredClone(raw),
    candidate = migrateRequirementExceptions(raw, org);
  assert.deepEqual(raw, before);
  assert.equal(candidate.state.revision, raw.revision + 2);
  assert.deepEqual(candidate.state.organizationQualificationRequirements[0], {
    ...raw.organizationQualificationRequirements[0],
    exclusions: [],
  });
  assert.deepEqual(
    migrateRequirementExceptions(candidate.state, org).state,
    candidate.state,
  );
  for (const key of Object.keys(before).filter(
    (k) =>
      ![
        "schemaVersion",
        "revision",
        "audits",
        "organizationQualificationRequirements",
      ].includes(k),
  ))
    assert.deepEqual((candidate.state as any)[key], before[key], key);
  await assert.rejects(
    new JsonStore(file).load(),
    /migrate-requirement-exceptions/,
  );
  const bytes = await readFile(file),
    orgBytes = await readFile(store.organizations.file),
    hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const expected = {
    revision: raw.revision,
    stateHash: hash(bytes),
    organizationHash: hash(orgBytes),
  };
  const transform = (a: unknown, b: unknown) =>
    migrateRequirementExceptions(a, b);
  store.beforeReplace = () => {
    throw Error("migration failure");
  };
  await assert.rejects(
    store.migratePolicies(expected, transform, "requirement-exceptions"),
  );
  assert.deepEqual(await readFile(file), bytes);
  assert.deepEqual(await readFile(store.organizations.file), orgBytes);
  store.beforeReplace = undefined;
  await store.migratePolicies(expected, transform, "requirement-exceptions");
  const after = await readFile(file),
    maintenance = await readFile(store.maintenanceFile);
  await store.migratePolicies(
    { ...expected, revision: raw.revision + 2, stateHash: hash(after) },
    transform,
    "requirement-exceptions",
  );
  assert.deepEqual(await readFile(file), after);
  assert.deepEqual(await readFile(store.maintenanceFile), maintenance);
  const invalid = structuredClone(before);
  invalid.organizationQualificationRequirements[0].exclusions = [
    { entityId: q, reason: "old" },
  ];
  assert.throws(() => migrateRequirementExceptions(invalid, org));
});

test("조직 이동·버전 교체는 예외를 유지하고 예외만 남은 계보의 삭제도 보류한다", async (t) => {
  const f = await fixture(t);
  await f.save([rule(root, [q]), rule(leaf, [], true)]);
  const state = f.store.snapshot(),
    doc = f.store.organizations.snapshot(),
    before = structuredClone(state.organizationQualificationRequirements);
  changeOrganization(
    doc,
    state.users.find((u) => u.id === "operator-1")!,
    leaf,
    { revision: doc.revision, parentId: "org-photo-hwaseong" },
  );
  assert.equal(effectiveRequirements(state, doc, leaf).length, 0);
  assert.deepEqual(state.organizationQualificationRequirements, before);
  const version = structuredClone(
    state.qualifications.find((x) => x.id === q)!,
  );
  version.id = "new-version";
  version.version = 2;
  state.qualifications.push(version);
  assert.equal(effectiveRequirements(state, doc, leaf).length, 0);
  await f.save([rule(root)]);
  const preview = await f.call(
    "admin-1",
    `/qualifications/${q}/deletion-impact`,
  );
  assert.equal(preview.canDelete, false);
  assert.ok(preview.blockers.some((s: string) => s.includes("예외")));
});
