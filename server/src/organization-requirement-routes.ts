import { createHash } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { State, UserView } from "@eks/contracts";
import type { JsonStore } from "./storage.ts";
import { policyScope } from "./organization-administrators.ts";
import { managementScope } from "./management.ts";
import {
  requirementsView,
  previewRequirements,
  saveRequirements,
  previewPlanningRequest,
} from "./organization-requirements.ts";
export function registerOrganizationRequirementRoutes(
  app: FastifyInstance,
  store: JsonStore,
  actor: (r: FastifyRequest, s?: State) => UserView,
  clock: () => string,
) {
  const scope = (r: FastifyRequest) =>
    policyScope(
      actor(r),
      store.organizations.snapshot(),
      (r.query as any).lv1OrganizationId,
    );
  app.get("/api/organization-qualification-requirements", async (r) =>
    requirementsView(
      store.snapshot(),
      store.organizations.snapshot(),
      actor(r),
      scope(r),
    ),
  );
  app.post("/api/organization-qualification-requirements/preview", async (r) =>
    previewRequirements(
      store.snapshot(),
      store.organizations.snapshot(),
      actor(r),
      scope(r),
      r.body,
    ),
  );
  app.put("/api/organization-qualification-requirements", async (r) => {
    const u = actor(r),
      team = scope(r),
      key = z.string().min(1).max(160).parse(r.headers["idempotency-key"]),
      fingerprint = createHash("sha256")
        .update(JSON.stringify({ team, body: r.body }))
        .digest("hex");
    return store.transact(
      u.id,
      key,
      fingerprint,
      (s) => {
        policyScope(actor(r, s), store.organizations.snapshot(), team);
        for (const change of z
          .object({
            changes: z.array(z.object({ organizationId: z.string() })),
          })
          .parse(r.body).changes)
          policyScope(
            actor(r, s),
            store.organizations.snapshot(),
            team,
            change.organizationId,
          );
      },
      (s) =>
        saveRequirements(
          s,
          store.organizations.snapshot(),
          actor(r, s),
          team,
          r.body,
        ),
      {
        action: "organization.requirements",
        lv1OrganizationId: team,
        preserveBackup: true,
      },
    );
  });
  app.post("/api/planning-requests/preview", async (r) => {
    const team = managementScope(
        actor(r),
        store.organizations.snapshot(),
        (r.query as any).lv1OrganizationId,
      ),
      input = z
        .object({ learnerIds: z.array(z.string()).min(1).max(200) })
        .strict()
        .parse(r.body);
    return previewPlanningRequest(
      store.snapshot(),
      store.organizations.snapshot(),
      team,
      input.learnerIds,
      clock(),
    );
  });
}
