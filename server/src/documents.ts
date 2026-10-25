import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { SystemDocumentSummary, UserView } from "@eks/contracts";
import { systemOperator } from "./organizations.ts";
import { DomainError, demand } from "./errors.ts";

export const defaultDocumentsRoot = fileURLToPath(
  new URL("../../docs/", import.meta.url),
);
const entry = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().max(2000),
    updatedOn: z.iso.date(),
    sourcePath: z
      .string()
      .min(1)
      .max(500)
      .refine(
        (value) =>
          !path.isAbsolute(value) &&
          !/[\\:\x00-\x1f?#]/.test(value) &&
          value.endsWith(".md") &&
          value
            .split("/")
            .every((part) => part && part !== "." && part !== ".."),
      ),
  })
  .strict();
const catalog = z
  .array(entry)
  .max(1000)
  .refine(
    (items) =>
      new Set(items.map((item) => item.id)).size === items.length &&
      new Set(items.map((item) => item.sourcePath)).size === items.length,
  );

export class DocumentLibrary {
  constructor(private root = defaultDocumentsRoot) {}

  private async text(relative: string) {
    const root = await realpath(this.root);
    const file = await realpath(path.resolve(root, relative));
    const within = path.relative(root, file);
    if (
      !within ||
      within.startsWith(`..${path.sep}`) ||
      within === ".." ||
      path.isAbsolute(within)
    )
      throw new Error("Document outside library");
    const info = await stat(file);
    if (!info.isFile() || info.size > 2 * 1024 * 1024)
      throw new Error("Invalid document file");
    return new TextDecoder("utf-8", { fatal: true }).decode(
      await readFile(file),
    );
  }

  async list(): Promise<SystemDocumentSummary[]> {
    try {
      return catalog
        .parse(JSON.parse(await this.text("document-catalog.json")))
        .sort(
          (a, b) =>
            b.updatedOn.localeCompare(a.updatedOn) || a.id.localeCompare(b.id),
        );
    } catch {
      throw new DomainError(
        503,
        "문서 목록을 불러오지 못했습니다. 다시 시도해 주세요.",
        "DOCUMENT_CATALOG_UNAVAILABLE",
      );
    }
  }

  async read(id: string) {
    const item = (await this.list()).find((item) => item.id === id);
    demand(item, 404, "문서를 찾을 수 없습니다.", "DOCUMENT_NOT_FOUND");
    try {
      return { ...item, markdown: await this.text(item.sourcePath) };
    } catch {
      throw new DomainError(
        503,
        "문서를 불러오지 못했습니다. 다시 시도해 주세요.",
        "DOCUMENT_UNAVAILABLE",
      );
    }
  }
}

export function registerDocumentRoutes(
  app: FastifyInstance,
  actor: (request: FastifyRequest) => UserView,
  root?: string,
) {
  const library = new DocumentLibrary(root);
  app.get("/api/system/documents", async (request) => {
    systemOperator(actor(request));
    return { items: await library.list() };
  });
  app.get<{ Params: { id: string } }>(
    "/api/system/documents/:id",
    async (request) => {
      systemOperator(actor(request));
      return library.read(request.params.id);
    },
  );
}
