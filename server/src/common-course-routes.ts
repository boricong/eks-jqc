import { createHash } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { State, UserView } from "@eks/contracts";
import type { JsonStore } from "./storage.ts";
import { systemOperator } from "./organizations.ts";
import { managementScope } from "./management.ts";
import { demand } from "./errors.ts";
import {
  commonCourseView,
  commonCourseUsage,
  saveCommonCourse,
  changeCommonCourseStatus,
  commonCourseOptions,
} from "./common-courses.ts";
export function registerCommonCourseRoutes(
  app: FastifyInstance,
  store: JsonStore,
  actor: (r: FastifyRequest, s?: State) => UserView,
) {
  app.get("/api/system/common-courses", async (r) => {
    systemOperator(actor(r));
    const s = store.snapshot();
    return {
      items: s.commonCourses.map((c) => commonCourseView(s, c)),
      audits: s.audits.filter((a) => a.action.startsWith("common-course.")),
    };
  });
  app.get("/api/system/common-courses/:id/usage", async (r) => {
    systemOperator(actor(r));
    return commonCourseUsage(store.snapshot(), (r.params as { id: string }).id);
  });
  for (const action of ["create", "update", "retire", "restore"] as const) {
    const method = action === "update" ? "PUT" : "POST";
    const url =
      "/api/system/common-courses" +
      (action === "create" ? "" : "/:id") +
      (["retire", "restore"].includes(action) ? "/" + action : "");
    app.route({
      method,
      url,
      bodyLimit: 64 * 1024 * 1024,
      handler: async (r) => {
        const u = actor(r);
        systemOperator(u);
        const target = (r.params as { id?: string }).id;
        const key = z
          .string()
          .min(1)
          .max(160)
          .parse(r.headers["idempotency-key"]);
        const fingerprint = createHash("sha256")
          .update(JSON.stringify({ action, target, body: r.body }))
          .digest("hex");
        return store.transact(
          u.id,
          key,
          fingerprint,
          (s) => systemOperator(actor(r, s)),
          (s) =>
            action === "create" || action === "update"
              ? saveCommonCourse(s, u.id, target, r.body)
              : changeCommonCourseStatus(s, u.id, target!, action, r.body),
          { action: "common-course." + action, preserveBackup: true },
        );
      },
    });
  }
  app.get("/api/qualifications/:id/common-course-options", async (r) => {
    const s = store.snapshot(),
      scope = managementScope(
        actor(r),
        store.organizations.snapshot(),
        (r.query as { lv1OrganizationId?: string }).lv1OrganizationId,
      ),
      q = s.qualifications.find(
        (q) => q.id === (r.params as { id: string }).id,
      );
    demand(
      q && q.lv1OrganizationId === scope,
      403,
      "선택한 팀의 자격만 조회할 수 있습니다.",
    );
    return commonCourseOptions(s, q);
  });
}
