import { createHash } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { State, UserView } from "@eks/contracts";
import type { JsonStore } from "./storage.ts";
import {
  targetsView,
  qualificationImpact,
  certificationHistory,
  authorizeLifecycle,
  executeLifecycle,
} from "./qualification-lifecycle.ts";

export function registerLifecycleRoutes(
  app: FastifyInstance,
  store: JsonStore,
  actor: (r: FastifyRequest, s?: State) => UserView,
  clock: () => string,
) {
  const scope = (r: FastifyRequest) =>
    z.object({ lv1OrganizationId: z.string().optional() }).parse(r.query)
      .lv1OrganizationId;
  app.get("/api/certification-targets", async (r) =>
    targetsView(
      store.snapshot(),
      store.organizations.snapshot(),
      actor(r),
      scope(r),
    ),
  );
  app.get("/api/qualifications/:id/lifecycle-impact", async (r) =>
    qualificationImpact(
      store.snapshot(),
      store.organizations.snapshot(),
      actor(r),
      (r.params as any).id,
      scope(r),
    ),
  );
  app.get("/api/certifications/:id/history", async (r) => {
    certificationHistory(
      store.snapshot(),
      store.organizations.snapshot(),
      actor(r),
      (r.params as any).id,
      scope(r),
      clock(),
    );
    await store.refreshNotifications(clock());
    return certificationHistory(
      store.snapshot(),
      store.organizations.snapshot(),
      actor(r),
      (r.params as any).id,
      scope(r),
      clock(),
    );
  });
  const routes = [
    ["POST", "/api/qualifications/:id/lifecycle", "qualification.lifecycle"],
    ["PUT", "/api/certification-targets/eligibility", "eligibility.change"],
    ["POST", "/api/certifications/:id/status", "credential.status"],
    [
      "POST",
      "/api/certifications/:id/validity-correction",
      "credential.validity",
    ],
    ["POST", "/api/certifications/:id/renewals", "renewal.start"],
    ["POST", "/api/renewals/:id/complete", "renewal.complete"],
  ] as const;
  for (const [method, url, action] of routes)
    app.route({
      method,
      url,
      handler: async (r) => {
        const u = actor(r),
          id = (r.params as any).id || "",
          requested = scope(r);
        authorizeLifecycle(
          store.snapshot(),
          store.organizations.snapshot(),
          u,
          action,
          id,
          r.body,
          requested,
        );
        if (action.startsWith("renewal.") || action.startsWith("credential."))
          await store.refreshNotifications(clock());
        const key = z
          .string()
          .min(1)
          .max(160)
          .parse(r.headers["idempotency-key"]);
        const hash = createHash("sha256")
          .update(JSON.stringify({ action, id, requested, body: r.body }))
          .digest("hex");
        const options = {
          action,
          lv1OrganizationId: undefined as string | undefined,
          preserveBackup: true,
          backupPurpose: "qualification-lifecycle" as const,
        };
        return store.transact(
          u.id,
          key,
          hash,
          (s) => {
            options.lv1OrganizationId = authorizeLifecycle(
              s,
              store.organizations.snapshot(),
              actor(r, s),
              action,
              id,
              r.body,
              requested,
            );
          },
          (s) =>
            executeLifecycle(
              s,
              store.organizations.snapshot(),
              actor(r, s),
              action,
              id,
              r.body,
              options.lv1OrganizationId!,
              clock(),
            ),
          options,
        );
      },
    });
}
