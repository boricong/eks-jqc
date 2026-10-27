import { createHash } from "node:crypto";
import { z } from "zod";
import { TestDataReceiptSchema } from "@eks/contracts";

export function contentHash(value: unknown): string {
  const canonical = (v: any): any =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .filter((k) => v[k] !== undefined)
              .map((k) => [k, canonical(v[k])]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export const MaintenanceDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    generation: z.string().uuid(),
    testDataOperations: z.array(TestDataReceiptSchema).default([]),
    // Opaque read-only legacy data: never executed or removed during normal load.
    testEnvironment: z.unknown().optional(),
    receipts: z.array(
      z
        .object({
          operationId: z.string().uuid(),
          key: z.string().min(1).max(160),
          fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
          actorId: z.string().min(1),
          kind: z.enum([
            "master-reset",
            "master-import",
            "test-load",
            "test-reset",
            "test-reload",
            "test-delete",
          ]),
          completedAt: z.iso.datetime(),
          generation: z.string().uuid(),
          previousGeneration: z.string().uuid(),
          stateRevision: z.number().int().nonnegative(),
          organizationRevision: z.number().int().nonnegative(),
          preserved: z.record(z.string(), z.number().int().nonnegative()),
          deleted: z.record(z.string(), z.number().int().nonnegative()),
          backups: z
            .object({ state: z.string(), organizations: z.string() })
            .strict(),
        })
        .strict(),
    ),
  })
  .strict()
  .refine(
    (v) => new Set(v.receipts.map((r) => r.key)).size === v.receipts.length,
    "실행 영수증 식별자 중복",
  )
  .refine(
    (v) =>
      new Set(v.testDataOperations.map((r) => r.key)).size ===
      v.testDataOperations.length,
    "테스트 데이터 실행 식별자 중복",
  );
