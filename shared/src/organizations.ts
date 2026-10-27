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
}
export const OrganizationNodeSchema: z.ZodType<OrganizationNode> = z.lazy(() =>
  z.object({
    id: organizationId,
    name: z.string().trim().min(1).max(200),
    active: z.boolean(),
    children: z.array(OrganizationNodeSchema),
    description: z.string().max(4000).default(""),
    duties: z.string().max(4000).default(""),
  }),
);
/** Read-only compatibility schema. Never accepted by current organization writes. */
export const LegacyOrganizationNodeSchema: z.ZodType<
  OrganizationNode & { requiredQualifications?: string[] | null }
> = z.lazy(() =>
  z.object({
    id: organizationId,
    name: z.string().trim().min(1).max(200),
    active: z.boolean(),
    children: z.array(LegacyOrganizationNodeSchema),
    description: z.string().max(4000).default(""),
    duties: z.string().max(4000).default(""),
    requiredQualifications: z.array(organizationId).nullable().default(null),
  }),
);
export const RequestRecordSchema = z.object({
  preserveBackup: z.boolean().optional(),
  backupPurpose: z.string().optional(),
  actorId: organizationId,
  key: organizationId,
  fingerprint: z.string(),
  response: z.json(),
  date: z.iso.datetime(),
  lv1OrganizationId: organizationId.optional(),
  action: z.string().optional(),
});
export const OrganizationDocumentSchema = z.object({
  schemaVersion: z.literal(4),
  revision: z.number().int().nonnegative(),
  roots: z.array(OrganizationNodeSchema).min(1),
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
    };
    entries.push(entry);
    for (let i = node.children.length - 1; i >= 0; i--)
      pending.push({ node: node.children[i]!, order: i, parent: entry });
  }
  return entries;
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
export interface OrganizationSettingsView {
  revision: number;
  stateRevision: number;
  lv1OrganizationId: string;
  canAssignAdministrators: boolean;
  entries: (OrganizationEntry & { userCount: number })[];
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
