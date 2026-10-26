import { z } from "zod";

export const AuditorLevelSchema = z.enum(["general", "main"]);
export type AuditorLevel = z.infer<typeof AuditorLevelSchema>;
export const auditorLevelLabels = {
  general: "일반 Auditor",
  main: "메인 Auditor",
};
export const AuditorNoticeSchema = z.object({
  revision: z.number().int().nonnegative(),
  title: z.string().trim().max(300),
  body: z.string().trim().max(2000),
  links: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        url: z
          .url()
          .refine((v) => ["http:", "https:"].includes(new URL(v).protocol)),
      }),
    )
    .max(20),
});
export const AuditorProgramSchema = z.object({
  lv1OrganizationId: z.string().min(1),
  revision: z.number().int().positive(),
  general: z
    .object({ templateId: z.string(), entityId: z.string() })
    .optional(),
  main: z.object({ templateId: z.string(), entityId: z.string() }).optional(),
  notice: AuditorNoticeSchema,
  updatedBy: z.string(),
  updatedAt: z.iso.datetime(),
});
export type AuditorProgram = z.infer<typeof AuditorProgramSchema>;
export const AuditorDesignationSchema = z.object({
  id: z.string(),
  actorId: z.string(),
  at: z.iso.datetime(),
  source: z.enum(["designation", "migration"]),
});
export const AuditorAssignmentSchema = z.object({
  pendingGeneralCertification: z.boolean().optional(),
  level: AuditorLevelSchema,
  kind: z.enum(["initial", "reacquisition"]),
  designationId: z.string(),
  programRevision: z.number().int().positive(),
  criteriaManagerId: z.string(),
});
export const AuditorCertificationSchema = z.object({
  level: AuditorLevelSchema,
  kind: z.enum(["initial", "reacquisition"]),
  prerequisiteCertificationId: z.string().optional(),
});
