import { z } from "zod";

export const organizationId = z
  .string()
  .min(1)
  .max(160)
  .refine(
    (value) => !["__proto__", "constructor", "prototype"].includes(value),
    "예약된 식별자입니다.",
  );
export const OrganizationPathSchema = z
  .array(z.object({ id: organizationId, name: z.string().min(1) }))
  .min(1);
export interface OrganizationNode {
  id: string;
  name: string;
  active: boolean;
  children: OrganizationNode[];
  description?: string;
  duties?: string;
  requiredQualifications?: string[] | null;
}
export const OrganizationNodeSchema: z.ZodType<OrganizationNode> = z.lazy(() =>
  z.object({
    id: organizationId,
    name: z.string().trim().min(1).max(200),
    active: z.boolean(),
    children: z.array(OrganizationNodeSchema),
    description: z.string().max(4000).default(""),
    duties: z.string().max(4000).default(""),
    requiredQualifications: z.array(organizationId).nullable().default(null),
  }),
);
export const RequestRecordSchema = z.object({
  actorId: organizationId,
  key: organizationId,
  fingerprint: z.string(),
  response: z.json(),
  date: z.iso.datetime(),
  lv1OrganizationId: organizationId.optional(),
  action: z.string().optional(),
});
export const OrganizationDocumentSchema = z.object({
  schemaVersion: z.literal(2),
  revision: z.number().int().nonnegative(),
  roots: z.array(OrganizationNodeSchema).min(1),
  qualificationPools: z
    .array(
      z.object({
        lv1OrganizationId: organizationId,
        entityId: organizationId,
        qualificationId: organizationId,
      }),
    )
    .default([]),
  audits: z.array(
    z.object({
      id: organizationId,
      actorId: organizationId,
      date: z.iso.datetime(),
      targetId: organizationId,
      action: z.string(),
      before: z.json(),
      after: z.json(),
    }),
  ),
  requests: z.array(RequestRecordSchema),
});
export type OrganizationDocument = z.infer<typeof OrganizationDocumentSchema>;
export interface OrganizationView {
  revision: number;
  roots: OrganizationNode[];
  entries: (OrganizationEntry & { userCount: number })[];
  audits: OrganizationDocument["audits"];
}
export interface OrganizationEntry {
  id: string;
  name: string;
  parentId: string | null;
  level: number;
  order: number;
  active: boolean;
  effectiveActive: boolean;
  lv1OrganizationId: string;
  path: { id: string; name: string }[];
  description: string;
  duties: string;
  requiredQualifications: string[] | null;
}
export function organizationEntries(
  doc: Pick<OrganizationDocument, "roots">,
): OrganizationEntry[] {
  const entries: OrganizationEntry[] = [];
  const pending = doc.roots
    .map((node, order) => ({
      node,
      order,
      parent: undefined as OrganizationEntry | undefined,
    }))
    .reverse();
  while (pending.length) {
    const { node, order, parent } = pending.pop()!;
    const entry: OrganizationEntry = {
      id: node.id,
      name: node.name,
      parentId: parent?.id ?? null,
      level: (parent?.level ?? 0) + 1,
      order,
      active: node.active,
      effectiveActive: node.active && (parent?.effectiveActive ?? true),
      lv1OrganizationId: parent?.lv1OrganizationId ?? node.id,
      path: [...(parent?.path ?? []), { id: node.id, name: node.name }],
      description: node.description ?? "",
      duties: node.duties ?? "",
      requiredQualifications: node.requiredQualifications ?? null,
    };
    entries.push(entry);
    for (let i = node.children.length - 1; i >= 0; i--)
      pending.push({ node: node.children[i]!, order: i, parent: entry });
  }
  return entries;
}
export const ResetScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all") }),
  z.object({
    type: z.literal("organization"),
    lv1OrganizationId: organizationId,
  }),
]);
export type ResetScope = z.infer<typeof ResetScopeSchema>;

export interface RequiredQualification {
  previousCertificationId?: string;
  entityId: string;
  qualificationId: string;
  title: string;
  version: number;
  status:
    | "fulfilled"
    | "expired"
    | "unknown"
    | "draft"
    | "progress"
    | "ready"
    | "waiting"
    | "blocked";
  reason: string;
  canStart: boolean;
  requestId?: string;
  requestedVersion?: number;
  planId?: string;
  assignmentId?: string;
  certificationId?: string;
}
export interface RequiredQualificationsView {
  revision: number;
  organizationId: string;
  organizationPath: OrganizationEntry["path"];
  description: string;
  duties: string;
  configured: boolean;
  items: RequiredQualification[];
}
export interface RequestProgress {
  id: string;
  learnerId: string;
  total: number;
  planned: number;
  valid: number;
  excluded: number;
  stage: string;
}
export interface OrganizationPoliciesView {
  revision: number;
  stateRevision: number;
  lv1OrganizationId: string;
  canManagePool: boolean;
  canAssignAdministrators: boolean;
  entries: (OrganizationEntry & { userCount: number; draftCount: number })[];
  pool: {
    entityId: string;
    qualificationId: string;
    title: string;
    version: number;
    errors: string[];
  }[];
}
export interface OrganizationAdministratorsView {
  revision: number;
  organizationRevision: number;
  organizationId: string;
  candidates: { id: string; name: string; assigned: boolean }[];
}

export interface PlanningCandidate {
  entityId: string;
  qualificationId: string;
  title: string;
  version: number;
  required: boolean;
  selected: boolean;
  status: "available" | "draft" | "planned" | "valid" | "blocked";
  reason: string;
  canStart: boolean;
  planId?: string;
  assignmentId?: string;
  certificationId?: string;
  previousCertificationId?: string;
}
export interface PlanningRequestView {
  requestId: string;
  revision: number;
  candidates: PlanningCandidate[];
  errors: string[];
  canComplete: boolean;
  noAdditional: boolean;
  stage: string;
}
