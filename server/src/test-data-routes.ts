import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  TestDataActionSchema,
  type State,
  type OrganizationDocument,
  type UserView,
  type TestDataPreview,
} from "@eks/contracts";
import type { JsonStore } from "./storage.ts";
import { demand } from "./errors.ts";
import { systemOperator } from "./organizations.ts";
import { contentHash } from "./maintenance.ts";
import {
  testDataStatus,
  testDataCounts,
  resetTestData,
  loadTestData,
} from "./test-data.ts";

export function registerTestDataRoutes(
  app: FastifyInstance,
  store: JsonStore,
  actor: (r: FastifyRequest, s?: State) => UserView,
  clock: () => string,
  invalidate: () => void,
) {
  const previews = new Map<
    string,
    {
      view: TestDataPreview;
      actorId: string;
      generation: string;
      hash: string;
      candidate: { state: State; organizations: OrganizationDocument };
    }
  >();
  app.get("/api/system/test-data", async (r) =>
    store.consistent((s, o) => {
      const u = actor(r, s);
      systemOperator(u);
      const { operationKey } = z
        .object({ operationKey: z.string().min(1).max(160).optional() })
        .strict()
        .parse(r.query);
      return {
        ...testDataStatus(s, o, store.hasLegacyTestSnapshot),
        ...(operationKey
          ? { operation: store.testDataOperation(operationKey, u.id) }
          : {}),
      };
    }),
  );
  app.post("/api/system/test-data/preview", async (r) =>
    store.consistent((s, o) => {
      const u = actor(r, s);
      systemOperator(u);
      const { action } = z
        .object({ action: TestDataActionSchema })
        .strict()
        .parse(r.body);
      const status = testDataStatus(s, o, store.hasLegacyTestSnapshot);
      demand(
        action === "load" ? status.canLoad : status.canReset,
        409,
        action === "load"
          ? status.blockers.join(" · ")
          : "초기화할 데이터가 없습니다.",
        "TEST_DATA_NOT_READY",
      );
      const candidate =
        action === "load"
          ? loadTestData(s, o, u.id, clock())
          : resetTestData(s, o);
      const now = Date.parse(clock());
      for (const [id, p] of previews)
        if (p.actorId === u.id || Date.parse(p.view.expiresAt) <= now)
          previews.delete(id);
      demand(
        previews.size < 10,
        429,
        "진행 중인 확인이 많습니다. 잠시 후 다시 시도해 주세요.",
      );
      const view: TestDataPreview = {
        previewId: randomUUID(),
        action,
        expiresAt: new Date(now + 15 * 60000).toISOString(),
        before: status.counts,
        after: testDataCounts(candidate.state, candidate.organizations),
        preserved: status.preserved,
        warnings: status.warnings,
        recipe: status.recipe,
      };
      previews.set(view.previewId, {
        view,
        actorId: u.id,
        generation: store.generation,
        hash: contentHash({ s, o }),
        candidate,
      });
      return view;
    }),
  );
  app.post("/api/system/test-data/apply", async (r) => {
    const u = actor(r);
    systemOperator(u);
    const body = z
      .object({
        action: TestDataActionSchema,
        previewId: z.string().uuid(),
        confirmation: z.string(),
      })
      .strict()
      .parse(r.body);
    demand(
      body.confirmation ===
        (body.action === "load" ? "테스트 로드" : "전체 초기화"),
      422,
      "확인 문구를 정확히 입력해 주세요.",
    );
    const key = z.string().min(1).max(160).parse(r.headers["idempotency-key"]),
      generation = store.generation;
    const result = await store.replaceTestData(
      u.id,
      key,
      contentHash(body),
      body.action,
      clock(),
      (s) => systemOperator(actor(r, s)),
      (s, o) => {
        const p = previews.get(body.previewId);
        demand(
          p &&
            p.actorId === u.id &&
            p.view.action === body.action &&
            Date.parse(p.view.expiresAt) > Date.parse(clock()),
          409,
          "확인 정보가 만료되었습니다. 작업 내용을 다시 확인해 주세요.",
          "TEST_DATA_PREVIEW_EXPIRED",
        );
        demand(
          p.generation === store.generation && p.hash === contentHash({ s, o }),
          409,
          "확인 이후 데이터가 변경되었습니다. 작업 내용을 다시 확인해 주세요.",
          "REVISION_CONFLICT",
        );
        return {
          ...structuredClone(p.candidate),
          before: p.view.before,
          after: p.view.after,
        };
      },
    );
    if (generation !== store.generation) invalidate();
    previews.delete(body.previewId);
    return result;
  });
}
