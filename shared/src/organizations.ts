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
  .min(1)
  .max(4);
export interface OrganizationNode {
  id: string;
  name: string;
  active: boolean;
  children: OrganizationNode[];
}
export const OrganizationNodeSchema: z.ZodType<OrganizationNode> = z.lazy(() =>
  z.object({
    id: organizationId,
    name: z.string().trim().min(1).max(200),
    active: z.boolean(),
    children: z.array(OrganizationNodeSchema),
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
  schemaVersion: z.literal(1),
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
}
export function organizationEntries(
  doc: Pick<OrganizationDocument, "roots">,
): OrganizationEntry[] {
  const entries: OrganizationEntry[] = [];
  function walk(nodes: OrganizationNode[], parent?: OrganizationEntry) {
    nodes.forEach((node, order) => {
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
      };
      entries.push(entry);
      walk(node.children, entry);
    });
  }
  walk(doc.roots);
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
