import { z } from "zod";
const id = z.string().min(1).max(160);
export const OrganizationQualificationRequirementSchema = z
  .object({
    organizationId: id,
    entityIds: z.array(id).max(1000),
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
  stateRevision: number;
  organizationRevision: number;
  entries: {
    id: string;
    name: string;
    path: { id: string; name: string }[];
    effectiveActive: boolean;
    editable: boolean;
    directEntityIds: string[];
    effective: EffectiveRequirement[];
  }[];
  qualifications: {
    entityId: string;
    id: string;
    title: string;
    version: number;
    issues: string[];
  }[];
}
export interface RequirementsPreview {
  stateRevision: number;
  organizationRevision: number;
  changes: { organizationId: string; entityIds: string[] }[];
  affected: {
    organizationId: string;
    name: string;
    added: string[];
    removed: string[];
  }[];
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
