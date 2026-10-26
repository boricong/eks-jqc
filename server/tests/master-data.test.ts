import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assessmentQuestions, type State } from "@eks/contracts";
import { seedState } from "../src/seed.ts";
import { JsonStore } from "../src/storage.ts";
import { buildApp } from "../src/app.ts";
import {
  masterPayload,
  masterCandidate,
  exportMaster,
  readMaster,
  contentHash,
  clearedCounts,
} from "../src/master-data.ts";
import { configureTestPolicies } from "./policy-helpers.ts";

const clock = "2026-10-22T06:00:00.000Z";
async function fixture(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-master-")),
    file = path.join(dir, "runtime/state.json");
  await new JsonStore(file).initialize(seedState(true));
  let store = await new JsonStore(file).load(),
    app = await buildApp(store, { clock: () => clock });
  const cookies = new Map<string, string>();
  async function login(who = "operator-1") {
    const r = await app.inject({
      method: "POST",
      url: "/api/session",
      payload: { actorId: who },
    });
    assert.equal(r.statusCode, 200, r.body);
    cookies.set(who, `${r.cookies[0]!.name}=${r.cookies[0]!.value}`);
  }
  async function call(
    url: string,
    body?: unknown,
    who = "operator-1",
    status = 200,
    method: any = body === undefined ? "GET" : "POST",
    key = randomUUID(),
  ) {
    if (!cookies.has(who)) await login(who);
    const r = await app.inject({
      method,
      url: "/api" + url,
      headers: { cookie: cookies.get(who)!, "idempotency-key": key },
      ...(body === undefined ? {} : { payload: body as any }),
    });
    assert.equal(r.statusCode, status, `${who} ${url}: ${r.body}`);
    return r.json();
  }
  async function change(fn: (s: State) => void) {
    await store.transact(
      "operator-1",
      randomUUID(),
      "fixture",
      () => {},
      (s) => {
        fn(s);
        return {};
      },
    );
  }
  async function restart() {
    await app.close();
    store = await new JsonStore(file).load();
    app = await buildApp(store, { clock: () => clock });
    cookies.clear();
  }
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const resetBody = async () => ({
    previewId: (await call("/testing/master-reset/preview")).previewId,
    confirmation: "전체 초기화",
  });
  return {
    dir,
    file,
    get store() {
      return store;
    },
    get app() {
      return app;
    },
    cookies,
    call,
    login,
    change,
    restart,
    resetBody,
  };
}

test("기준 파일은 설정·모든 버전·자료·정답만 왕복하며 내보내기는 원본을 변경하지 않는다", async (t) => {
  const f = await fixture(t);
  await configureTestPolicies(f.store);
  await f.change((s) => {
    s.users[0]!.certificationEligibility = "hold";
    s.users[0]!.organizationAdministration = {
      organizationId: s.users[0]!.organizationId,
      grantedBy: "admin-1",
      grantedAt: clock,
    };
    s.qualifications.at(-1)!.lifecycleStatus = "Hold";
  });
  const before = await readFile(f.file),
    orgBefore = await readFile(f.store.organizations.file);
  const file = await f.call("/system/master-data/export");
  assert.deepEqual(
    readMaster(file).payload,
    masterPayload(f.store.snapshot(), f.store.organizations.snapshot()),
  );
  assert.deepEqual(Object.keys(file.payload).sort(), [
    "auditorPrograms",
    "courses",
    "organizations",
    "qualificationTemplates",
    "qualifications",
    "users",
  ]);
  assert.equal(file.payload.users[0].certificationEligibility, "hold");
  assert.deepEqual(await readFile(f.file), before);
  assert.deepEqual(await readFile(f.store.organizations.file), orgBefore);
});

test("전체 초기화는 설정 해시를 유지하고 진행·공지·모든 이력을 비우며 백업 쌍과 세대를 보존한다", async (t) => {
  const f = await fixture(t);
  await configureTestPolicies(f.store);
  const original = f.store.snapshot(),
    org = f.store.organizations.snapshot(),
    generation = f.store.generation;
  const stateBytes = await readFile(f.file),
    orgBytes = await readFile(f.store.organizations.file);
  await f.login("learner-1");
  const p = await f.call("/testing/master-reset/preview");
  assert.deepEqual(f.store.snapshot(), original);
  const r = await f.call("/testing/master-reset", {
    previewId: p.previewId,
    confirmation: "전체 초기화",
  });
  assert.equal(r.stateRevision, original.revision + 1);
  assert.equal(r.organizationRevision, org.revision + 1);
  assert.notEqual(r.generation, generation);
  assert.deepEqual(
    masterPayload(f.store.snapshot(), f.store.organizations.snapshot()),
    masterPayload(original, org),
  );
  assert.ok(
    Object.values(
      clearedCounts(f.store.snapshot(), f.store.organizations.snapshot()),
    ).every((n) => n === 0),
  );
  assert.deepEqual(await readFile(r.backups.state), stateBytes);
  assert.deepEqual(await readFile(r.backups.organizations), orgBytes);
  await f.call("/workspace", undefined, "learner-1", 401);
  await f.restart();
  assert.equal(f.store.generation, r.generation);
});

test("다른 서버의 기준 파일로 전체 교체하고 불러온 운영자 계정으로 다시 접속한다", async (t) => {
  const source = await fixture(t),
    target = await fixture(t);
  await configureTestPolicies(source.store);
  await source.change((s) => {
    s.users.find((u) => u.id === "operator-1")!.id = "imported-operator";
    s.users[0]!.name = "이전된 사용자";
  });
  const file = exportMaster(
    source.store.snapshot(),
    source.store.organizations.snapshot(),
    clock,
  );
  const p = await target.call("/system/master-data/import-preview", file);
  const r = await target.call("/system/master-data/import", {
    previewId: p.previewId,
    confirmation: "전체 교체",
  });
  assert.deepEqual(
    masterPayload(
      target.store.snapshot(),
      target.store.organizations.snapshot(),
    ),
    file.payload,
  );
  assert.ok(
    Object.values(
      clearedCounts(
        target.store.snapshot(),
        target.store.organizations.snapshot(),
      ),
    ).every((n) => n === 0),
  );
  assert.equal(r.preserved.users, file.counts.users);
  await target.login("imported-operator");
  assert.equal(
    (await target.call("/session", undefined, "imported-operator")).actor.name,
    "시스템 운영자",
  );
  await target.restart();
  assert.deepEqual(
    masterPayload(
      target.store.snapshot(),
      target.store.organizations.snapshot(),
    ),
    file.payload,
  );
});

test("손상·구형·진행 혼입·숨은 필드·중복 ID·참조 누락·운영자 부재를 위치와 함께 거부한다", async (t) => {
  const f = await fixture(t),
    original = f.store.snapshot();
  const base = exportMaster(original, f.store.organizations.snapshot(), clock);
  const mutations = [
    (v: any) => {
      v.formatVersion = 99;
    },
    (v: any) => {
      v.stateSchemaVersion = 9;
    },
    (v: any) => {
      v.payload.plans = [];
    },
    (v: any) => {
      v.payload.users[0].unexpected = "x";
    },
    (v: any) => {
      v.payload.users.push(v.payload.users[0]);
    },
    (v: any) => {
      v.payload.users[0].organizationId = "missing";
    },
    (v: any) => {
      v.payload.qualifications[0].courseIds = ["missing"];
    },
    (v: any) => {
      v.payload.users = v.payload.users.filter(
        (u: any) => !u.roles.includes("system_operator"),
      );
    },
    (v: any) => {
      v.counts.users = 999;
    },
  ];
  for (const mutate of mutations) {
    const v = structuredClone(base);
    mutate(v);
    v.sha256 = contentHash(v.payload);
    const r = await f.call(
      "/system/master-data/import-preview",
      v,
      "operator-1",
      422,
    );
    assert.equal(r.code, "MASTER_FILE_INVALID");
  }
  const tampered = structuredClone(base);
  tampered.payload.users[0]!.name = "변조";
  await f.call(
    "/system/master-data/import-preview",
    tampered,
    "operator-1",
    422,
  );
  assert.deepEqual(f.store.snapshot(), original);
});

test("팀·세부 관리자·학습자는 내보내기·미리보기·전체 초기화·불러오기 API를 사용할 수 없다", async (t) => {
  const f = await fixture(t);
  await f.change((s) => {
    s.users.find((u) => u.id === "learner-1")!.organizationAdministration = {
      organizationId: "org-photo",
      grantedBy: "admin-1",
      grantedAt: clock,
    };
  });
  const file = exportMaster(
    f.store.snapshot(),
    f.store.organizations.snapshot(),
    clock,
  );
  for (const who of ["admin-1", "learner-1", "ft-1"]) {
    await f.call("/system/master-data/export", undefined, who, 403);
    await f.call("/testing/master-reset/preview", undefined, who, 403);
    await f.call("/system/master-data/import-preview", file, who, 403);
    await f.call("/testing/master-reset", {}, who, 403);
    await f.call("/system/master-data/import", {}, who, 403);
  }
});

test("미리보기 이후 업무 또는 조직 변경·확인 만료·잘못된 문구는 적용하지 않는다", async (t) => {
  const f = await fixture(t);
  const body = await f.resetBody();
  await f.change((s) => {
    s.users[0]!.name += " 변경";
  });
  assert.equal(
    (await f.call("/testing/master-reset", body, "operator-1", 409)).code,
    "REVISION_CONFLICT",
  );
  const second = await f.resetBody();
  await configureTestPolicies(f.store);
  assert.equal(
    (await f.call("/testing/master-reset", second, "operator-1", 409)).code,
    "REVISION_CONFLICT",
  );
  const third = await f.resetBody();
  await f.call(
    "/testing/master-reset",
    { ...third, confirmation: "초기화" },
    "operator-1",
    422,
  );
  const now = Date.now();
  t.mock.method(Date, "now", () => now + 16 * 60 * 1000);
  assert.equal(
    (await f.call("/testing/master-reset", third, "operator-1", 409)).code,
    "MASTER_PREVIEW_EXPIRED",
  );
});

test("백업 실패 시 원본·세션·세대를 유지하고 초기화하지 않는다", async (t) => {
  const f = await fixture(t),
    body = await f.resetBody(),
    generation = f.store.generation;
  const bytes = await readFile(f.file),
    org = await readFile(f.store.organizations.file);
  const write = (f.store as any).writeAtomic.bind(f.store);
  (f.store as any).writeAtomic = async (file: string, v: unknown) => {
    if (path.basename(file).startsWith("before-master-"))
      throw new Error("backup failure");
    return write(file, v);
  };
  await f.call("/testing/master-reset", body, "operator-1", 503);
  assert.deepEqual(await readFile(f.file), bytes);
  assert.deepEqual(await readFile(f.store.organizations.file), org);
  assert.equal(f.store.generation, generation);
  await f.call("/session");
  (f.store as any).writeAtomic = write;
});

test("두 번째 파일 교체 실패 시 백업 쌍으로 복구하고 같은 요청을 안전하게 다시 실행한다", async (t) => {
  const f = await fixture(t),
    body = await f.resetBody(),
    key = randomUUID();
  const bytes = await readFile(f.file),
    org = await readFile(f.store.organizations.file),
    meta = await readFile(f.store.maintenanceFile);
  f.store.beforeReplace = () => {
    f.store.beforeReplace = undefined;
    throw new Error("second replacement");
  };
  await f.call("/testing/master-reset", body, "operator-1", 503, "POST", key);
  assert.deepEqual(await readFile(f.file), bytes);
  assert.deepEqual(await readFile(f.store.organizations.file), org);
  assert.deepEqual(await readFile(f.store.maintenanceFile), meta);
  await assert.rejects(readFile(f.store.replacementMarker), { code: "ENOENT" });
  await f.call("/testing/master-reset", body, "operator-1", 200, "POST", key);
});

test("복구 실패 표식은 실행과 재기동을 차단하며 백업 쌍·관리 정보로 복구할 수 있다", async (t) => {
  const f = await fixture(t),
    body = await f.resetBody();
  const write = (f.store as any).writeAtomic.bind(f.store);
  let rollback = false;
  f.store.beforeReplace = () => {
    rollback = true;
    throw new Error("replacement failed");
  };
  (f.store as any).writeAtomic = async (file: string, v: unknown) => {
    if (rollback && file === f.store.organizations.file)
      throw new Error("rollback failed");
    return write(file, v);
  };
  const r = await f.call("/testing/master-reset", body, "operator-1", 503);
  assert.equal(r.code, "MAINTENANCE_RECOVERY_REQUIRED");
  assert.throws(() => f.store.snapshot());
  const marker = JSON.parse(await readFile(f.store.replacementMarker, "utf8"));
  await assert.rejects(new JsonStore(f.file).load(), /교체가 중단/);
  await f.app.close();
  const recovery = await new JsonStore(f.file).recoverMasterReplacement();
  assert.equal(recovery.recovered, true);
  await f.restart();
  assert.equal(f.store.generation, marker.maintenanceBefore.generation);
});

test("응답 유실·재시작 뒤 재시도는 새 진행을 지우지 않고 최초 결과를 반환한다", async (t) => {
  const f = await fixture(t),
    body = await f.resetBody(),
    key = randomUUID();
  const first = await f.call(
    "/testing/master-reset",
    body,
    "operator-1",
    200,
    "POST",
    key,
  );
  await f.restart();
  await f.change((s) => {
    s.notices.push({
      id: "new-notice",
      scope: "system",
      title: "새 진행 보존",
      body: "내용",
      published: true,
      date: "2026-10-22",
      revision: 1,
    });
  });
  const again = await f.call(
    "/testing/master-reset",
    body,
    "operator-1",
    200,
    "POST",
    key,
  );
  assert.deepEqual(again, first);
  assert.equal(f.store.snapshot().notices.length, 1);
  assert.equal(
    (
      await f.call(
        "/testing/master-reset",
        { ...body, previewId: randomUUID() },
        "operator-1",
        409,
        "POST",
        key,
      )
    ).code,
    "IDEMPOTENCY_CONFLICT",
  );
});

test("대기 중인 이전 세대 쓰기와 재접속 후 이전 세대 헤더의 쓰기를 거부한다", async (t) => {
  const f = await fixture(t),
    body = await f.resetBody(),
    generation = f.store.generation;
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => {
      release = r;
    }),
    started = new Promise<void>((r) => {
      entered = r;
    });
  f.store.beforeReplace = async () => {
    entered();
    await gate;
    f.store.beforeReplace = undefined;
  };
  const reset = f.call("/testing/master-reset", body);
  await started;
  const late = f.store.transact(
    "operator-1",
    randomUUID(),
    "late",
    () => {},
    (s) => {
      s.users[0]!.name = "stale";
      return {};
    },
  );
  const rejected = assert.rejects(
    late,
    (e: any) => e.code === "DATASET_CHANGED",
  );
  release();
  await reset;
  await rejected;
  await f.login();
  const r = await f.app.inject({
    method: "POST",
    url: "/api/courses?lv1OrganizationId=org-photo",
    headers: {
      cookie: f.cookies.get("operator-1")!,
      "idempotency-key": randomUUID(),
      "x-eks-data-generation": generation,
    },
    payload: {},
  });
  assert.equal(r.statusCode, 409);
  assert.equal(r.json().code, "DATASET_CHANGED");
  assert.notEqual(f.store.snapshot().users[0]!.name, "stale");
});

test("파일 불러오기 후 새 요청·계획·두 자동 평가·수료·인증이 신규 기록으로 연결된다", async (t) => {
  const f = await fixture(t);
  await configureTestPolicies(f.store, "org-photo", undefined, [
    "demo-qualification",
  ]);
  const file = await f.call("/system/master-data/export");
  const p = await f.call("/system/master-data/import-preview", file);
  await f.call("/system/master-data/import", {
    previewId: p.previewId,
    confirmation: "전체 교체",
  });
  f.cookies.clear();
  const req = await f.call(
    "/planning-requests?lv1OrganizationId=org-photo",
    { learnerIds: ["learner-1"], message: "이전 후 새 계획" },
    "admin-1",
  );
  const plan = await f.call(
    "/plans",
    {
      requestRevision: f.store
        .snapshot()
        .planningRequests.find((r) => r.id === req.ids[0])!.revision,
      requestId: req.ids[0],
      qualificationId: "demo-qualification",
    },
    "learner-1",
  );
  const draft = f.store.snapshot().plans.find((p) => p.id === plan.id)!;
  await f.call(
    `/plans/${plan.id}`,
    {
      revision: draft.revision,
      targetOn: "2027-03-01",
      schedules: draft.schedules.map((s) => ({
        ...s,
        goal: "기준에 맞게 판단",
      })),
    },
    "learner-1",
    200,
    "PUT",
  );
  const result = await f.call(
    `/plans/${plan.id}/complete`,
    { revision: draft.revision + 1 },
    "learner-1",
  );
  assert.notEqual(result.assignmentId, "assignment-1");
  for (const e of f.store.snapshot().enrollments) {
    const c = f.store.snapshot().courses.find((c) => c.id === e.courseId)!;
    for (const kind of c.assessmentKinds) {
      const a = await f.call(
        `/enrollments/${e.id}/attempts`,
        { kind },
        "learner-1",
      );
      await f.call(
        `/attempts/${a.id}/draft`,
        {
          revision: a.revision,
          answers: Object.fromEntries(
            assessmentQuestions(c, kind).map((q) => [q.id, q.correct]),
          ),
        },
        "learner-1",
        200,
        "PUT",
      );
      await f.call(
        `/attempts/${a.id}/submit`,
        { revision: a.revision + 1 },
        "learner-1",
      );
    }
  }
  assert.equal(f.store.snapshot().certifications.length, 1);
  assert.equal(
    f.store.snapshot().certifications[0]!.assignmentId,
    result.assignmentId,
  );
});

test("손상된 관리 정보는 자동 생성하지 않고 잠금을 해제한 채 기동을 거부한다", async (t) => {
  const f = await fixture(t),
    metadata = await readFile(f.store.maintenanceFile);
  await f.app.close();
  await writeFile(
    f.store.maintenanceFile,
    JSON.stringify({ schemaVersion: 1, generation: "broken", receipts: [] }),
  );
  await assert.rejects(new JsonStore(f.file).load());
  assert.match(await readFile(f.store.maintenanceFile, "utf8"), /broken/);
  await writeFile(f.store.maintenanceFile, metadata);
  await f.restart();
});

test("25MB 초과 파일은 검사 전에 거부하고 데이터는 변경하지 않는다", async (t) => {
  const f = await fixture(t),
    before = f.store.snapshot();
  await f.login();
  const r = await f.app.inject({
    method: "POST",
    url: "/api/system/master-data/import-preview",
    headers: {
      cookie: f.cookies.get("operator-1")!,
      "content-type": "application/json",
    },
    payload: " ".repeat(25 * 1024 * 1024) + "{}",
  });
  assert.equal(r.statusCode, 413);
  assert.deepEqual(f.store.snapshot(), before);
});
