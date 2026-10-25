import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import {
  addCalendarMonths,
  assessmentQuestions,
  organizationEntries,
  periodExpiry,
  type Certification,
  type OrganizationDocument,
  type PersonalPlan,
  type Qualification,
  type State,
  type ValidityPolicy,
} from "@eks/contracts";
import { buildApp } from "../src/app.ts";
import { seedState } from "../src/seed.ts";
import { JsonStore } from "../src/storage.ts";

export const DASHBOARD_NOW = "2026-10-23T14:59:59.000Z";
export const DASHBOARD_SECRET = "대시보드에 노출하면 안 되는 개인 사유와 목표";
export const TEAM = "org-photo";
export const ORG_A = "dashboard-a";
export const ORG_CHILD = "dashboard-a-child";
export const ORG_B = "dashboard-b";
export const ORG_INACTIVE = "dashboard-inactive";
export const Q = "demo-qualification";

export function dashboardSeed() {
  const state = seedState(true);
  for (const key of [
    "assignments",
    "enrollments",
    "attempts",
    "completions",
    "certifications",
    "audits",
    "requests",
    "notices",
    "plans",
    "planningRequests",
    "learningRecords",
    "notifications",
    "renewals",
    "lifecycleEvents",
    "comparisons",
  ] as const)
    state[key] = [];
  state.users = [
    {
      id: "admin-1",
      name: "팀 관리자",
      roles: ["admin"],
      organizationId: TEAM,
      revision: 1,
    },
    {
      id: "operator-1",
      name: "시스템 운영자",
      roles: ["system_operator"],
      organizationId: TEAM,
      revision: 1,
    },
    {
      id: "alice",
      name: "가 직원",
      roles: ["learner"],
      organizationId: ORG_A,
      revision: 1,
    },
    {
      id: "bob",
      name: "나 직원",
      roles: ["learner"],
      organizationId: ORG_B,
      revision: 1,
    },
  ];
  state.courses = state.courses.filter((c) => c.id === "demo-course-1");
  state.qualifications = state.qualifications.filter((q) => q.id === Q);
  state.qualifications[0]!.courseIds = ["demo-course-1"];
  state.qualifications[0]!.lifecycleStatus = "Active";
  state.qualifications[0]!.renewalLeadMonths = 3;
  const orgs: OrganizationDocument = {
    schemaVersion: 2,
    revision: 0,
    audits: [],
    requests: [],
    qualificationPools: [
      { lv1OrganizationId: TEAM, entityId: Q, qualificationId: Q },
    ],
    roots: [
      {
        id: TEAM,
        name: "가상 Photo 팀",
        active: true,
        requiredQualifications: [],
        children: [
          {
            id: ORG_A,
            name: "가 조직",
            active: true,
            requiredQualifications: [Q],
            children: [
              {
                id: ORG_CHILD,
                name: "가 하위 조직",
                active: true,
                requiredQualifications: [],
                children: [],
              },
            ],
          },
          {
            id: ORG_B,
            name: "나 조직",
            active: true,
            requiredQualifications: [],
            children: [],
          },
          {
            id: ORG_INACTIVE,
            name: "비활성 조직",
            active: false,
            requiredQualifications: [Q],
            children: [],
          },
        ],
      },
      {
        id: "org-etch",
        name: "다른 팀",
        active: true,
        requiredQualifications: [],
        children: [],
      },
    ],
  };
  return { state, orgs };
}
export type DashboardSeed = ReturnType<typeof dashboardSeed>;

export function addQualification(
  seed: DashboardSeed,
  id: string,
  options: Partial<Qualification> = {},
) {
  const q = {
    ...structuredClone(seed.state.qualifications[0]!),
    id,
    entityId: id,
    templateId: `dashboard-template-${id}`,
    title: `가상 자격 ${id}`,
    ...options,
  };
  q.courseIds = q.courseIds.map((id) => {
    const source = seed.state.courses.find((c) => c.id === id)!;
    if (source.qualificationType === q.qualificationType) return id;
    const copy = {
      ...structuredClone(source),
      id: `${q.id}-${id}`,
      entityId: `${q.id}-${id}`,
      qualificationType: q.qualificationType,
      parentId: undefined,
      version: 1,
      revision: 1,
    };
    seed.state.courses.push(copy);
    return copy.id;
  });
  seed.state.qualifications.push(q);
  if (!seed.state.qualificationTemplates.some((t) => t.id === q.templateId))
    seed.state.qualificationTemplates.push({
      id: q.templateId,
      qualificationType: q.qualificationType,
      revision: 1,
      title: q.title,
      englishName: "",
      description: "가상 검증 기준",
      updatedAt: DASHBOARD_NOW,
      updatedBy: "operator-1",
    });
  return q;
}

export function addRequest(
  seed: DashboardSeed,
  id: string,
  learnerId = "alice",
  entities = [Q],
  organizationId?: string,
) {
  const user = seed.state.users.find((u) => u.id === learnerId)!;
  const org = organizationEntries(seed.orgs).find(
    (o) => o.id === (organizationId || user.organizationId),
  )!;
  const request: State["planningRequests"][number] = {
    qualificationType: "auditee",
    id,
    learnerId,
    lv1OrganizationId: TEAM,
    requestedBy: "admin-1",
    organizationId: org.id,
    organizationPath: org.path,
    dueOn: "2026-10-20",
    message: DASHBOARD_SECRET,
    createdAt: "2026-10-01T00:00:00.000Z",
    revision: 1,
    mode: "learner_choice",
    targets: [],
    selections: entities.map((entityId) => {
      const q = seed.state.qualifications.find((q) => q.entityId === entityId)!;
      return {
        entityId,
        qualificationId: q.id,
        title: q.title,
        version: q.version,
      };
    }),
    source: "requested",
  };
  seed.state.planningRequests.push(request);
  return request;
}

export function addDraft(
  seed: DashboardSeed,
  id: string,
  requestId: string,
  qualificationId = Q,
) {
  const request = seed.state.planningRequests.find((r) => r.id === requestId)!;
  const q = seed.state.qualifications.find((q) => q.id === qualificationId)!;
  const plan: PersonalPlan = {
    id,
    requestId,
    learnerId: request.learnerId,
    qualificationId,
    lv1OrganizationId: TEAM,
    organizationId: request.organizationId,
    workflowVersion: "personal-certification-v5",
    status: "draft",
    revision: 1,
    createdAt: request.createdAt,
    updatedAt: request.createdAt,
    targetOn: "2026-10-21",
    schedules: q.courseIds.map((courseId) => ({
      courseId,
      learningStart: "2026-10-10",
      learningEnd: "2026-10-15",
      assessmentOn: "2026-10-20",
      goal: DASHBOARD_SECRET,
    })),
  };
  seed.state.plans.push(plan);
  return plan;
}

export function addAssignment(
  seed: DashboardSeed,
  id: string,
  learnerId = "alice",
  qualificationId = Q,
  organizationId?: string,
) {
  const user = seed.state.users.find((u) => u.id === learnerId)!;
  const org = organizationEntries(seed.orgs).find(
    (o) => o.id === (organizationId || user.organizationId),
  )!;
  const q = seed.state.qualifications.find((q) => q.id === qualificationId)!;
  const a: State["assignments"][number] = {
    id,
    learnerId,
    qualificationId,
    lv1OrganizationId: TEAM,
    ownerAdminId: "admin-1",
    assignedAt: "2026-10-01T00:00:00.000Z",
    revision: 1,
    organizationPath: org.path,
    organizationSource: "assigned",
    qualificationMetadata: {
      templateId: q.templateId,
      qualificationType: q.qualificationType,
      templateRevision: q.templateRevision,
      title: `당시 ${q.title}`,
      englishName: q.englishName,
      description: "당시 공통 정보",
    },
  };
  seed.state.assignments.push(a);
  for (const courseId of q.courseIds)
    seed.state.enrollments.push({
      id: `${id}:${courseId}`,
      assignmentId: id,
      courseId,
    });
  return a;
}

export function addCertification(
  seed: DashboardSeed,
  id: string,
  learnerId = "alice",
  options: {
    qualificationId?: string;
    expiresOn?: string;
    status?: "Active" | "Hold" | "Revoke";
    unknown?: boolean;
    organizationId?: string;
  } = {},
) {
  const qid = options.qualificationId || Q;
  const a = addAssignment(
    seed,
    `assignment-${id}`,
    learnerId,
    qid,
    options.organizationId,
  );
  const q = seed.state.qualifications.find((q) => q.id === qid)!;
  const validity: ValidityPolicy = options.unknown
    ? { type: "unknown", months: null, reminderDays: [] }
    : options.expiresOn
      ? { type: "months", months: 12, reminderDays: [] }
      : { type: "unlimited", months: null, reminderDays: [] };
  const startsOn = options.expiresOn
    ? addCalendarMonths(options.expiresOn, -12)
    : "2026-01-01";
  const date = `${startsOn}T00:00:00.000Z`;
  const evidence: Certification["evidence"] = [];
  for (const e of seed.state.enrollments.filter(
    (e) => e.assignmentId === a.id,
  )) {
    const c = seed.state.courses.find((c) => c.id === e.courseId)!;
    const completionEvidence: State["completions"][number]["evidence"] = [];
    for (const kind of c.qualificationType === "auditor"
      ? []
      : c.assessmentKinds) {
      const questions = assessmentQuestions(c, kind),
        attemptId = `${e.id}:${kind}`;
      const total = questions.reduce((sum, q) => sum + q.points, 0);
      seed.state.attempts.push({
        id: attemptId,
        enrollmentId: e.id,
        courseId: c.id,
        learnerId,
        kind,
        round: 1,
        status: "graded",
        revision: 1,
        createdAt: date,
        submittedAt: date,
        date,
        result: "passed",
        answers: Object.fromEntries(questions.map((q) => [q.id, q.correct!])),
        total,
        earned: total,
        itemResults: questions.map((q) => ({
          itemId: q.id,
          correct: true,
          earned: q.points,
          possible: q.points,
        })),
      });
      completionEvidence.push({ kind, attemptId });
    }
    const completionId = `completion-${e.id}`;
    const learningEvidence =
      c.qualificationType === "auditor"
        ? c.learningItems
            .filter((i) => i.required)
            .map((i) => ({
              itemId: i.id,
              title: i.title,
              type: i.type,
              required: i.required,
              confirmedBy: learnerId,
              confirmedAt: date,
            }))
        : [];
    if (c.qualificationType === "auditor")
      seed.state.learningChecklists.push({
        enrollmentId: e.id,
        revision: 1,
        items: learningEvidence,
      });
    seed.state.completions.push({
      method:
        c.qualificationType === "auditor" ? "self_confirmation" : "assessment",
      learningEvidence,
      id: completionId,
      enrollmentId: e.id,
      learnerId,
      courseId: c.id,
      date,
      evidence: completionEvidence,
    });
    evidence.push({ enrollmentId: e.id, completionId });
  }
  const cert: Certification = {
    id,
    assignmentId: a.id,
    learnerId,
    qualificationId: qid,
    date,
    revision: 1,
    lifecycleStatus: options.status || (options.unknown ? "Hold" : "Active"),
    validity,
    expiresOn: periodExpiry(startsOn, validity),
    evidence,
    qualificationMetadata: a.qualificationMetadata,
    periods: [
      {
        id: `period-${id}`,
        sequence: 1,
        kind: "initial",
        qualificationId: qid,
        qualificationVersion: q.version,
        validity,
        renewalLeadMonths: 3,
        startsOn,
        baseOn: startsOn,
        expiresOn: periodExpiry(startsOn, validity),
        completedAt: date,
        source: "issued",
      },
    ],
  };
  seed.state.certifications.push(cert);
  return cert;
}

/** Test-only setup for browser fixtures; never call against the development datastore. */
export async function configureDashboardFixture(store: JsonStore) {
  const seed = dashboardSeed();
  seed.state.users.push(
    {
      id: "learner-2",
      name: "정하린",
      roles: ["learner"],
      organizationId: ORG_A,
      revision: 1,
      organizationAdministration: {
        organizationId: ORG_A,
        grantedBy: "admin-1",
        grantedAt: DASHBOARD_NOW,
      },
    },
    {
      id: "child-member",
      name: "하위 직원",
      roles: ["learner"],
      organizationId: ORG_CHILD,
      revision: 1,
    },
    {
      id: "held-member",
      name: "대상자 Hold 직원",
      roles: ["learner"],
      organizationId: ORG_A,
      revision: 1,
      certificationEligibility: "hold",
    },
    {
      id: "expired-member",
      name: "만료 직원",
      roles: ["learner"],
      organizationId: ORG_A,
      revision: 1,
    },
  );
  addCertification(seed, "active-cert", "alice", { expiresOn: "2026-11-10" });
  addCertification(seed, "held-cert", "bob", { status: "Hold" });
  addCertification(seed, "expired-cert", "expired-member", {
    expiresOn: "2026-10-22",
  });
  addRequest(seed, "draft-request", "learner-2");
  addDraft(seed, "draft-plan", "draft-request");
  await store.organizations.transact(
    "operator-1",
    randomUUID(),
    randomUUID(),
    () => {},
    (doc) => {
      doc.roots = seed.orgs.roots;
      doc.qualificationPools = seed.orgs.qualificationPools;
      return {};
    },
  );
  await store.transact(
    "operator-1",
    randomUUID(),
    randomUUID(),
    () => {},
    (state) => {
      const revision = state.revision;
      Object.assign(state, seed.state, { revision });
      return {};
    },
  );
  return {
    now: DASHBOARD_NOW,
    teamId: TEAM,
    organizationId: ORG_A,
    childOrganizationId: ORG_CHILD,
    siblingOrganizationId: ORG_B,
    managerId: "learner-2",
    qualificationId: Q,
  };
}

export async function dashboardFixture(t: TestContext, seed = dashboardSeed()) {
  const dir = await mkdtemp(path.join(tmpdir(), "eks-dashboard-"));
  const file = path.join(dir, "runtime/state.json"),
    organizationsFile = path.join(dir, "master/organizations.json");
  await mkdir(path.dirname(organizationsFile), { recursive: true });
  await writeFile(organizationsFile, JSON.stringify(seed.orgs));
  await new JsonStore(file, organizationsFile).initialize(seed.state);
  const store = await new JsonStore(file, organizationsFile).load();
  let now = DASHBOARD_NOW;
  const app = await buildApp(store, { clock: () => now });
  const cookies = new Map<string, string>();
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  async function call(actor: string, url: string, status = 200) {
    if (!cookies.has(actor)) {
      const session = await app.inject({
        method: "POST",
        url: "/api/session",
        payload: { actorId: actor },
      });
      assert.equal(session.statusCode, 200, session.body);
      cookies.set(
        actor,
        `${session.cookies[0]!.name}=${session.cookies[0]!.value}`,
      );
    }
    const response = await app.inject({
      method: "GET",
      url: `/api${url}`,
      headers: { cookie: cookies.get(actor)! },
    });
    assert.equal(
      response.statusCode,
      status,
      `${actor} ${url}: ${response.body}`,
    );
    return response.json();
  }
  return {
    dir,
    file,
    organizationsFile,
    store,
    app,
    call,
    setTime(value: string) {
      now = value;
    },
    mutate(fn: (s: State) => void) {
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
    },
  };
}
