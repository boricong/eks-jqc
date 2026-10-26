import { createHash, randomUUID } from "node:crypto";
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
  createAuditorQualification,
  saveAuditorProgram,
  startAuditor,
  sendAuditorNotice,
  programFor,
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
    auditorProgramView(store.snapshot(), team(r)),
  );
  app.get("/api/auditor-program/members", async (r) =>
    auditorMembers(
      store.snapshot(),
      store.organizations.snapshot(),
      team(r),
      clock(),
    ),
  );
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
    ["POST", "/api/auditor-program/qualifications", "create"],
    ["POST", "/api/auditor-program/notices/send", "send"],
    ["POST", "/api/me/auditor/starts", "start"],
  ] as const) {
    app.route({
      method,
      url,
      handler: async (r) => {
        const u = actor(r),
          scope = action === "start" ? u.lv1OrganizationId : team(r);
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
            actor(r, s);
            if (action !== "start") team(r, s);
          },
          (s) => {
            const current = actor(r, s),
              at = clock();
            if (action === "save")
              return saveAuditorProgram(s, current, scope, r.body, at);
            if (action === "create")
              return createAuditorQualification(s, current, scope, r.body, at);
            if (action === "start")
              return startAuditor(
                s,
                store.organizations.snapshot(),
                current,
                r.body,
                at,
              );
            const input = z
              .object({
                revision: z.number().int().positive(),
                recipientIds: z.array(z.string()).min(1).max(200),
              })
              .strict()
              .parse(r.body);
            demand(
              programFor(s, scope)?.revision === input.revision,
              409,
              "안내문이 변경되었습니다. 미리보기를 다시 확인해 주세요.",
              "REVISION_CONFLICT",
            );
            const ids = [...new Set(input.recipientIds)],
              batch = randomUUID();
            for (const id of ids) {
              const recipient = s.users.find((u) => u.id === id);
              demand(
                recipient?.roles.includes("evaluator") &&
                  userView(recipient, store.organizations.snapshot())
                    .lv1OrganizationId === scope,
                403,
                "선택한 팀의 현재 Auditor 지정자에게만 보낼 수 있습니다.",
              );
              sendAuditorNotice(
                s,
                scope,
                id,
                `auditor:resend:${batch}:${id}`,
                at,
              );
            }
            s.audits.push({
              id: batch,
              actorId: current.id,
              lv1OrganizationId: scope,
              action: "auditor.notice.resend",
              targetId: batch,
              date: at,
              reason: "선택 대상자에게 지정 안내 재발송",
              details: { recipientIds: ids, revision: input.revision },
            });
            return { sent: ids.length };
          },
          { action: `auditor.${action}`, lv1OrganizationId: scope },
        );
      },
    });
  }
}
