import { z } from "zod";
export const QualificationMetadataSchema = z.object({
  templateId: z.string().min(1).max(160),
  templateRevision: z.number().int().positive(),
  title: z.string().max(300),
  englishName: z.string().max(300),
  description: z.string().max(20000),
});
export type QualificationMetadata = z.infer<typeof QualificationMetadataSchema>;
export const QualificationTemplateSchema = z.object({
  id: z.string().min(1).max(160),
  revision: z.number().int().positive(),
  title: z.string().trim().min(1).max(300),
  englishName: z.string().trim().max(300),
  description: z.string().trim().max(20000),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string().min(1),
});
export type QualificationTemplate = z.infer<typeof QualificationTemplateSchema>;
