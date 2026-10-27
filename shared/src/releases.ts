import { z } from "zod";

export const ReleaseVersionSchema = z
  .object({
    major: z.number().int().positive(),
    minor: z.number().int().nonnegative(),
  })
  .strict();
export type ReleaseVersion = z.infer<typeof ReleaseVersionSchema>;
export const ReleaseInfoSchema = z.object({
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
  kind: z.enum(["initial", "minor", "major", "migration"]),
  summary: z.string(),
  cause: z.string(),
  previousId: z.string().optional(),
});
export type ReleaseInfo = z.infer<typeof ReleaseInfoSchema>;
export function releaseVersionLabel(
  value:
    | { releaseVersion?: ReleaseVersion | null; version?: number | null }
    | null
    | undefined,
) {
  const v =
    value?.releaseVersion ??
    (value?.version ? { major: value.version, minor: 0 } : null);
  return v ? `v${v.major}.${v.minor}` : "—";
}
export function nextReleaseVersion(
  previous: ReleaseVersion,
  kind: "minor" | "major",
): ReleaseVersion {
  return kind === "major"
    ? { major: previous.major + 1, minor: 0 }
    : { major: previous.major, minor: previous.minor + 1 };
}
export const FrozenCriteriaSchema = z.object({
  qualificationId: z.string(),
  qualificationVersion: ReleaseVersionSchema,
  qualificationHash: z.string(),
  courses: z.array(
    z.object({
      id: z.string(),
      entityId: z.string(),
      releaseVersion: ReleaseVersionSchema,
      hash: z.string(),
    }),
  ),
  confirmedAt: z.iso.datetime(),
  confirmedBy: z.string(),
  source: z.enum(["plan", "auditor", "renewal", "migration"]),
});
export type FrozenCriteria = z.infer<typeof FrozenCriteriaSchema>;
export const CommonUpdateSchema = z.object({
  id: z.string(),
  commonCourseId: z.string(),
  sourceReleaseId: z.string(),
  courseEntityId: z.string(),
  teamId: z.string(),
  status: z.enum(["pending", "applied", "kept", "superseded"]),
  reason: z.string(),
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().optional(),
  resolvedBy: z.string().optional(),
});
export interface ReleasePropagation {
  updated: { id: string; title: string; releaseVersion: ReleaseVersion }[];
  deferred: { id: string; title: string; reason: string }[];
}
