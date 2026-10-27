import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { seedState } from "../src/seed.ts";
import { JsonStore } from "../src/storage.ts";
import { buildApp } from "./release-test-app.ts";
import { validateState } from "../src/integrity.ts";

async function fixture(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-retired-comparison-"));
  const file = path.join(dir, "runtime", "state.json");
  const state = seedState(true),
    enrollment = state.enrollments[0]!;
  const assignment = state.assignments.find(
    (a) => a.id === enrollment.assignmentId,
  )!;
  state.comparisons.push({
    id: "historical-comparison",
    enrollmentId: enrollment.id,
    courseId: enrollment.courseId,
    learnerId: assignment.learnerId,
    ownerAdminId: "admin-1",
    revision: 1,
    status: "draft",
    attemptIds: [],
    observedAt: "",
    observer: "비공개 과거 관찰자",
    task: "과거 수행 작업",
    criterion: "과거 수행 기준",
    evidence: "보존해야 할 과거 근거",
    evidenceUrl: "",
    independence: "unknown",
    performance: "unknown",
    createdAt: "2026-10-16T00:00:00.000Z",
    correctionReason: "",
  });
  await new JsonStore(file).initialize(state);
  const store = await new JsonStore(file).load();
  const app = await buildApp(store, { serveFrontend: true });
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { store, file, app, enrollment };
}

test("종료된 비교 조회·생성·수정·확정·정정 API는 모든 역할에서 404이고 파일을 변경하지 않는다", async (t) => {
  const { store, app, enrollment, file } = await fixture(t);
  const before = store.snapshot(),
    bytes = await readFile(file, "utf8");
  for (const actorId of ["operator-1", "admin-1", "learner-1"]) {
    const login = await app.inject({
      method: "POST",
      url: "/api/session",
      payload: { actorId },
    });
    const cookie = `${login.cookies[0]!.name}=${login.cookies[0]!.value}`;
    for (const [method, endpoint] of [
      ["GET", "/comparisons"],
      ["GET", "/comparisons/historical-comparison"],
      ["POST", `/enrollments/${encodeURIComponent(enrollment.id)}/comparisons`],
      ["PUT", "/comparisons/historical-comparison"],
      ["POST", "/comparisons/historical-comparison/finalize"],
      ["POST", "/comparisons/historical-comparison/corrections"],
    ] as const) {
      const result = await app.inject({
        method,
        url: `/api${endpoint}?lv1OrganizationId=org-photo`,
        headers: { cookie, "idempotency-key": randomUUID() },
        ...(method === "GET" ? {} : { payload: { revision: 1 } }),
      });
      assert.equal(result.statusCode, 404, result.body);
      assert(!result.body.includes("과거 관찰자"));
    }
    const workspace = await app.inject({
      method: "GET",
      url: "/api/workspace?lv1OrganizationId=org-photo",
      headers: { cookie },
    });
    assert.equal(workspace.statusCode, 200, workspace.body);
    assert.equal("comparisons" in workspace.json(), false);
    assert(!workspace.body.includes("과거 관찰자"));
  }
  assert.deepEqual(store.snapshot(), before);
  assert.equal(await readFile(file, "utf8"), bytes);
});

test("과거 비교 자료는 schema13·파일 재시작·무결성 검사에서 보존되며 현재 평가 근거를 바꾸지 않는다", async (t) => {
  const { store, app, file } = await fixture(t);
  const before = store.snapshot();
  validateState(before);
  await app.close();
  const reopened = await new JsonStore(file).load();
  try {
    const restored = reopened.snapshot();
    assert.equal(restored.schemaVersion, 26);
    assert.deepEqual(restored.comparisons, before.comparisons);
    for (const field of [
      "attempts",
      "completions",
      "certifications",
      "audits",
      "requests",
    ] as const)
      assert.deepEqual(restored[field], before[field]);
    validateState(restored);
  } finally {
    await reopened.close();
  }
});
