import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { createHash } from "node:crypto";
import type { State, UserView } from "@eks/contracts";
import { managementScope } from "./management.ts";
import { describeIssues } from "./catalog-presentation.ts";
import { demand, type JsonStore } from "./storage.ts";
import {
  catalogHash,
  emptyCatalog,
  exportCatalog,
  prepareCatalog,
  saveCatalogBatch,
  publishCatalogBatch,
} from "./catalog.ts";
import {
  readCatalogWorkbook,
  writeCatalogWorkbook,
} from "./catalog-workbook.ts";

export function registerCatalogRoutes(
  app: FastifyInstance,
  store: JsonStore,
  actor: (r: FastifyRequest, s?: State) => UserView,
) {
  const scope = (r: FastifyRequest, s = store.snapshot()) =>
    managementScope(
      actor(r, s),
      store.organizations.snapshot(),
      z.object({ lv1OrganizationId: z.string().optional() }).parse(r.query)
        .lv1OrganizationId,
    );
  const download = (reply: any, buffer: Buffer) =>
    reply
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("Content-Disposition", 'attachment; filename="eks-catalog.xlsx"')
      .send(buffer);
  app.addContentTypeParser(
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    { parseAs: "buffer", bodyLimit: 10 * 1024 * 1024 },
    (_r, body, done) => done(null, body),
  );
  app.get("/api/catalog/workbook-template", async (r, reply) =>
    download(reply, await writeCatalogWorkbook(emptyCatalog(scope(r)))),
  );
  app.post(
    "/api/catalog/workbook-export",
    { bodyLimit: 15 * 1024 * 1024 },
    async (r, reply) => {
      const lv1 = scope(r),
        body = r.body as any;
      const workbook = body.workbook
        ? prepareCatalog(store.snapshot(), body.workbook, lv1).workbook
        : exportCatalog(
            store.snapshot(),
            lv1,
            z.array(z.string()).min(1).max(100).parse(body.qualificationIds),
          );
      const issues = prepareCatalog(store.snapshot(), workbook, lv1).issues;
      if (body.view === "table") {
        const p = prepareCatalog(store.snapshot(), workbook, lv1);
        return { workbook: p.workbook, issues: p.issues, changes: p.changes };
      }
      const buffer = await writeCatalogWorkbook(
        workbook,
        body.review ? issues : [],
      );
      demand(scope(r) === lv1, 403, "관리 권한 또는 대상이 변경되었습니다.");
      return download(reply, buffer);
    },
  );
  app.post(
    "/api/catalog/workbook-preview",
    { bodyLimit: 10 * 1024 * 1024 },
    async (r) => {
      const lv1 = scope(r);
      demand(Buffer.isBuffer(r.body), 422, "XLSX 파일을 선택해 주세요.");
      const parsed = await readCatalogWorkbook(r.body);
      // Recheck identity after asynchronous parsing; preview never changes business data.
      demand(scope(r) === lv1, 403, "관리 권한 또는 대상이 변경되었습니다.");
      const p = prepareCatalog(store.snapshot(), parsed.workbook, lv1);
      const issues = [...parsed.issues, ...p.issues].map((i) => ({
        ...i,
        cell:
          i.cell ||
          parsed.locations.get(`${i.sheet}/${i.table}/${i.row}/${i.column}`),
      }));
      p.workbook.sheets.forEach((s) => describeIssues(s, issues));
      return {
        workbook: p.workbook,
        issues,
        changes: p.changes,
        fileHash: createHash("sha256").update(r.body).digest("hex"),
      };
    },
  );
  app.post(
    "/api/catalog/batches/validate",
    { bodyLimit: 15 * 1024 * 1024 },
    async (r) => {
      const p = prepareCatalog(
        store.snapshot(),
        (r.body as any).workbook,
        scope(r),
      );
      return { workbook: p.workbook, issues: p.issues, changes: p.changes };
    },
  );
  app.post(
    "/api/catalog/batches",
    { bodyLimit: 15 * 1024 * 1024 },
    async (r) => {
      const user = actor(r),
        lv1 = scope(r),
        body = r.body as any;
      const fileHash = z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional()
        .parse(body.fileHash || undefined);
      const key = z
        .string()
        .min(1)
        .max(160)
        .parse(r.headers["idempotency-key"]);
      return store.transact(
        user.id,
        key,
        catalogHash({
          action: "catalog.batch.save",
          lv1,
          workbook: body.workbook,
          fileHash: fileHash || "",
        }),
        (s) => {
          demand(scope(r, s) === lv1, 403, "관리 대상이 변경되었습니다.");
        },
        (s) => saveCatalogBatch(s, body.workbook, lv1, user.id, fileHash),
        {
          preserveBackup: true,
          backupPurpose: "catalog-import",
          action: "catalog.batch.save",
          lv1OrganizationId: lv1,
        },
      );
    },
  );
  app.get("/api/catalog/batches", async (r) => {
    const lv1 = scope(r);
    return store
      .snapshot()
      .catalogBatches.filter((b) => b.lv1OrganizationId === lv1)
      .slice()
      .reverse();
  });
  app.post("/api/catalog/batches/:id/publish", async (r) => {
    const user = actor(r),
      lv1 = scope(r),
      id = (r.params as any).id;
    const selectedIds = z
      .object({
        qualificationIds: z.array(z.string()).min(1).max(100).optional(),
      })
      .parse(r.body || {}).qualificationIds;
    return store.transact(
      user.id,
      z.string().min(1).max(160).parse(r.headers["idempotency-key"]),
      catalogHash({
        action: "catalog.batch.publish",
        lv1,
        id,
        qualificationIds: selectedIds,
      }),
      (s) => {
        demand(scope(r, s) === lv1, 403, "관리 대상이 변경되었습니다.");
      },
      (s) => publishCatalogBatch(s, id, lv1, user.id, selectedIds),
      {
        preserveBackup: true,
        backupPurpose: "catalog-publish",
        action: "catalog.batch.publish",
        lv1OrganizationId: lv1,
      },
    );
  });
}
