import { legacyPlanFixture } from "./legacy-plan-fixture.ts";
import { currentTeamQualifications } from "@eks/contracts";
import { registerFixtureQualification } from "./template-helpers.ts";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { qualificationUseErrors, type State } from "@eks/contracts";
import { seedState } from "../src/seed.ts";
import { seedOrganizations } from "../src/organizations.ts";
import { JsonStore } from "../src/storage.ts";
import { buildApp } from "../src/app.ts";
import { migrateCatalogEditing } from "../src/catalog-editing-migration.ts";
import {
  exportMaster,
  readMaster,
  masterCandidate,
  contentHash,
} from "../src/master-data.ts";

async function fixture(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-editing-")),
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
    url: string,
    body?: any,
    method: any = body === undefined ? "GET" : "POST",
    status = 200,
    actor = "admin-1",
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
    const r = await app.inject({
      method,
      url: "/api" + url,
      headers: { cookie: cookies.get(actor)!, "idempotency-key": key },
      ...(body === undefined ? {} : { payload: body }),
    });
    assert.equal(r.statusCode, status, r.body);
    return r.json();
  }
  return { store, call, file, app };
}
test("직접 저장은 미완성을 허용하고 참조된 기준만 새 버전으로 보존하며 재시도는 한 번이다", async (t) => {
  const f = await fixture(t),
    original = f.store.snapshot();
  const created = await registerFixtureQualification(f.store);
  const q = f.store.snapshot().qualifications.find((q) => q.id === created.id)!;
  const incomplete = await f.call(
    `/qualifications/${q.id}`,
    { ...q, renewalLeadMonths: 4 },
    "PUT",
  );
  assert.equal(incomplete.id, q.id);
  assert.ok(incomplete.readiness.length);
  assert.equal(incomplete.revision, 2);
  const c = original.courses.find((c) => c.id === "demo-course-1")!,
    body = { ...c, title: "새 지식 기준" };
  const preview = await f.call(`/courses/${c.id}/save-preview`, body);
  assert.equal(preview.newVersion, true);
  const key = randomUUID(),
    payload = {
      ...body,
      stateRevision: preview.stateRevision,
      organizationRevision: preview.organizationRevision,
    };
  const saved = await f.call(
    `/courses/${c.id}`,
    payload,
    "PUT",
    200,
    "admin-1",
    key,
  );
  assert.notEqual(saved.id, c.id);
  assert.equal(saved.version, 2);
  assert.deepEqual(
    await f.call(`/courses/${c.id}`, payload, "PUT", 200, "admin-1", key),
    saved,
  );
  assert.deepEqual(
    f.store.snapshot().courses.find((x) => x.id === c.id),
    c,
  );
  assert.deepEqual(f.store.snapshot().assignments, original.assignments);
  assert.deepEqual(
    f.store
      .snapshot()
      .qualifications.find((q) => q.id === "demo-qualification"),
    original.qualifications.find((q) => q.id === "demo-qualification"),
  );
  const next = f.store.snapshot().courses.find((x) => x.id === saved.id)!;
  assert.equal(
    (await f.call(`/courses/${next.id}`, next, "PUT")).unchanged,
    true,
  );
  await f.call(`/courses/${next.id}/publish`, next, "POST", 410);
  await f.call(`/courses/${next.id}`, { ...next, status: "draft" }, "PUT", 409);
});
test("최신 버전 삭제는 이전 기준으로 돌아가고 마지막 삭제는 필수 지정과 함께 보존 처리한다", async (t) => {
  const f = await fixture(t),
    before = f.store.snapshot();
  const q = before.qualifications.find((q) => q.id === "demo-qualification")!;
  const nextId = randomUUID();
  await f.store.transact(
    "operator-1",
    randomUUID(),
    "new-version",
    () => {},
    (s) => {
      s.qualifications.push({
        ...structuredClone(q),
        id: nextId,
        version: q.version! + 1,
        parentId: q.id,
      });
      return {};
    },
  );
  await f.store.organizations.transact(
    "operator-1",
    randomUUID(),
    "required",
    () => {},
    (doc) => {
      return {};
    },
  );
  let impact = await f.call("/qualifications/" + nextId + "/deletion-impact");
  assert.equal(impact.canDelete, true);
  assert.equal(impact.replacement.id, q.id);
  await f.call(
    "/qualifications/" + nextId,
    { ...impact, reason: "최신 기준 삭제" },
    "DELETE",
  );
  assert.equal(
    currentTeamQualifications(f.store.snapshot()).find(
      (r) => r.entityId === q.entityId,
    )!.qualificationId,
    q.id,
  );
  impact = await f.call("/qualifications/" + q.id + "/deletion-impact");
  assert.equal(impact.replacement, null);
  const key = randomUUID(),
    body = { ...impact, reason: "마지막 기준 삭제" };
  const result = await f.call(
    "/qualifications/" + q.id,
    body,
    "DELETE",
    200,
    "admin-1",
    key,
  );
  assert.deepEqual(
    await f.call(
      "/qualifications/" + q.id,
      body,
      "DELETE",
      200,
      "admin-1",
      key,
    ),
    result,
  );
  assert.deepEqual(f.store.snapshot().assignments, before.assignments);
  assert.deepEqual(f.store.snapshot().courses, before.courses);
  assert.ok(
    f.store.snapshot().qualifications.find((x) => x.id === q.id)!.deletedAt,
  );
});
test("미참조 팀 등록도 계보 보존 삭제·권한·최신 참조·백업 실패와 응답 유실 재시도를 보호한다", async (t) => {
  const f = await fixture(t),
    q = await registerFixtureQualification(f.store);
  await f.call(
    `/qualifications/${q.id}/deletion-impact`,
    undefined,
    "GET",
    403,
    "learner-1",
  );
  let impact = await f.call(`/qualifications/${q.id}/deletion-impact`);
  assert.equal(impact.mode, "archive");
  const snapshot = await readFile(f.file, "utf8");
  f.store.beforeReplace = () => {
    throw new Error("disk failure");
  };
  await f.call(
    `/qualifications/${q.id}`,
    { ...impact, reason: "실패 시험" },
    "DELETE",
    503,
  );
  assert.equal(await readFile(f.file, "utf8"), snapshot);
  f.store.beforeReplace = undefined;
  await registerFixtureQualification(f.store);
  await f.call(
    `/qualifications/${q.id}`,
    { ...impact, reason: "이전 확인" },
    "DELETE",
    409,
  );
  impact = await f.call(`/qualifications/${q.id}/deletion-impact`);
  const key = randomUUID(),
    body = { ...impact, reason: "미사용 기준 정리" };
  await f.call(`/qualifications/${q.id}`, body, "DELETE", 200, "admin-1", key);
  await f.call(`/qualifications/${q.id}`, body, "DELETE", 200, "admin-1", key);
  assert.ok(
    f.store.snapshot().qualifications.find((x) => x.id === q.id)!.deletedAt,
  );
});
test("10→11 명시적 이관과 새 이전 파일은 내용·진행·삭제 표시를 보존하고 반복 이관은 무변경이다", () => {
  const source: any = seedState(true),
    org = seedOrganizations();
  source.schemaVersion = 10;
  for (const x of [...source.courses, ...source.qualifications]) {
    x.status = "published";
    x.publishedAt = "2026-10-15T00:00:00.000Z";
  }
  const next = migrateCatalogEditing(source, org, "2026-10-22T00:00:00.000Z");
  assert.equal(next.state.schemaVersion, 25);
  assert.deepEqual(next.state.assignments, source.assignments);
  assert.deepEqual(next.organizations, org);
  assert.ok(next.state.qualifications.every((q) => !("status" in q)));
  assert.deepEqual(migrateCatalogEditing(next.state, org).state, next.state);
  const q = next.state.qualifications[0]!;
  q.deletedAt = "2026-10-22T00:00:00.000Z";
  q.deletedBy = "admin-1";
  q.deletionReason = "보존";
  const file = exportMaster(next.state, org, "2026-10-22T00:00:00.000Z");
  const copied = masterCandidate(readMaster(file).payload, 0, 0);
  assert.equal(copied.state.qualifications[0]!.deletedAt, q.deletedAt);
  const legacy: any = exportMaster(next.state, org, "2026-10-22T00:00:00.000Z");
  delete legacy.payload.commonCourses;
  delete legacy.counts.commonCourses;
  legacy.formatVersion = 1;
  delete legacy.counts.organizationQualificationRequirements;
  delete legacy.counts.subjectiveQuestions;
  legacy.organizationSchemaVersion = 2;
  legacy.payload.organizations.qualificationPools = [];
  legacy.counts.poolEntries = 0;
  legacy.stateSchemaVersion = 10;
  for (const x of [
    ...legacy.payload.courses,
    ...legacy.payload.qualifications,
  ]) {
    x.status = "draft";
  }
  legacy.sha256 = contentHash(legacy.payload);
  assert.throws(() => readMaster(legacy), /허용되지 않는 항목|파일/); // New-only template payload cannot masquerade as a legacy file.
});

test("스키마11 이관의 중간 실패는 파일 쌍·세대를 복구하고 성공 시 한 번만 세대를 바꾼다", async (t) => {
  const f = await fixture(t);
  await f.app.close();
  const raw: any = JSON.parse(await readFile(f.file, "utf8"));
  raw.schemaVersion = 10;
  legacyPlanFixture(raw);
  raw.qualifications.forEach((q: any) => (q.status = "published"));
  raw.courses.forEach((c: any) => (c.status = "draft"));
  await writeFile(f.file, JSON.stringify(raw));
  const original = await readFile(f.file),
    org = await readFile(f.store.organizations.file),
    meta = await readFile(f.store.maintenanceFile);
  const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const expected = {
    revision: raw.revision,
    stateHash: hash(original),
    organizationHash: hash(org),
  };
  const broken = new JsonStore(f.file);
  broken.beforeReplace = () => {
    throw Error("migration failure");
  };
  await assert.rejects(
    broken.migratePolicies(expected, migrateCatalogEditing, "catalog-editing"),
    /migration failure/,
  );
  assert.deepEqual(await readFile(f.file), original);
  assert.deepEqual(await readFile(f.store.organizations.file), org);
  assert.deepEqual(await readFile(f.store.maintenanceFile), meta);
  const result: any = await new JsonStore(f.file).migratePolicies(
    expected,
    migrateCatalogEditing,
    "catalog-editing",
  );
  assert.deepEqual(await readFile(result.stateBackup), original);
  assert.deepEqual(await readFile(result.organizationBackup), org);
  const after = await readFile(f.file),
    nextMeta = await readFile(f.store.maintenanceFile);
  assert.notEqual(
    JSON.parse(nextMeta.toString()).generation,
    JSON.parse(meta.toString()).generation,
  );
  assert.deepEqual(await readFile(f.store.organizations.file), org);
  await new JsonStore(f.file).migratePolicies(
    {
      ...expected,
      revision: JSON.parse(after.toString()).revision,
      stateHash: hash(after),
    },
    migrateCatalogEditing,
    "catalog-editing",
  );
  assert.deepEqual(await readFile(f.file), after);
  assert.deepEqual(await readFile(f.store.maintenanceFile), nextMeta);
});

test("보존 삭제 후 확정 배정은 원래 평가로 수료·인증하며 보유 근거를 삭제하지 않는다", async (t) => {
  const f = await fixture(t),
    original = f.store.snapshot();
  const q = original.qualifications.find((q) => q.id === "demo-qualification")!;
  const impact = await f.call("/qualifications/" + q.id + "/deletion-impact");
  await f.call(
    "/qualifications/" + q.id,
    { ...impact, reason: "관리 목록 정리" },
    "DELETE",
  );
  for (const e of original.enrollments.filter(
    (e) =>
      original.assignments.find((a) => a.id === e.assignmentId)
        ?.qualificationId === q.id,
  )) {
    const c = original.courses.find((c) => c.id === e.courseId)!;
    for (const kind of ["objective", "practical"] as const) {
      if (
        !c.assessmentKinds.includes(kind) ||
        f.store
          .snapshot()
          .attempts.some(
            (a) =>
              a.enrollmentId === e.id &&
              a.kind === kind &&
              a.result === "passed",
          )
      )
        continue;
      const attempt = await f.call(
        "/enrollments/" + encodeURIComponent(e.id) + "/attempts",
        { kind },
        "POST",
        200,
        "learner-1",
      );
      const answers = Object.fromEntries(
        (kind === "objective" ? c.questions : c.practicalQuestions).map((q) => [
          q.id,
          q.correct,
        ]),
      );
      await f.call(
        "/attempts/" + attempt.id + "/draft",
        { revision: attempt.revision, answers },
        "PUT",
        200,
        "learner-1",
      );
      await f.call(
        "/attempts/" + attempt.id + "/submit",
        { revision: attempt.revision + 1 },
        "POST",
        200,
        "learner-1",
      );
    }
  }
  const next = f.store.snapshot();
  assert.ok(next.certifications.some((c) => c.qualificationId === q.id));
  assert.deepEqual(next.courses, original.courses);
  const legacyAwards = next.certifications;
  await registerFixtureQualification(f.store);
  assert.deepEqual(f.store.snapshot().certifications, legacyAwards);
});

test("팀 자격 마이너 선택·기본 호환·순서 무변경과 완료 배정의 저장 전 기준 고정", async (t) => {
  const f = await fixture(t),
    before = f.store.snapshot();
  const q = before.qualifications.find((q) => q.id === "demo-qualification")!;
  const current = { ...q, versionMode: "current", renewalLeadMonths: 4 };
  const preview = await f.call(`/qualifications/${q.id}/save-preview`, current);
  assert.equal(preview.versionPolicy.changeKind, "minor");
  assert.equal(preview.newVersion, false);
  assert.deepEqual(f.store.snapshot(), before);
  const key = randomUUID();
  const body = {
    ...current,
    stateRevision: preview.stateRevision,
    organizationRevision: preview.organizationRevision,
  };
  const originalFile = await readFile(f.file, "utf8");
  f.store.beforeReplace = () => {
    throw new Error("snapshot save failure");
  };
  await f.call(`/qualifications/${q.id}`, body, "PUT", 503, "admin-1", key);
  assert.deepEqual(f.store.snapshot(), before);
  assert.equal(await readFile(f.file, "utf8"), originalFile);
  f.store.beforeReplace = undefined;
  const saved = await f.call(
    `/qualifications/${q.id}`,
    body,
    "PUT",
    200,
    "admin-1",
    key,
  );
  assert.equal(saved.id, q.id);
  assert.equal(saved.version, q.version);
  assert.equal(saved.revision, q.revision + 1);
  assert.deepEqual(
    await f.call(`/qualifications/${q.id}`, body, "PUT", 200, "admin-1", key),
    saved,
  );
  const after = f.store.snapshot();
  assert.deepEqual(after.courses, before.courses);
  for (const a of after.assignments.filter((a) => a.qualificationId === q.id)) {
    assert.deepEqual(a.qualificationPolicySnapshot?.validity, q.validity);
    assert.equal(
      a.qualificationPolicySnapshot?.renewalLeadMonths,
      q.renewalLeadMonths ?? 3,
    );
    const { qualificationPolicySnapshot: _, ...rest } = a;
    assert.deepEqual(
      rest,
      before.assignments.find((v) => v.id === a.id),
    );
  }
  const latest = after.qualifications.find((v) => v.id === q.id)!;
  const noChange = await f.call(
    `/qualifications/${q.id}`,
    {
      ...latest,
      courseIds: [...latest.courseIds].reverse(),
      versionMode: "new",
    },
    "PUT",
  );
  assert.equal(noChange.unchanged, true);
  assert.equal(noChange.version, latest.version);
  assert.equal(noChange.revision, latest.revision);
  assert.deepEqual(
    f.store.snapshot().qualifications.find((v) => v.id === q.id)?.courseIds,
    latest.courseIds,
  );
});

test("마이너 새 버전은 최대 번호 다음을 생성하고 메이저는 참조 없이도 강제한다", async (t) => {
  const f = await fixture(t);
  const original = f.store
    .snapshot()
    .qualifications.find((q) => q.id === "demo-qualification")!;
  for (const version of [2, 3]) {
    const result = await f.call(
      `/qualifications/${original.id}`,
      { ...original, renewalLeadMonths: version + 3, versionMode: "new" },
      "PUT",
    );
    assert.equal(result.version, version);
    assert.notEqual(result.id, original.id);
  }
  assert.deepEqual(
    f.store.snapshot().qualifications.find((q) => q.id === original.id),
    original,
  );
  const registered = await registerFixtureQualification(f.store);
  const ready = f.store
    .snapshot()
    .qualifications.find((q) => q.id === registered.id)!;
  await f.call(
    `/qualifications/${ready.id}`,
    { ...ready, renewalLeadMonths: 4 },
    "PUT",
  );
  const q = f.store
    .snapshot()
    .qualifications.find((q) => q.id === registered.id)!;
  const body = { ...q, courseIds: ["demo-course-1"] };
  const before = f.store.snapshot();
  const preview = await f.call(`/qualifications/${q.id}/save-preview`, {
    ...body,
    versionMode: "current",
  });
  assert.equal(preview.versionPolicy.requiresNewVersion, true);
  assert.equal(preview.versionPolicy.effectiveMode, "new");
  assert.deepEqual(f.store.snapshot(), before);
  const denied = await f.call(
    `/qualifications/${q.id}`,
    { ...body, versionMode: "current" },
    "PUT",
    409,
  );
  assert.equal(denied.code, "QUALIFICATION_NEW_VERSION_REQUIRED");
  assert.deepEqual(f.store.snapshot(), before);
  const saved = await f.call(`/qualifications/${q.id}`, body, "PUT");
  assert.equal(saved.version, 2);
  assert.equal(saved.newVersion, true);
  assert.equal(
    f.store.snapshot().qualifications.find((v) => v.id === q.id)?.courseIds
      .length,
    0,
  );
});

test("인증Set 삭제·버전 교체는 메이저, 검토 충돌·보존 불가는 원자적 차단", async (t) => {
  const f = await fixture(t),
    initial = f.store.snapshot();
  const q = initial.qualifications.find((q) => q.id === "demo-qualification")!;
  const remove = await f.call(`/qualifications/${q.id}/save-preview`, {
    ...q,
    courseIds: q.courseIds.slice(1),
    versionMode: "current",
  });
  assert.equal(remove.versionPolicy.changeKind, "major");
  await f.store.transact(
    "admin-1",
    randomUUID(),
    "new-course-version",
    () => {},
    (s) => {
      const c = s.courses.find((c) => c.id === q.courseIds[0])!;
      s.courses.push({
        ...structuredClone(c),
        id: "replacement-v2",
        parentId: c.id,
        version: 2,
      });
      return {};
    },
  );
  const replacement = await f.call(`/qualifications/${q.id}/save-preview`, {
    ...q,
    courseIds: ["replacement-v2", ...q.courseIds.slice(1)],
    versionMode: "current",
  });
  assert.equal(replacement.versionPolicy.requiresNewVersion, true);
  assert.ok(
    replacement.changes
      .find((v: any) => v.label === "인증Set 연결")
      .after.includes("v2"),
  );
  const before = f.store.snapshot();
  const stale = await f.call(
    `/qualifications/${q.id}`,
    {
      ...q,
      renewalLeadMonths: 4,
      versionMode: "current",
      stateRevision: initial.revision,
      organizationRevision: f.store.organizations.snapshot().revision,
    },
    "PUT",
    409,
  );
  assert.equal(stale.code, "REVISION_CONFLICT");
  const { saveCatalogItem } = await import("../src/catalog-editing.ts");
  await assert.rejects(
    f.store.transact(
      "admin-1",
      randomUUID(),
      "broken-reference",
      () => {},
      (s) => {
        s.enrollments = s.enrollments.filter(
          (e) => e.courseId !== q.courseIds[0],
        );
        return saveCatalogItem(
          s,
          f.store.organizations.snapshot(),
          "qualifications",
          q.id,
          { ...q, versionMode: "current", renewalLeadMonths: 4 },
          "org-photo",
        );
      },
    ),
    /안전하게 보존/,
  );
  assert.deepEqual(f.store.snapshot(), before);
});
