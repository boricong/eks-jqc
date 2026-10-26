import { createHash } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { State, UserView } from "@eks/contracts";
import type { JsonStore } from "./storage.ts";
import { demand } from "./errors.ts";
import { managementScope } from "./management.ts";
import { userView } from "./organizations.ts";
import { dashboardScope } from "./dashboard.ts";
import {
  auditorProgramView,
  auditorMe,
  auditorMembers,
  saveAuditorProgram,
  startAuditor,
} from "./auditor-program.ts";

export function registerAuditorRoutes(
  app: FastifyInstance,
  store: JsonStore,
  actor: (r: FastifyRequest, s?: State) => UserView,
  clock: () => string,
) {
  app.get("/api/dashboard/auditor", async (r) => {
    const query = z
      .object({
        lv1OrganizationId: z.string().optional(),
        organizationId: z.string().optional(),
        includeDescendants: z.enum(["true", "false"]).optional(),
      })
      .parse(r.query);
    const s = store.snapshot(),
      doc = store.organizations.snapshot(),
      scope = dashboardScope(doc, actor(r), {
        ...query,
        includeDescendants:
          query.includeDescendants === undefined
            ? undefined
            : query.includeDescendants === "true",
      });
    const allowed = new Set(
      s.users
        .filter((u) => {
          const v = userView(u, doc);
          return (
            v.organizationId === scope.organizationId ||
            (scope.includeDescendants &&
              v.organizationPath.some((p) => p.id === scope.organizationId))
          );
        })
        .map((u) => u.id),
    );
    const members = auditorMembers(s, doc, scope.lv1OrganizationId, clock())
      .filter((u) => allowed.has(u.id))
      .map((u) => ({
        id: u.id,
        name: u.name,
        designated: u.designated,
        currentLevel: u.currentLevel,
        levels: u.levels.map((l) => ({
          level: l.level,
          qualificationId: l.qualificationId,
          title: l.title,
          started: !!l.assignment || !!l.history.length,
          learning: !!l.assignment,
          completed: l.completed,
          total: l.total,
          pendingAward: l.pendingAward,
          expiresOn: l.certification?.expiresOn || null,
          certified: !!l.certification,
          historyCount: l.history.length,
        })),
      }));
    return {
      scope,
      members,
      summary: {
        designated: members.filter((m) => m.designated).length,
        general: members.filter((m) => m.currentLevel === "general").length,
        main: members.filter((m) => m.currentLevel === "main").length,
        started: members.filter((m) => m.levels.some((l) => l.started)).length,
        completed: members.filter((m) =>
          m.levels.some((l) => l.historyCount || l.pendingAward),
        ).length,
        learning: members.filter((m) => m.levels.some((l) => l.learning))
          .length,
      },
    };
  });
  const team = (r: FastifyRequest, s?: State) =>
    managementScope(
      actor(r, s),
      store.organizations.snapshot(),
      z.object({ lv1OrganizationId: z.string().optional() }).parse(r.query)
        .lv1OrganizationId,
    );
  app.get("/api/auditor-program", async (r) =>
    (() => {
      const v = auditorProgramView(store.snapshot(), team(r));
      return {
        readiness: v.readiness,
        program: v.program
          ? {
              lv1OrganizationId: v.program.lv1OrganizationId,
              revision: v.program.revision,
              notice: v.program.notice,
              updatedBy: v.program.updatedBy,
              updatedAt: v.program.updatedAt,
            }
          : null,
      };
    })(),
  );
  for (const [method, url] of [
    ["GET", "/api/auditor-program/members"],
    ["POST", "/api/auditor-program/qualifications"],
    ["POST", "/api/auditor-program/notices/send"],
  ] as const)
    app.route({
      method,
      url,
      onRequest: async (r, reply) => {
        team(r);
        return reply.code(410).send({
          code: "FEATURE_REMOVED",
          message:
            "이 기능은 종료되었습니다. 팀 자격 설정과 지정 안내문 설정을 사용해 주세요.",
        });
      },
      handler: async () => {},
    });
  app.get("/api/me/auditor", async (r) => {
    actor(r);
    await store.refreshNotifications(clock());
    return auditorMe(
      store.snapshot(),
      actor(r),
      clock(),
      store.organizations.snapshot(),
    );
  });
  for (const [method, url, action] of [
    ["PUT", "/api/auditor-program", "save"],
    ["POST", "/api/me/auditor/starts", "start"],
  ] as const) {
    app.route({
      method,
      url,
      handler: async (r) => {
        const u = actor(r),
          scope = action === "start" ? u.lv1OrganizationId : team(r);
        if (
          action === "start" &&
          r.body &&
          typeof r.body === "object" &&
          "level" in r.body
        )
          demand(
            false,
            410,
            "자격 목록을 새로고침해 주세요.",
            "FEATURE_REMOVED",
          );
        if (
          action === "save" &&
          r.body &&
          typeof r.body === "object" &&
          ["titles", "generalQualificationId", "mainQualificationId"].some(
            (k) => k in (r.body as object),
          )
        )
          demand(
            false,
            410,
            "대표 자격 편집은 종료되었습니다.",
            "FEATURE_REMOVED",
          );
        const key = z
          .string()
          .min(1)
          .max(160)
          .parse(r.headers["idempotency-key"]);
        const hash = createHash("sha256")
          .update(JSON.stringify({ action, scope, body: r.body }))
          .digest("hex");
        return store.transact(
          u.id,
          key,
          hash,
          (s) => {
            const current = actor(r, s);
            if (action === "start")
              demand(
                current.lv1OrganizationId === scope &&
                  current.roles.includes("evaluator") &&
                  current.organizationActive &&
                  current.certificationEligibility !== "hold",
                403,
                "현재 조직의 Auditor 지정·취득 가능 상태를 확인해 주세요.",
              );
            if (action !== "start") team(r, s);
          },
          (s) => {
            const current = actor(r, s),
              at = clock();
            if (action === "save") {
              const v = saveAuditorProgram(s, current, scope, r.body, at);
              return {
                readiness: v.readiness,
                program: v.program
                  ? {
                      lv1OrganizationId: v.program.lv1OrganizationId,
                      revision: v.program.revision,
                      notice: v.program.notice,
                      updatedBy: v.program.updatedBy,
                      updatedAt: v.program.updatedAt,
                    }
                  : null,
              };
            }
            if (action === "start")
              return startAuditor(
                s,
                store.organizations.snapshot(),
                current,
                r.body,
                at,
              );
          },
          { action: `auditor.${action}`, lv1OrganizationId: scope },
        );
      },
    });
  }
}
