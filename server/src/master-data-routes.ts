import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type {
  MasterPayload,
  MasterPreview,
  MaintenanceReceipt,
  State,
  UserView,
} from "@eks/contracts";
import { kstDate } from "@eks/contracts";
import type { JsonStore } from "./storage.ts";
import { demand } from "./errors.ts";
import { systemOperator } from "./organizations.ts";
import {
  MASTER_LIMIT,
  masterPayload,
  masterCounts,
  clearedCounts,
  contentHash,
  exportMaster,
  readMaster,
  masterCandidate,
} from "./master-data.ts";

export function registerMasterDataRoutes(
  app: FastifyInstance,
  store: JsonStore,
  actor: (r: FastifyRequest, s?: State) => UserView,
  clock: () => string,
  invalidateSessions: () => void,
) {
  const previews = new Map<
    string,
    {
      view: MasterPreview;
      actorId: string;
      kind: MaintenanceReceipt["kind"];
      payload: MasterPayload;
      stateHash: string;
      organizationHash: string;
      deadline: number;
    }
  >();
  const operator = (r: FastifyRequest, s?: State) => {
    const u = actor(r, s);
    systemOperator(u);
    return u;
  };
  app.get("/api/system/master-data/operations/:key", (r) =>
    store.consistent((s) => {
      operator(r, s);
      const key = z
        .string()
        .min(1)
        .max(160)
        .parse((r.params as { key: string }).key);
      return { receipt: store.maintenanceReceipt(key) };
    }),
  );
  const preview = (
    r: FastifyRequest,
    kind: MaintenanceReceipt["kind"],
    file?: ReturnType<typeof readMaster>,
  ) =>
    store.consistent((s, o) => {
      const u = operator(r, s),
        now = Date.now();
      for (const [id, p] of previews)
        if (p.deadline <= now) previews.delete(id);
      // Keep upload memory bounded, including abandoned previews.
      for (const [id, p] of previews)
        if (p.actorId === u.id) previews.delete(id);
      demand(
        previews.size < 10,
        429,
        "진행 중인 파일 검사가 많습니다. 잠시 후 다시 시도해 주세요.",
      );
      const payload = file?.payload || masterPayload(s, o),
        deadline = now + 15 * 60 * 1000;
      const view: MasterPreview = {
        previewId: randomUUID(),
        expiresAt: new Date(deadline).toISOString(),
        generation: store.generation,
        stateRevision: s.revision,
        organizationRevision: o.revision,
        current: masterCounts(masterPayload(s, o)),
        preserved: masterCounts(payload),
        deleted: clearedCounts(s, o),
        fileHash: contentHash(payload),
        ...(file ? { fileCreatedAt: file.createdAt } : {}),
      };
      previews.set(view.previewId, {
        view,
        actorId: u.id,
        kind,
        payload,
        stateHash: contentHash(s),
        organizationHash: contentHash(o),
        deadline,
      });
      return view;
    });
  app.get("/api/testing/master-reset/preview", (r) =>
    preview(r, "master-reset"),
  );
  app.get("/api/system/master-data/export", async (r, reply) => {
    const file = await store.consistent((s, o) => {
      operator(r, s);
      return exportMaster(s, o, clock());
    });
    const bytes = JSON.stringify(file, null, 2) + "\n";
    demand(
      Buffer.byteLength(bytes) <= MASTER_LIMIT,
      422,
      "설정·기준 파일이 25MB를 초과합니다. 서버 이전 파일의 지원 크기를 확인해 주세요.",
      "MASTER_FILE_TOO_LARGE",
    );
    return reply
      .type("application/json; charset=utf-8")
      .header(
        "Content-Disposition",
        `attachment; filename="eks-master-${kstDate(clock())}.eksmaster.json"`,
      )
      .send(bytes);
  });
  app.post(
    "/api/system/master-data/import-preview",
    { bodyLimit: MASTER_LIMIT },
    async (r) => {
      operator(r);
      const result = await preview(r, "master-import", readMaster(r.body));
      return {
        ...result,
        ...((r.body as any)?.stateSchemaVersion === 10
          ? {
              compatibility:
                "업무10 형식1을 업무11로 변환합니다. 자격·인증Set의 초안/사용 등록 속성만 제거하며 ID·내용·연결·상태를 보존합니다.",
            }
          : {}),
      };
    },
  );
  for (const kind of ["master-reset", "master-import"] as const) {
    const url =
      kind === "master-reset"
        ? "/api/testing/master-reset"
        : "/api/system/master-data/import";
    app.post(url, async (r) => {
      const u = operator(r),
        body = z
          .object({
            previewId: z.string().uuid(),
            confirmation: z.literal(
              kind === "master-reset" ? "전체 초기화" : "전체 교체",
            ),
          })
          .strict()
          .parse(r.body);
      const key = z
        .string()
        .min(1)
        .max(160)
        .parse(r.headers["idempotency-key"]);
      const generation = store.generation;
      const result = await store.replaceMaster(
        u.id,
        key,
        contentHash({ kind, ...body }),
        kind,
        clock(),
        (s) => {
          operator(r, s);
        },
        (s, o) => {
          const p = previews.get(body.previewId);
          demand(
            p &&
              p.actorId === u.id &&
              p.kind === kind &&
              p.deadline > Date.now(),
            409,
            "확인 정보가 만료되었습니다. 내용을 다시 검사해 주세요.",
            "MASTER_PREVIEW_EXPIRED",
          );
          demand(
            p.view.generation === store.generation &&
              p.view.stateRevision === s.revision &&
              p.view.organizationRevision === o.revision &&
              p.stateHash === contentHash(s) &&
              p.organizationHash === contentHash(o),
            409,
            "확인 이후 데이터가 변경되었습니다. 내용을 다시 검사해 주세요.",
            "REVISION_CONFLICT",
          );
          return masterCandidate(p.payload, s.revision + 1, o.revision + 1);
        },
      );
      if (generation !== store.generation) invalidateSessions();
      return result;
    });
  }
}
