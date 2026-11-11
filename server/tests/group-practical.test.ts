import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CourseContentSchema, type GroupAssessment } from "@eks/contracts";
import { buildApp } from "../src/app.ts";
import { JsonStore } from "../src/storage.ts";
import { GroupFileStore } from "../src/group-practical-files.ts";
import { migrateGroupPractical } from "../src/group-practical-migration.ts";
import { canonicalHash } from "../src/releases.ts";
import { seedState } from "../src/seed.ts";
import { seedOrganizations } from "../src/organizations.ts";
import { validateState } from "../src/integrity.ts";
import { groupSeed, groupNow } from "./group-practical-fixture.ts";

async function fixture(
  t: TestContext,
  count = 3,
  otherCourse = false,
  enabled = true,
) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-group-")),
    file = path.join(dir, "runtime/state.json");
  await new JsonStore(file).initialize(groupSeed(count, otherCourse));
  const store = await new JsonStore(file).load(),
    app = await buildApp(store, {
      groupPracticalEnabled: enabled,
      clock: () => groupNow,
    });
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const cookies = new Map<string, string>();
  async function call(
    url: string,
    body?: any,
    status = 200,
    actor = "admin-1",
    key = randomUUID(),
    binary?: Buffer,
    contract = "6",
    method?: "GET" | "POST" | "PUT",
  ) {
    if (!cookies.has(actor)) {
      const r = await app.inject({
        method: "POST",
        url: "/api/session",
        payload: { actorId: actor },
      });
      assert.equal(r.statusCode, 200, r.body);
      cookies.set(actor, `${r.cookies[0]!.name}=${r.cookies[0]!.value}`);
    }
    const r = await app.inject({
      method: method || (body === undefined && !binary ? "GET" : "POST"),
      url: "/api" + url,
      headers: {
        cookie: cookies.get(actor)!,
        "idempotency-key": key,
        "x-eks-release-contract": contract,
        ...(binary ? { "content-type": "application/octet-stream" } : {}),
      },
      ...(binary
        ? { payload: binary }
        : body === undefined
          ? {}
          : { payload: body }),
    });
    assert.equal(r.statusCode, status, r.body);
    return r.json();
  }
  async function create() {
    const s = store.snapshot();
    return call("/group-assessments", {
      title: "3회 실기",
      courseId: "demo-course-1",
      evaluatorId: "admin-1",
      enrollmentIds: s.enrollments
        .filter((e) => e.courseId === "demo-course-1")
        .map((e) => e.id),
      lv1OrganizationId: "org-photo",
    });
  }
  const group = (id: string) =>
    store.snapshot().groupAssessments.find((g) => g.id === id)!;
  async function start() {
    const created = await create();
    await call(`/group-assessments/${created.id}/start`, {
      revision: created.revision,
    });
    return created.id as string;
  }
  async function prepare(id: string, result = "passed") {
    const g = group(id),
      r = g.runs.at(-1)!,
      base = `/group-assessments/${id}/runs/${r.id}`;
    const raw = await call(
      base + "/files?name=measure.csv&kind=raw",
      undefined,
      200,
      "admin-1",
      randomUUID(),
      Buffer.from("person,trial,value\na,1,20\n"),
    );
    const report = await call(
      base + "/files?name=analysis.pdf&kind=report",
      undefined,
      200,
      "admin-1",
      randomUUID(),
      Buffer.from("%PDF-1.4\ntrial report"),
    );
    for (const t of r.trials)
      await call(base + "/trial", {
        ...t,
        performedOn: "2026-11-10",
        evidence: [{ fileId: raw.id, locator: `${t.learnerId}:${t.number}` }],
        completed: true,
      });
    const detail = await call(`/group-assessments/${id}`),
      run = detail.group.runs.at(-1)!;
    await call(base + "/analysis", {
      revision: run.revision,
      sourceHash: detail.sourceHashes[run.id],
      values: { variation: 4.2 },
      reportFileIds: [report.id],
      reason: "기준과 결과 대조",
      result,
      dataVerified: true,
    });
    return { base, raw, report };
  }
  async function finalize(id: string, base: string) {
    const preview = await call(base + "/preview", {});
    assert.deepEqual(preview.blockers, []);
    const body = {
      revision: group(id).runs.at(-1)!.revision,
      reviewToken: preview.token,
    };
    await call(base + "/finalize", body);
    return { preview, body };
  }
  return {
    dir,
    file,
    store,
    app,
    call,
    create,
    start,
    prepare,
    group,
    finalize,
  };
}

for (const count of [3, 4])
  test(`${count}명 각3회·Pass 전원 수료/시험 발급·조회 권한·재시도`, async (t) => {
    const f = await fixture(t, count),
      id = await f.start(),
      { base, raw } = await f.prepare(id);
    const before = f.store.snapshot();
    const p = await f.call(base + "/preview", {});
    assert.equal(p.outcomes.length, count);
    assert(p.outcomes.every((m: any) => m.wouldCertify));
    const body = {
        revision: f.group(id).runs[0]!.revision,
        reviewToken: p.token,
      },
      key = randomUUID();
    f.store.beforeReplace = () => {
      throw Error("simulated disk failure");
    };
    await f.call(base + "/finalize", body, 503, "admin-1", key);
    assert.deepEqual(f.store.snapshot(), before);
    f.store.beforeReplace = undefined;
    await Promise.all([
      f.call(base + "/finalize", body, 200, "admin-1", key),
      f.call(base + "/finalize", body, 200, "admin-1", key),
    ]);
    const s = f.store.snapshot();
    assert.equal(s.completions.length, count);
    assert.equal(s.certifications.length, count);
    assert(s.certifications.every((c) => c.trial));
    const personal = await f.call(
      `/group-assessments/${id}`,
      undefined,
      200,
      "learner-1",
    );
    assert.equal(personal.group.members.length, 1);
    assert.equal(personal.group.runs[0].trials.length, 3);
    assert.equal(personal.files.length, 0);
    assert.equal(personal.group.runs[0].analysis, undefined);
    await f.call(
      `/group-assessment-files/${raw.id}`,
      undefined,
      403,
      "learner-1",
    );
    await f.call(
      base + "/trial",
      s.groupAssessments[0]!.runs[0]!.trials[0],
      403,
      "learner-1",
    );
    await f.call(base + "/analysis", {}, 409);
    assert.equal(f.store.snapshot().completions.length, count);
  });
test("다른 필수 인증Set 미완료는 그룹 Pass 후에도 자격을 발급하지 않는다", async (t) => {
  const f = await fixture(t, 3, true),
    id = await f.start(),
    { base } = await f.prepare(id);
  const { preview } = await f.finalize(id, base);
  assert(preview.outcomes.every((m: any) => !m.wouldCertify));
  assert.equal(f.store.snapshot().completions.length, 3);
  assert.equal(f.store.snapshot().certifications.length, 0);
});
test("Fail 재평가는 같은 구성원 새9회·판정 무효화는 수료/파생 인증/취득을 함께 정리", async (t) => {
  const f = await fixture(t),
    id = await f.start(),
    first = await f.prepare(id, "failed");
  await f.finalize(id, first.base);
  assert.equal(f.store.snapshot().completions.length, 0);
  const original = f.group(id).runs[0]!;
  await f.call(`/group-assessments/${id}/retry`, {
    revision: f.group(id).revision,
  });
  const second = f.group(id).runs[1]!;
  assert.equal(second.trials.length, 9);
  assert(second.trials.every((t) => !t.completed));
  assert.deepEqual(f.group(id).runs[0], original);
  const { base } = await f.prepare(id);
  await f.finalize(id, base);
  const before = f.group(id).runs[1]!.decision;
  const impact = await f.call(base + "/invalidate-preview", {
    reason: "원자료 오기재",
  });
  assert.equal(impact.certificationIds.length, 3);
  await f.call(base + "/invalidate", {
    revision: f.group(id).runs[1]!.revision,
    reason: "원자료 오기재",
    reviewToken: impact.token,
  });
  const s = f.store.snapshot();
  assert.equal(s.completions.length, 3);
  assert(s.certifications.every((c) => c.lifecycleStatus === "Revoke"));
  assert(s.assignments.every((a) => a.acquisitionClosedAt));
  assert.deepEqual(s.groupAssessments[0]!.runs[1]!.decision, before);
  assert.equal(s.groupAssessments[0]!.status, "closed");
});
test("누락·중복 구성·자기 판정·이전 계약·원자료 변경·검토 충돌을 보류한다", async (t) => {
  const f = await fixture(t);
  const body = {
    title: "그룹",
    courseId: "demo-course-1",
    evaluatorId: "admin-1",
    enrollmentIds: f.store.snapshot().enrollments.map((e) => e.id),
    lv1OrganizationId: "org-photo",
  };
  await f.call(
    "/group-assessments",
    { ...body, enrollmentIds: body.enrollmentIds.slice(0, 2) },
    422,
  );
  await f.call(
    "/group-assessments",
    {
      ...body,
      enrollmentIds: [
        body.enrollmentIds[0],
        body.enrollmentIds[0],
        body.enrollmentIds[2],
      ],
    },
    422,
  );
  await f.call(
    "/group-assessments",
    { ...body, evaluatorId: "learner-1" },
    409,
  );
  await f.call(
    "/group-assessments",
    body,
    409,
    "admin-1",
    randomUUID(),
    undefined,
    "5",
  );
  const id = await f.start(),
    run = f.group(id).runs[0]!,
    base = `/group-assessments/${id}/runs/${run.id}`;
  await f.call("/group-assessments", body, 409);
  const p = await f.call(base + "/preview", {});
  assert(p.blockers.length > 0);
  await f.call(
    base + "/finalize",
    { revision: run.revision, reviewToken: p.token },
    409,
  );
  await f.prepare(id);
  const p2 = await f.call(base + "/preview", {});
  let trial = f.group(id).runs[0]!.trials[0]!;
  const { updatedBy, updatedAt, ...plain } = trial;
  await f.call(base + "/trial", { ...plain, note: "원자료 설명 정정" });
  assert.equal(f.group(id).runs[0]!.analysis, undefined);
  assert.equal(f.group(id).runs[0]!.previousAnalyses.length, 1);
  await f.call(
    base + "/finalize",
    { revision: f.group(id).runs[0]!.revision, reviewToken: p2.token },
    409,
  );
  await f.call(base + "/trial", plain, 409);
});
test("제한된 구성원은 그룹 전체 확정을 보류하고 평가자 권한 회수를 즉시 적용", async (t) => {
  const f = await fixture(t),
    id = await f.start(),
    { base } = await f.prepare(id);
  await f.store.transact(
    "operator-1",
    randomUUID(),
    "hold",
    () => {},
    (s) => {
      const u = s.users.find((u) => u.id === "learner-1")!;
      u.workStatus = "deactive";
      u.workDeactivation = {
        id: randomUUID(),
        startedAt: groupNow,
        startedOn: "2026-11-11",
        revokesOn: "2027-05-12",
        actorId: "admin-1",
        reason: "미수행",
        processedTeams: [],
      };
      return {};
    },
  );
  const p = await f.call(base + "/preview", {});
  assert(p.blockers.some((b: string) => b.includes("업무 상태")));
  await f.call(
    base + "/finalize",
    { revision: f.group(id).runs[0]!.revision, reviewToken: p.token },
    409,
  );
  await f.store.transact(
    "operator-1",
    randomUUID(),
    "role",
    () => {},
    (s) => {
      s.users.find((u) => u.id === "admin-1")!.roles = ["learner"];
      return {};
    },
  );
  await f.call(base + "/preview", {}, 403);
  assert.equal(f.store.snapshot().completions.length, 0);
});
test("명시적 시험 이관은 이전 내용/해시를 보존하며 기능 미사용에서는 신규 쓰기를 차단", async (t) => {
  const old = seedState(true),
    before = old.courses.map((c) =>
      canonicalHash(CourseContentSchema.parse(c)),
    ),
    m = migrateGroupPractical(old, seedOrganizations(), groupNow);
  assert.deepEqual(
    m.state.courses.map((c) => canonicalHash(CourseContentSchema.parse(c))),
    before,
  );
  assert.deepEqual(m.state.certifications, old.certifications);
  assert(migrateGroupPractical(m.state, m.organizations).report.alreadyApplied);
  const f = await fixture(t, 3, false, false);
  await f.call("/group-assessments", {}, 409);
  assert.equal((await f.call("/group-assessments/status")).enabled, false);
});
test("파일 크기·형식·해시·파일 포함 백업 복구와 손상 복구 보류", async (t) => {
  const f = await fixture(t),
    id = await f.start(),
    { base, raw } = await f.prepare(id);
  await f.finalize(id, base);
  const backup = await f.store.backup();
  const snapshot = f.store.snapshot();
  await f.app.close();
  await rm(f.store.groupFiles.blob(raw.sha256));
  await new JsonStore(f.file).restore(backup);
  await f.store.groupFiles.verifyAll(snapshot.groupAssessmentFiles);
  const bytes = await readFile(f.file);
  await writeFile(path.join(`${backup}.files`, raw.sha256), "corrupt");
  await assert.rejects(new JsonStore(f.file).restore(backup));
  assert.deepEqual(await readFile(f.file), bytes);
  const fs = new GroupFileStore(path.join(f.dir, "limits"), { maxBytes: 8 });
  await assert.rejects(
    fs.save(
      (async function* () {
        yield Buffer.alloc(9);
      })(),
      "data.csv",
      "raw",
    ),
  );
  await assert.rejects(
    fs.save(
      (async function* () {
        yield Buffer.from("bad");
      })(),
      "report.pdf",
      "report",
    ),
  );
  await assert.rejects(
    fs.save(
      (async function* () {
        yield Buffer.from("a");
      })(),
      "../data.csv",
      "raw",
    ),
  );
  const damaged = structuredClone(snapshot);
  damaged.groupAssessments[0]!.runs[0]!.decision!.result = "failed";
  assert.throws(() => validateState(damaged, seedOrganizations()));
});

test("실제 인증Set 개정 API는 그룹 기준을 새 메이저에 고정하고 이전 배정을 보존", async (t) => {
  const f = await fixture(t, 3, true),
    s = f.store.snapshot(),
    old = s.courses.find((c) => c.id === "demo-course-2")!,
    before = canonicalHash(CourseContentSchema.parse(old));
  const body = {
    ...old,
    groupPractical: s.courses.find((c) => c.id === "demo-course-1")!
      .groupPractical,
    assessmentKinds: [],
    subjectiveEnabled: false,
  };
  const preview = await f.call(`/courses/${old.id}/save-preview`, body);
  const saved = await f.call(
    `/courses/${old.id}`,
    {
      ...body,
      stateRevision: preview.stateRevision,
      organizationRevision: preview.organizationRevision,
    },
    200,
    "admin-1",
    randomUUID(),
    undefined,
    "6",
    "PUT",
  );
  const next = f.store.snapshot();
  assert.equal(
    canonicalHash(
      CourseContentSchema.parse(next.courses.find((c) => c.id === old.id)!),
    ),
    before,
  );
  const fresh = next.courses.find((c) => c.id === saved.id)!;
  assert(fresh.groupPractical);
  assert.equal(fresh.releaseVersion?.major, 2);
  assert.deepEqual(next.assignments, s.assignments);
});

test("이관 CLI의 trial/dry-run·해시 조건 적용과 세 파일 묶음 복구·실패 롤백", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-group-cli-")),
    file = path.join(dir, "runtime/state.json");
  t.after(() => rm(dir, { recursive: true, force: true }));
  await new JsonStore(file).initialize(seedState(true));
  const cli = async (args: string[]) =>
    JSON.parse(
      (
        await promisify(execFile)(
          process.execPath,
          ["--import", "tsx", "server/src/cli.ts", ...args],
          { env: { ...process.env, EKS_DATA_FILE: file } },
        )
      ).stdout,
    );
  await assert.rejects(cli(["migrate-group-practical", "--dry-run"]));
  const before = await readFile(file),
    plan = await cli(["migrate-group-practical", "--trial", "--dry-run"]);
  assert.deepEqual(await readFile(file), before);
  assert.equal(plan.schemaVersion, 33);
  await cli([
    "migrate-group-practical",
    "--trial",
    "--apply",
    `--expected-revision=${plan.expectedRevision}`,
    `--expected-sha256=${plan.stateHash}`,
    `--organization-sha256=${plan.organizationHash}`,
  ]);
  const store = await new JsonStore(file).load(),
    backup = await store.backup(),
    state = store.snapshot(),
    org = store.organizations.snapshot();
  await store.close();
  const candidate = new JsonStore(file),
    original = await readFile(file),
    originalOrg = await readFile(candidate.organizations.file),
    originalMaintenance = await readFile(candidate.maintenanceFile);
  candidate.beforeReplace = () => {
    throw Error("injected restore failure");
  };
  await assert.rejects(candidate.restoreGroupBundle(backup));
  assert.deepEqual(await readFile(file), original);
  assert.deepEqual(await readFile(candidate.organizations.file), originalOrg);
  assert.deepEqual(
    await readFile(candidate.maintenanceFile),
    originalMaintenance,
  );
  candidate.beforeReplace = undefined;
  const restored = await cli(["restore-group", backup]);
  assert.equal(restored.restored, true);
  const loaded = await new JsonStore(file).load();
  assert.deepEqual(loaded.snapshot(), state);
  assert.deepEqual(loaded.organizations.snapshot(), org);
  await loaded.close();
  await writeFile(`${backup}.organizations.json`, "{}");
  await assert.rejects(new JsonStore(file).restoreGroupBundle(backup));
});

test("Fail 후 평가자 회수는 관리자 교체로 복구하며 이전 판정자를 보존한다", async (t) => {
  const f = await fixture(t),
    id = await f.start(),
    { base } = await f.prepare(id, "failed");
  await f.finalize(id, base);
  const decision = f.group(id).runs[0]!.decision;
  await f.store.transact(
    "operator-1",
    randomUUID(),
    "replace-role",
    () => {},
    (s) => {
      s.users.find((u) => u.id === "admin-1")!.roles = ["learner"];
      s.users.find((u) => u.id === "ft-2")!.roles = ["admin"];
      return {};
    },
  );
  await f.call(
    `/group-assessments/${id}/retry`,
    { revision: f.group(id).revision },
    409,
    "operator-1",
  );
  await f.call(
    `/group-assessments/${id}/evaluator`,
    {
      revision: f.group(id).revision,
      evaluatorId: "ft-2",
      reason: "평가자 교체",
    },
    200,
    "operator-1",
  );
  await f.call(
    `/group-assessments/${id}/retry`,
    { revision: f.group(id).revision },
    200,
    "operator-1",
  );
  assert.equal(f.group(id).runs.length, 2);
  assert.deepEqual(f.group(id).runs[0]!.decision, decision);
});

test("파일 개수 제한·동일 업로드 재시도와 확정 후 응답 재수신", async (t) => {
  const f = await fixture(t),
    id = await f.start(),
    { base } = await f.prepare(id),
    payload = Buffer.from("value\n2"),
    key = randomUUID(),
    url = base + "/files?name=extra.csv&kind=raw";
  const saved = await f.call(url, undefined, 200, "admin-1", key, payload);
  assert.deepEqual(
    await f.call(url, undefined, 200, "admin-1", key, payload),
    saved,
  );
  for (let i = 0; i < 17; i++)
    await f.call(url, undefined, 200, "admin-1", randomUUID(), payload);
  assert.equal(f.store.snapshot().groupAssessmentFiles.length, 20);
  await f.call(url, undefined, 422, "admin-1", randomUUID(), payload);
  await f.finalize(id, base);
  assert.deepEqual(
    await f.call(url, undefined, 200, "admin-1", key, payload),
    saved,
  );
  assert.equal(f.store.snapshot().groupAssessmentFiles.length, 20);
});
