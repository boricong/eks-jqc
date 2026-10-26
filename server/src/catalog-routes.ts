import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { State, UserView } from "@eks/contracts";
import { managementScope } from "./management.ts";
import type { JsonStore } from "./storage.ts";

/** Retired API boundary. Run before parsing XLSX/JSON bodies; never read or write a batch. */
export function registerCatalogRoutes(
  app: FastifyInstance,
  store: JsonStore,
  actor: (request: FastifyRequest, state?: State) => UserView,
) {
  for (const url of ["/api/catalog", "/api/catalog/*"])
    app.route({
      method: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      url,
      onRequest: async (request, reply) => {
        managementScope(
          actor(request),
          store.organizations.snapshot(),
          z
            .object({ lv1OrganizationId: z.string().optional() })
            .parse(request.query).lv1OrganizationId,
        );
        return reply.code(410).send({
          code: "FEATURE_REMOVED",
          message:
            "엑셀 및 기준 일괄 편집 기능이 종료되었습니다. 팀 자격 설정과 인증Set 설정에서 개별 편집해 주세요.",
          replacementPath: "/admin/qualifications",
        });
      },
      handler: async () => {},
    });
}
