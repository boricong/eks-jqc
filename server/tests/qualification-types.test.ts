import { loadPlanningFixture } from "./planning-migration-helper.ts";
import { historicalContent } from "./historical-content.ts";
import { legacyPlanFixture } from "./legacy-plan-fixture.ts";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { seedState } from "../src/seed.ts";
import { seedOrganizations } from "../src/organizations.ts";
import { JsonStore } from "../src/storage.ts";
import { buildApp } from "./release-test-app.ts";
import { migrateTemplates } from "../src/template-migration.ts";
import {
  metadata,
  currentQualification,
} from "../src/qualification-templates.ts";
import { exportMaster, readMaster, contentHash } from "./legacy-master-data.ts";
async function fixture(
  t: TestContext,
  prepare?: (s: ReturnType<typeof seedState>) => void,
) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-template-")),
    file = path.join(dir, "runtime/state.json"),
    seed = seedState(true);
  seed.users.push({
    id: "detail",
    name: "세부 관리자",
    organizationId: "org-photo",
    roles: ["learner"],
    revision: 1,
    organizationAdministration: {
      organizationId: "org-photo",
      grantedBy: "admin-1",
      grantedAt: "2026-10-23T00:00:00.000Z",
    },
  });
  prepare?.(seed);
  await new JsonStore(file).initialize(seed);
  const store = await loadPlanningFixture(file),
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
    status: number | number[] = 200,
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
    assert(
      (Array.isArray(status) ? status : [status]).includes(r.statusCode),
      `${r.statusCode}: ${r.body}`,
    );
    return r.json();
  }
  return { store, app, call, file };
}
import { migrateQualificationTypes } from "../src/qualification-type-migration.ts";
import { validateState } from "../src/integrity.ts";
import { addQualification, addCertification } from "./dashboard-fixtures.ts";
import {
  WORKFLOW_VERSION,
  qualificationUseErrors,
  recordQualificationType,
} from "@eks/contracts";

const baseInput = {
  title: "협력업체 Auditor",
  englishName: "Supplier Auditor",
  description: "현장 심사 최소 역량",
};
const fieldInput = (t: any, type?: string) => ({
  ...baseInput,
  revision: t.revision,
  ...(type
    ? {
        qualificationType: type,
        ...(type === "auditor" ? { auditorLevel: "general" } : {}),
      }
    : {}),
});

test("유형 생성 기본값·권한·변경 이력·등록/삭제 이력 이후 잠금과 입력 위조", async (t) => {
  const f = await fixture(t);
  for (const actor of ["learner-1", "admin-1", "detail"])
    await f.call(
      actor,
      "/system/qualification-templates",
      { ...baseInput, qualificationType: "auditor", auditorLevel: "general" },
      403,
    );
  await f.call(
    "operator-1",
    "/system/qualification-templates",
    { ...baseInput, qualificationType: "unknown" },
    422,
  );
  let template = await f.call(
    "operator-1",
    "/system/qualification-templates",
    baseInput,
  );
  assert.equal(template.qualificationType, "auditee");
  template = await f.call(
    "operator-1",
    `/system/qualification-templates/${template.id}`,
    fieldInput(template, "auditor"),
    200,
    "PUT",
  );
  assert.equal(template.qualificationType, "auditor");
  template = await f.call(
    "operator-1",
    `/system/qualification-templates/${template.id}`,
    fieldInput(template),
    200,
    "PUT",
  );
  assert.equal(
    template.qualificationType,
    "auditor",
    "old callers retain existing type",
  );
  const registered = await f.call(
    "admin-1",
    "/qualification-templates/import",
    {
      templateIds: [template.id],
      templateRevisions: { [template.id]: template.revision },
    },
  );
  const q = f.store
    .snapshot()
    .qualifications.find((q) => q.id === registered.imported[0])!;
  assert.equal(q.qualificationType, "auditor");
  const listed = await f.call("operator-1", "/system/qualification-templates");
  assert.equal(
    listed.items.find((t: any) => t.id === template.id).canChangeType,
    false,
  );
  const events = listed.audits.filter((a: any) => a.targetId === template.id);
  assert(
    events.some(
      (a: any) =>
        a.details.before?.qualificationType === "auditee" &&
        a.details.after?.qualificationType === "auditor",
    ),
  );
  await f.call(
    "operator-1",
    `/system/qualification-templates/${template.id}`,
    fieldInput(template, "auditee"),
    409,
    "PUT",
  );
  await f.call(
    "admin-1",
    `/qualifications/${q.id}`,
    { ...q, qualificationType: "auditee" },
    422,
    "PUT",
  );
  await f.store.transact(
    "operator-1",
    randomUUID(),
    "fixture deleted criteria",
    () => {},
    (s) => {
      Object.assign(
        s.qualifications.find((x) => x.id === q.id)!,
        {
          deletedAt: new Date().toISOString(),
          deletedBy: "admin-1",
          deletionReason: "시험 삭제",
        },
      );
      return {};
    },
  );
  await f.call(
    "operator-1",
    `/system/qualification-templates/${template.id}`,
    fieldInput(template, "auditee"),
    409,
    "PUT",
  );
});

test("등록과 유형 수정이 동시에 요청되어도 팀/기본자격 유형은 원자적으로 일치한다", async (t) => {
  const f = await fixture(t);
  const template = await f.call(
    "operator-1",
    "/system/qualification-templates",
    baseInput,
  );
  // Warm sessions before concurrent transactions.
  await f.call("admin-1", "/qualification-templates");
  const [registered] = await Promise.all([
    f.call("admin-1", "/qualification-templates/import", {
      templateIds: [template.id],
      templateRevisions: {
        [template.id]: f.store
          .snapshot()
          .qualificationTemplates.find((t) => t.id === template.id)!.revision,
      },
    }),
    f.call(
      "operator-1",
      `/system/qualification-templates/${template.id}`,
      fieldInput(template, "auditor"),
      [200, 409],
      "PUT",
    ),
  ]);
  assert.equal(registered.imported.length, 1);
  // A type edit that wins the transaction race is also safe: registration inherits it.
  const s = f.store.snapshot();
  assert.equal(
    s.qualifications.find((q) => q.templateId === template.id)!
      .qualificationType,
    s.qualificationTemplates.find((t) => t.id === template.id)!
      .qualificationType,
  );
  validateState(s, f.store.organizations.snapshot());
});

test("Auditor 개별 기준 저장·JSON10 왕복은 허용하고 구형 팀 적용과 유형 위조를 거부한다", async (t) => {
  const f = await fixture(t);
  const template = await f.call(
    "operator-1",
    "/system/qualification-templates",
    { ...baseInput, qualificationType: "auditor", auditorLevel: "general" },
  );
  const registered = await f.call(
    "admin-1",
    "/qualification-templates/import",
    {
      templateIds: [template.id],
      templateRevisions: { [template.id]: template.revision },
    },
  );
  let q = f.store
    .snapshot()
    .qualifications.find((q) => q.id === registered.imported[0])!;
  const auditorCourse = await f.call("admin-1", "/courses", {
    title: "Auditor 기준 인증Set",
    qualificationType: "auditor",
  });
  const saved = await f.call(
    "admin-1",
    `/qualifications/${q.id}`,
    {
      ...q,
      validity: { type: "months", months: 36, reminderDays: [] },
      courseIds: [auditorCourse.id],
    },
    200,
    "PUT",
  );
  q = f.store.snapshot().qualifications.find((q) => q.id === saved.id)!;
  assert.equal(q.qualificationType, "auditor");
  assert(
    qualificationUseErrors(q, f.store.snapshot().courses).some((e) =>
      e.includes("Auditor"),
    ),
  );
  await f.call(
    "admin-1",
    "/organization-policies/org-photo/qualification-pool",
    {
      revision: f.store.organizations.snapshot().revision,
      qualificationIds: [q.id],
    },
    410,
    "PUT",
  );
  await f.call(
    "admin-1",
    "/organization-settings/org-photo",
    {
      revision: f.store.organizations.snapshot().revision,
      description: "",
      duties: "",
    },
    200,
    "PUT",
  );
  const master = exportMaster(
    f.store.snapshot(),
    f.store.organizations.snapshot(),
    new Date().toISOString(),
  );
  assert.equal(master.formatVersion, 15);
  assert.equal(master.stateSchemaVersion, 26);
  assert.equal(
    readMaster(master).payload.qualifications.find((x) => x.id === q.id)!
      .qualificationType,
    "auditor",
  );
  const mismatched = structuredClone(master);
  mismatched.payload.qualifications.find(
    (x) => x.id === q.id,
  )!.qualificationType = "auditee";
  mismatched.sha256 = contentHash(mismatched.payload);
  assert.throws(() => readMaster(mismatched), /유형 불일치|Auditor 기준 근거/);
  const missingType: any = structuredClone(master);
  delete missingType.payload.qualifications[0].qualificationType;
  missingType.sha256 = contentHash(missingType.payload);
  assert.throws(() => readMaster(missingType), /인증 유형이 누락/);
});

function auditorProgress(s: ReturnType<typeof seedState>) {
  const q = s.qualifications.find((q) => q.id === "demo-qualification")!;
  q.qualificationType = "auditor";
  for (const c of s.courses.filter((c) => q.courseIds.includes(c.id)))
    c.qualificationType = "auditor";
  s.qualificationTemplates.find(
    (t) => t.id === q.templateId,
  )!.qualificationType = "auditor";
  for (const a of s.assignments.filter((a) => a.qualificationId === q.id))
    a.qualificationMetadata = metadata(q);
  const a = s.assignments.find((a) => a.qualificationId === q.id)!;
  const e = s.enrollments.find((e) => e.assignmentId === a.id)!;
  s.attempts = s.attempts.filter((t) => t.enrollmentId !== e.id);
  s.attempts.push({
    id: "auditor-draft",
    enrollmentId: e.id,
    learnerId: a.learnerId,
    courseId: e.courseId,
    kind: "objective",
    round: 20,
    status: "in_progress",
    revision: 1,
    createdAt: "2026-10-25T00:00:00.000Z",
    answers: {},
  });
  s.planningRequests.push({
    qualificationType: "auditee",
    id: "auditor-request",
    lv1OrganizationId: "org-photo",
    learnerId: a.learnerId,
    requestedBy: "admin-1",
    dueOn: "2027-12-31",
    message: "fixture",
    createdAt: "2026-10-25T00:00:00.000Z",
    revision: 1,
    organizationId: "org-photo",
    mode: "fixed",
    selections: [
      {
        entityId: q.entityId,
        qualificationId: q.id,
        title: q.title,
        version: q.version!,
      },
    ],
  });
  s.plans.push({
    id: "auditor-plan",
    requestId: "auditor-request",
    qualificationId: q.id,
    learnerId: a.learnerId,
    lv1OrganizationId: "org-photo",
    organizationId: "org-photo",
    workflowVersion: WORKFLOW_VERSION,
    status: "draft",
    revision: 1,
    createdAt: "2026-10-25T00:00:00.000Z",
    updatedAt: "2026-10-25T00:00:00.000Z",
    endOn: "2027-12-31",
    startOn: "2027-01-01",
    goal: "",
  });
}
test("Auditor를 기존 평가 응시 근거로 위조하면 무결성 검사에서 거부한다", () => {
  const s = seedState(true);
  auditorProgress(s);
  assert.throws(
    () => validateState(s, seedOrganizations()),
    /계획 요청|응시의 수강/,
  );
});

test("13→15 유형 보존 이관은 원본·개별 수정번호·발급 기간을 유지하고 실패/재실행을 보호한다", async (t) => {
  const f = await fixture(t, (s) => {
    const seed = { state: s, orgs: seedOrganizations() };
    const q = addQualification(seed, "migration-qualified");
    addCertification(seed, "migration-cert", "learner-2", {
      qualificationId: q.id,
      expiresOn: "2027-01-01",
    });
  });
  const raw: any = f.store.snapshot();
  await f.app.close();
  raw.schemaVersion = 13;
  legacyPlanFixture(raw);
  const values = [
    ...raw.qualificationTemplates,
    ...raw.qualifications,
    ...[...raw.plans, ...raw.assignments, ...raw.certifications].flatMap(
      (r: any) => (r.qualificationMetadata ? [r.qualificationMetadata] : []),
    ),
  ];
  for (const v of values) delete v.qualificationType;
  await writeFile(f.file, JSON.stringify(raw));
  const before = await readFile(f.file),
    org = await readFile(f.store.organizations.file);
  const hash = (v: Buffer) => createHash("sha256").update(v).digest("hex");
  const expected = {
    revision: raw.revision,
    stateHash: hash(before),
    organizationHash: hash(org),
  };
  const preview = migrateQualificationTypes(raw, JSON.parse(org.toString()));
  assert.equal(preview.state.schemaVersion, 28);
  assert.equal(preview.state.revision, raw.revision + 15);
  const normalized = JSON.parse(JSON.stringify(preview.state));
  normalized.schemaVersion = 13;
  normalized.revision -= 15;
  normalized.audits.splice(-15 - raw.planningRequests.length);
  normalized.qualificationTemplates.forEach((t: any) => delete t.scope);
  for (const v of [
    ...normalized.qualificationTemplates,
    ...normalized.qualifications,
    ...[
      ...normalized.plans,
      ...normalized.assignments,
      ...normalized.certifications,
    ].flatMap((r: any) =>
      r.qualificationMetadata ? [r.qualificationMetadata] : [],
    ),
  ])
    delete v.qualificationType;
  assert.deepEqual(historicalContent(normalized), historicalContent(raw));
  assert.deepEqual(
    historicalContent(preview.state.certifications),
    raw.certifications.map((c: any) => ({
      ...historicalContent(c),
      qualificationMetadata: {
        ...c.qualificationMetadata,
        qualificationType: "auditee",
      },
    })),
  );
  const incomplete: any = structuredClone(preview.state);
  delete incomplete.qualifications[0].qualificationType;
  assert.throws(
    () => validateState(incomplete, preview.organizations),
    /인증 유형 누락/,
  );
  const disk = new JsonStore(f.file);
  disk.beforeReplace = () => {
    throw new Error("fixture interrupted");
  };
  await assert.rejects(
    disk.migratePolicies(
      expected,
      migrateQualificationTypes,
      "qualification-types",
    ),
    /interrupted/,
  );
  assert.deepEqual(await readFile(f.file), before);
  assert.deepEqual(await readFile(disk.organizations.file), org);
  disk.beforeReplace = undefined;
  const applied: any = await disk.migratePolicies(
    expected,
    migrateQualificationTypes,
    "qualification-types",
  );
  assert.deepEqual(await readFile(applied.stateBackup), before);
  const after = await readFile(f.file);
  await disk.migratePolicies(
    {
      ...expected,
      revision: JSON.parse(after.toString()).revision,
      stateHash: hash(after),
    },
    migrateQualificationTypes,
  );
  assert.deepEqual(await readFile(f.file), after);
  const restarted = await loadPlanningFixture(f.file);
  await restarted.close();
  const broken = structuredClone(raw);
  broken.qualifications[0].qualificationType = "auditor";
  assert.throws(
    () => migrateQualificationTypes(broken, JSON.parse(org.toString())),
    /예상하지 못한/,
  );
});

test("구형 기본정보는 Auditee로 변환하며 인증서 유형은 URL 대신 발급/배정 보존정보를 따른다", () => {
  const s = seedState(true),
    org = seedOrganizations();
  const file: any = exportMaster(s, org, new Date().toISOString());
  delete file.payload.commonCourses;
  delete file.counts.commonCourses;
  delete file.payload.commonCourses;
  delete file.counts.commonCourses;
  file.formatVersion = 3;
  delete file.counts.organizationQualificationRequirements;
  delete file.counts.subjectiveQuestions;
  file.organizationSchemaVersion = 2;
  file.payload.organizations.qualificationPools = [];
  file.counts.poolEntries = 0;
  file.stateSchemaVersion = 13;
  for (const q of [
    ...file.payload.qualifications,
    ...file.payload.qualificationTemplates,
  ])
    delete q.qualificationType;
  file.sha256 = contentHash(file.payload);
  const parsed = readMaster(file);
  assert(
    parsed.payload.qualifications.every(
      (q) => q.qualificationType === "auditee",
    ),
  );
  const q = { qualificationType: "auditee" as const };
  assert.equal(
    recordQualificationType(q, {
      qualificationMetadata: { qualificationType: "auditor" },
    }),
    "auditor",
  );
  assert.equal(
    recordQualificationType(q, {
      qualificationMetadata: { qualificationType: "auditee" },
      certification: {
        qualificationMetadata: { qualificationType: "auditor" },
      },
    }),
    "auditor",
  );
});

test("Auditor 인증 조회는 가능하지만 재인증 시작/완료 직접 호출은 거부한다", async (t) => {
  const f = await fixture(t, (s) => {
    const seed = { state: s, orgs: seedOrganizations() };
    const q = addQualification(seed, "auditor-existing", {
      qualificationType: "auditor",
    });
    const c = addCertification(seed, "auditor-cert", "learner-2", {
      qualificationId: q.id,
      expiresOn: "2027-01-01",
    });
    s.renewals.push({
      id: "auditor-renewal",
      certificationId: c.id,
      periodId: c.periods![0]!.id,
      learnerId: c.learnerId,
      lv1OrganizationId: "org-photo",
      qualificationId: q.id,
      qualificationRevision: q.revision,
      validity: c.validity!,
      renewalLeadMonths: 3,
      revision: 1,
      status: "draft",
      startedAt: "2026-10-25T00:00:00.000Z",
      method: "mvp_completion",
    });
  });
  const history = await f.call(
    "learner-2",
    "/certifications/auditor-cert/history",
  );
  assert(history);
  for (const url of [
    "/certifications/auditor-cert/renewals",
    "/renewals/auditor-renewal/complete",
  ]) {
    const response = await f.call(
      "learner-2",
      url,
      { certificationRevision: 1 },
      409,
    );
    assert.equal(response.code, "RENEWAL_UNAVAILABLE");
  }
  assert.equal(
    f.store.snapshot().certifications.find((c) => c.id === "auditor-cert")!
      .periods!.length,
    1,
  );
  assert.equal(
    f.store.snapshot().renewals.find((r) => r.id === "auditor-renewal")!.status,
    "draft",
  );
});
