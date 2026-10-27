import { z } from "zod";
const id = z.string().min(1).max(160);
export const RequirementExclusionSchema = z
  .object({
    entityId: id,
    reason: z.string().trim().min(1).max(500),
    updatedBy: id,
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type RequirementExclusion = z.infer<typeof RequirementExclusionSchema>;
export interface RequirementRule {
  organization: { id: string; name: string };
  entityIds: string[];
  exclusions: RequirementExclusion[];
  revision: number;
}
export interface ExcludedRequirement {
  entityId: string;
  organization: { id: string; name: string };
  reason: string;
  hasInherited: boolean;
  sourceOrganizations: { id: string; name: string }[];
}
export const OrganizationQualificationRequirementSchema = z
  .object({
    organizationId: id,
    entityIds: z.array(id).max(1000),
    exclusions: z.array(RequirementExclusionSchema).max(1000).default([]),
    revision: z.number().int().positive(),
    updatedAt: z.iso.datetime(),
    updatedBy: id,
  })
  .strict();
export type OrganizationQualificationRequirement = z.infer<
  typeof OrganizationQualificationRequirementSchema
>;
export interface EffectiveRequirement {
  entityId: string;
  qualificationId: string;
  title: string;
  version: number;
  sourceOrganizations: { id: string; name: string }[];
  issues: string[];
}
export interface OrganizationRequirementsView {
  ancestorRules: RequirementRule[];
  stateRevision: number;
  organizationRevision: number;
  entries: {
    id: string;
    name: string;
    path: { id: string; name: string }[];
    parentId: string | null;
    level: number;
    effectiveActive: boolean;
    editable: boolean;
    directEntityIds: string[];
    exclusions: RequirementExclusion[];
    excluded: ExcludedRequirement[];
    effective: EffectiveRequirement[];
  }[];
  qualifications: {
    entityId: string;
    id: string;
    title: string;
    version: number;
    releaseVersion?: { major: number; minor: number };
    issues: string[];
  }[];
}
export interface RequirementChange {
  organizationId: string;
  entityIds: string[];
  exclusions: { entityId: string; reason: string }[];
  removalReasons: { entityId: string; reason: string }[];
}
export interface RequirementsPreview {
  contractVersion: 2;
  exceptionChanges: {
    organizationId: string;
    entityId: string;
    action: "exclude" | "restore" | "reason";
    reason: string;
  }[];
  stateRevision: number;
  organizationRevision: number;
  changes: RequirementChange[];
  affected: {
    organizationId: string;
    name: string;
    added: string[];
    removed: string[];
    sourceChanged: {
      entityId: string;
      before: { id: string; name: string }[];
      after: { id: string; name: string }[];
    }[];
    issues: string[];
    exclusionChanged: string[];
  }[];
  summary: {
    affectedOrganizations: number;
    membershipChangedOrganizations: number;
    sourceOnlyOrganizations: number;
    exceptionOnlyOrganizations: number;
    affectedMembers: number;
  };
}
export interface PlanningRequestPreview {
  stateRevision: number;
  organizationRevision: number;
  rows: {
    learnerId: string;
    name: string;
    organizationId: string;
    organizationPath: { id: string; name: string }[];
    status: "ready" | "excluded" | "blocked";
    reasons: string[];
    requirements: EffectiveRequirement[];
    existingRequestIds: string[];
    coveredEntityIds: string[];
  }[];
}

/** Ordered path rules: exclusions erase all earlier sources; later direct rules restart inheritance. */
export function resolveRequirementRules(
  path: { id: string; name: string }[],
  rules: ReadonlyMap<string, Pick<RequirementRule, "entityIds" | "exclusions">>,
) {
  const sources = new Map<string, { id: string; name: string }[]>();
  const excluded = new Map<string, ExcludedRequirement>();
  for (const org of path) {
    const rule = rules.get(org.id);
    for (const e of rule?.exclusions || []) {
      excluded.set(e.entityId, {
        entityId: e.entityId,
        organization: org,
        reason: e.reason,
        hasInherited: sources.has(e.entityId),
        sourceOrganizations: [...(sources.get(e.entityId) || [])],
      });
      sources.delete(e.entityId);
    }
    for (const id of rule?.entityIds || []) {
      const list = sources.get(id) || [];
      if (!list.some((s) => s.id === org.id)) list.push(org);
      sources.set(id, list);
      excluded.delete(id);
    }
  }
  return { sources, excluded };
}
