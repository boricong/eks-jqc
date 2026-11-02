import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { State, UserView } from "@eks/contracts";
import type { JsonStore } from "./storage.ts";
import { systemOperator, organization, nodeFor } from "./organizations.ts";
import { auditorTeamImpact } from "./auditor-team.ts";
import { demand } from "./errors.ts";
export function registerAuditorTeamRoutes(
  app: FastifyInstance,
  store: JsonStore,
  actor: (r: FastifyRequest, s?: State) => UserView,
  clock: () => string,
) {
  const tokens = new Map<
    string,
    {
      actorId: string;
      team: string;
      enabled: boolean;
      revision: number;
      orgRevision: number;
      generation: string;
      expires: number;
    }
  >();
  app.post(
    "/api/system/organizations/:id/auditor-eligibility/preview",
    async (r) => {
      systemOperator(actor(r));
      return store.consistent((s, doc) => {
        systemOperator(actor(r, s));
        const team = (r.params as { id: string }).id;
        demand(
          organization(doc, team).level === 1,
          422,
          "Lv1 팀만 지정할 수 있습니다.",
        );
        const input = z
          .object({
            enabled: z.boolean(),
            revision: z.number().int().nonnegative(),
          })
          .strict()
          .parse(r.body);
        demand(
          input.revision === doc.revision,
          409,
          "조직이 변경되었습니다. 다시 확인해 주세요.",
        );
        for (const [k, v] of tokens)
          if (v.expires <= Date.parse(clock())) tokens.delete(k);
        demand(tokens.size < 10000, 503, "잠시 후 다시 확인해 주세요.");
        const token = randomUUID();
        tokens.set(token, {
          actorId: actor(r, s).id,
          team,
          enabled: input.enabled,
          revision: s.revision,
          orgRevision: doc.revision,
          generation: store.generation,
          expires: Date.parse(clock()) + 900000,
        });
        return {
          token,
          current:
            doc.roots.find((n) => n.id === team)?.auditorEnabled === true,
          enabled: input.enabled,
          ...auditorTeamImpact(s, doc, team),
        };
      });
    },
  );
  app.put("/api/system/organizations/:id/auditor-eligibility", async (r) => {
    const u = actor(r);
    systemOperator(u);
    const { token } = z
      .object({ token: z.string().uuid() })
      .strict()
      .parse(r.body);
    const team = (r.params as { id: string }).id;
    const key = z.string().min(1).max(160).parse(r.headers["idempotency-key"]);
    return store.transactPair(
      u.id,
      key,
      createHash("sha256")
        .update(JSON.stringify({ team, token }))
        .digest("hex"),
      (s) => systemOperator(actor(r, s)),
      (s, doc) => {
        const review = tokens.get(token);
        demand(
          review &&
            review.actorId === u.id &&
            review.team === team &&
            review.revision === s.revision &&
            review.orgRevision === doc.revision &&
            review.generation === store.generation &&
            review.expires > Date.parse(clock()),
          409,
          "검토 기준이 변경되었거나 만료되었습니다. 다시 확인해 주세요.",
        );
        demand(
          organization(doc, team).level === 1,
          422,
          "Lv1 팀만 지정할 수 있습니다.",
        );
        const node = nodeFor(doc.roots, team)!;
        const before = node.auditorEnabled === true;
        node.auditorEnabled = review.enabled;
        doc.audits.push({
          id: randomUUID(),
          actorId: u.id,
          date: clock(),
          targetId: team,
          action: "auditor.team.change",
          before: { enabled: before },
          after: { enabled: review.enabled },
        });
        return {
          id: team,
          enabled: review.enabled,
          revision: doc.revision + 1,
        };
      },
      { action: "auditor.team.change", lv1OrganizationId: team },
    );
  });
}
