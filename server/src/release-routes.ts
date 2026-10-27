import { createHash } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  releaseVersionLabel,
  type State,
  type UserView,
  type Qualification,
} from "@eks/contracts";
import type { JsonStore } from "./storage.ts";
import { managementScope } from "./management.ts";
import { systemOperator } from "./organizations.ts";
import { demand } from "./errors.ts";
import {
  latestCourse,
  resolveCommonUpdate,
  criteriaFingerprint,
} from "./releases.ts";
import { latestQualification } from "@eks/contracts";
import { saveCommonCourse } from "./common-courses.ts";
import { saveTemplate } from "./qualification-templates.ts";

export function registerReleaseRoutes(
  app: FastifyInstance,
  store: JsonStore,
  actor: (r: FastifyRequest, s?: State) => UserView,
) {
  for (const section of ["courses", "qualifications"] as const)
    app.get(`/api/${section}/:id/versions`, async (r) => {
      const s = store.snapshot(),
        scope = managementScope(
          actor(r),
          store.organizations.snapshot(),
          (r.query as any).lv1OrganizationId,
        );
      const item = s[section].find((i) => i.id === (r.params as any).id);
      demand(
        item && item.lv1OrganizationId === scope,
        404,
        "선택한 팀의 기준을 찾을 수 없습니다.",
      );
      return s[section]
        .filter(
          (i) => i.entityId === item.entityId && i.lv1OrganizationId === scope,
        )
        .sort((a, b) => (b.version || 0) - (a.version || 0));
    });
  app.get("/api/system/common-courses/:id/versions", async (r) => {
    systemOperator(actor(r));
    return store
      .snapshot()
      .commonCourseReleases.filter(
        (v) => v.commonCourseId === (r.params as any).id,
      )
      .sort((a, b) => b.sequence - a.sequence);
  });
  for (const section of ["common-courses", "qualification-templates"] as const)
    app.post(
      `/api/system/${section}/save-preview`,
      { bodyLimit: 64 * 1024 * 1024 },
      async (r) => {
        const u = actor(r);
        systemOperator(u);
        const s = structuredClone(store.snapshot()),
          body = r.body as any;
        const before = s.qualifications.length;
        const result =
          section === "common-courses"
            ? saveCommonCourse(s, u.id, body.id, body.content)
            : saveTemplate(s, u.id, body.id, body.content);
        return {
          stateRevision: store.snapshot().revision,
          organizationRevision: store.organizations.snapshot().revision,
          result,
          updatedQualifications: s.qualifications
            .slice(before)
            .map((q) => ({ title: q.title, version: releaseVersionLabel(q) })),
        };
      },
    );
  app.get("/api/common-course-updates", async (r) => {
    const s = store.snapshot(),
      scope = managementScope(
        actor(r),
        store.organizations.snapshot(),
        (r.query as any).lv1OrganizationId,
      );
    return s.commonUpdates
      .filter((u) => u.teamId === scope && u.status === "pending")
      .map((u) => ({
        ...u,
        course: latestCourse(s, u.courseEntityId),
        source: s.commonCourseReleases.find((v) => v.id === u.sourceReleaseId),
      }));
  });
  app.post("/api/common-course-updates/:id/resolve", async (r) => {
    const u = actor(r),
      scope = managementScope(
        u,
        store.organizations.snapshot(),
        (r.query as any).lv1OrganizationId,
      ),
      id = (r.params as any).id;
    const key = z.string().min(1).max(160).parse(r.headers["idempotency-key"]);
    return store.transact(
      u.id,
      key,
      createHash("sha256")
        .update(JSON.stringify({ id, scope, body: r.body }))
        .digest("hex"),
      (s) =>
        managementScope(actor(r, s), store.organizations.snapshot(), scope),
      (s) => resolveCommonUpdate(s, id, u.id, scope, r.body),
      {
        action: "common-course.resolve",
        lv1OrganizationId: scope,
        preserveBackup: true,
      },
    );
  });
  app.get("/api/plans/:id/criteria", async (r) => {
    const s = store.snapshot(),
      u = actor(r),
      p = s.plans.find((p) => p.id === (r.params as any).id);
    demand(
      p &&
        p.learnerId === u.id &&
        p.lv1OrganizationId === u.lv1OrganizationId &&
        !p.deletedAt,
      404,
      "본인의 계획을 찾을 수 없습니다.",
    );
    const old = s.qualifications.find((q) => q.id === p.qualificationId)!;
    const current =
      p.status === "completed"
        ? old
        : latestQualification(s, p.lv1OrganizationId, old.entityId) || old;
    const summary = (q: Qualification) => ({
      id: q.id,
      title: q.title,
      releaseVersion: q.releaseVersion,
      version: q.version,
      validity: q.validity,
      renewalLeadMonths: q.renewalLeadMonths,
      renewalNoticeDaysBefore: q.renewalNoticeDaysBefore,
      description: q.description,
      courses: q.courseIds.map((id) => {
        const c = s.courses.find((c) => c.id === id)!;
        return {
          id: c.id,
          title: c.title,
          version: c.version,
          releaseVersion: c.releaseVersion,
        };
      }),
    });
    return {
      previous: summary(old),
      current: summary(current),
      changed: old.id !== current.id,
      criteriaToken: criteriaFingerprint(s, current),
    };
  });
}
