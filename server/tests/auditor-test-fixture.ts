import { createPoolQualification, startInput } from "./auditor-fixture.ts";
import { saveTemplate } from "../src/qualification-templates.ts";
import { userView } from "../src/organizations.ts";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { seedState } from "../src/seed.ts";
import { JsonStore } from "../src/storage.ts";
import { buildApp } from "../src/app.ts";
import { validateState } from "../src/integrity.ts";
import { migrateAuditorProgram } from "../src/auditor-program-migration.ts";
import {
  exportMaster,
  readMaster,
  masterCandidate,
  contentHash,
} from "../src/master-data.ts";

export async function setup(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-auditor-program-")),
    file = path.join(dir, "runtime/state.json");
  const seed = seedState(true);
  seed.users.push({
    id: "detail-auditor",
    name: "세부 관리자",
    roles: ["learner"],
    organizationId: "org-photo",
    revision: 1,
    organizationAdministration: {
      organizationId: "org-photo",
      grantedBy: "admin-1",
      grantedAt: "2026-10-26T00:00:00.000Z",
    },
  });
  await new JsonStore(file).initialize(seed);
  const store = await new JsonStore(file).load();
  let at = "2026-10-26T01:00:00.000Z";
  const app = await buildApp(store, { clock: () => at }),
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
  async function update(fn: (s: ReturnType<typeof seedState>) => void) {
    return store.transact(
      "operator-1",
      randomUUID(),
      randomUUID(),
      () => {},
      (s) => {
        fn(s);
        return {};
      },
    );
  }
  async function program(level: "general" | "main" = "general") {
    let created: { id: string };
    await update((s) => {
      created = createPoolQualification(
        s,
        userView(
          s.users.find((u) => u.id === "admin-1")!,
          store.organizations.snapshot(),
        ),
        "org-photo",
        { level, title: level === "general" ? "일반 심사원" : "메인 심사원" },
        at,
      );
    });
    await update((s) => {
      const q = s.qualifications.find((q) => q.id === created!.id)!;
      const c = structuredClone(
        s.courses.find((c) => c.id === "demo-course-1")!,
      );
      c.id = randomUUID();
      c.entityId = c.id;
      c.qualificationType = "auditor";
      c.assessmentKinds = [];
      c.questions = [];
      c.practicalQuestions = [];
      c.learningItems = [
        {
          id: randomUUID(),
          title: "운영 기준 원문 확인",
          type: "team",
          required: true,
        },
      ];
      s.courses.push(c);
      q.courseIds = [c.id];
      q.validity = { type: "months", months: 12, reminderDays: [] };
      q.lifecycleStatus = "Active";
    });
    const current = await call("admin-1", "/auditor-program");
    await call(
      "admin-1",
      "/auditor-program",
      {
        revision: current.program?.revision || 0,
        notice: {
          title: "Auditor 지정 안내",
          body: "필수 교육 및 인증기준을 확인해 주세요.",
          links: [{ title: "자료", url: "https://example.com/training" }],
        },
      },
      200,
      "PUT",
    );
    return created!.id as string;
  }
  async function designate(
    roles = ["learner", "evaluator"],
    status = 200,
    key = randomUUID(),
  ) {
    const u = store.snapshot().users.find((u) => u.id === "learner-2")!;
    return call(
      "operator-1",
      `/system/users/${u.id}`,
      {
        revision: u.revision,
        name: u.name,
        organizationId: u.organizationId,
        roles,
      },
      status,
      "PATCH",
      key,
    );
  }
  async function complete(id: string) {
    for (const e of store
      .snapshot()
      .enrollments.filter((e) => e.assignmentId === id)) {
      const c = store.snapshot().courses.find((c) => c.id === e.courseId)!;
      for (const item of c.learningItems.filter((i) => i.required)) {
        const revision =
          store
            .snapshot()
            .learningChecklists.find((l) => l.enrollmentId === e.id)
            ?.revision || 0;
        await call(
          "learner-2",
          `/enrollments/${e.id}/checklist`,
          { revision, itemId: item.id, checked: true },
          200,
          "PUT",
        );
      }
    }
  }
  return {
    store,
    app,
    file,
    call,
    update,
    program,
    designate,
    complete,
    setTime: (value: string) => {
      at = value;
    },
  };
}
