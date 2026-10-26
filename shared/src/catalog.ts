import { z } from "zod";

// Historical records only. Excel and bulk criteria editing were retired on 2026-10-26.
export const CatalogBatchSchema = z.object({
  id: z.string(),
  lv1OrganizationId: z.string(),
  actorId: z.string(),
  createdAt: z.iso.datetime(),
  contentHash: z.string(),
  qualificationIds: z.array(z.string()),
  courseIds: z.array(z.string()),
  status: z.enum(["saved", "draft", "partial", "published"]),
  publishedAt: z.iso.datetime().optional(),
  publishedQualificationIds: z.array(z.string()).optional(),
  publicationResults: z
    .array(
      z.object({
        qualificationId: z.string(),
        actorId: z.string(),
        publishedAt: z.string(),
      }),
    )
    .optional(),
  revisions: z.record(z.string(), z.number().int().positive()),
});
export type CatalogBatch = z.infer<typeof CatalogBatchSchema>;
