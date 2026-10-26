import { createHash } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  organizationEntries,
  teamEditableRoles,
  type State,
  type UserView,
  type TeamUsersView,
} from "@eks/contracts";
import type { JsonStore } from "./storage.ts";
import { managementScope } from "./management.ts";
import {
  authorizeTeamUser,
  changeTeamUser,
  userView,
} from "./organizations.ts";

export function registerTeamUserRoutes(
  app: FastifyInstance,
  store: JsonStore,
  actor: (r: FastifyRequest, s?: State) => UserView,
) {
  const scope = (r: FastifyRequest, s?: State) =>
    managementScope(
      actor(r, s),
      store.organizations.snapshot(),
      z.object({ lv1OrganizationId: z.string().optional() }).parse(r.query)
        .lv1OrganizationId,
    );
  app.get("/api/team-users", async (r): Promise<TeamUsersView> =>
    store.consistent((s, doc) => {
      const team = scope(r, s);
      const users = s.users
        .map((u) => userView(u, doc))
        .filter((u) => u.lv1OrganizationId === team)
        .map((u) => ({
          ...u,
          canEdit: !u.roles.includes("system_operator"),
          ...(u.roles.includes("system_operator")
            ? { editBlockedReason: "시스템 운영에서 관리" }
            : {}),
        }));
      return {
        users,
        organizations: {
          revision: doc.revision,
          entries: organizationEntries(doc)
            .filter((o) => o.lv1OrganizationId === team)
            .map((o) => ({
              ...o,
              userCount: users.filter((u) => u.organizationId === o.id).length,
            })),
        },
        editableRoles: [...teamEditableRoles],
      };
    }),
  );
  for (const method of ["POST", "PATCH"] as const)
    app.route({
      method,
      url: `/api/team-users${method === "PATCH" ? "/:id" : ""}`,
      handler: async (r) => {
        const u = actor(r),
          team = scope(r),
          target =
            method === "PATCH" ? (r.params as { id: string }).id : undefined;
        const key = z
          .string()
          .min(1)
          .max(160)
          .parse(r.headers["idempotency-key"]);
        const hash = createHash("sha256")
          .update(JSON.stringify({ method, team, target, body: r.body }))
          .digest("hex");
        return store.transact(
          u.id,
          key,
          hash,
          (s) =>
            authorizeTeamUser(
              s,
              store.organizations.snapshot(),
              actor(r, s),
              scope(r, s),
              target,
            ),
          (s) =>
            changeTeamUser(
              s,
              store.organizations.snapshot(),
              actor(r, s),
              team,
              target,
              r.body,
            ),
          { action: "team-user.change", lv1OrganizationId: team },
        );
      },
    });
}
