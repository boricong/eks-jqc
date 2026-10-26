import { saveTemplate } from "../src/qualification-templates.ts";
import { executeWorkflow } from "../src/workflow.ts";
import { seedOrganizations } from "../src/organizations.ts";
import type { State, UserView } from "@eks/contracts";
/** Test fixture using the same system-template and team-import path as production. */
export function createPoolQualification(
  s: State,
  u: UserView,
  team: string,
  input: {
    level: "general" | "main";
    title: string;
    description?: string;
    revision?: number;
  },
  at: string,
) {
  const general = s.qualificationTemplates.find(
    (t) =>
      t.qualificationType === "auditor" &&
      t.auditorLevel === "general" &&
      t.scope !== "team",
  );
  const template = saveTemplate(s, "operator-1", undefined, {
    qualificationType: "auditor",
    auditorLevel: input.level,
    ...(input.level === "main" ? { prerequisiteTemplateId: general?.id } : {}),
    title: input.title,
    englishName: "",
    description: input.description || "",
  });
  const result = executeWorkflow(
    s,
    u,
    "template.import",
    "",
    {
      templateIds: [template.id],
      templateRevisions: { [template.id]: template.revision },
    },
    seedOrganizations(),
    team,
    at,
  ) as { imported: string[] };
  return { id: result.imported[0]! };
}
export function startInput(
  s: State,
  level: "general" | "main",
  team = "org-photo",
) {
  const q = s.qualifications
    .filter(
      (q) =>
        q.lv1OrganizationId === team &&
        !q.deletedAt &&
        s.qualificationTemplates.find((t) => t.id === q.templateId)
          ?.auditorLevel === level,
    )
    .sort((a, b) => (b.version || 0) - (a.version || 0))[0]!;
  return {
    qualificationId: q.id,
    qualificationRevision: q.revision,
    templateRevision: s.qualificationTemplates.find(
      (t) => t.id === q.templateId,
    )!.revision,
  };
}
