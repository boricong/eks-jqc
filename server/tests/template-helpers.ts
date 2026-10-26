import { randomUUID } from "node:crypto";
import type { State } from "@eks/contracts";
import { saveTemplate } from "../src/qualification-templates.ts";
import { executeWorkflow } from "../src/workflow.ts";
import { userView } from "../src/organizations.ts";
import type { JsonStore } from "../src/storage.ts";
export function linkFixtureTemplates(s: State) {
  const seen = new Map<string, string>();
  for (const q of s.qualifications) {
    const key = `${q.lv1OrganizationId}:${q.templateId}`;
    if (!q.templateId || (seen.has(key) && seen.get(key) !== q.entityId))
      q.templateId = `fixture-${q.entityId}`;
    seen.set(`${q.lv1OrganizationId}:${q.templateId}`, q.entityId);
    q.templateRevision ??= 1;
    if (!s.qualificationTemplates.some((t) => t.id === q.templateId))
      s.qualificationTemplates.push({
        defaultCommonCourseIds: [],
        id: q.templateId,
        qualificationType: q.qualificationType,
        revision: 1,
        title: q.title || "가상 자격",
        englishName: q.englishName,
        description: q.description,
        updatedBy: "operator-1",
        updatedAt: "2026-10-23T00:00:00.000Z",
      });
  }
  return s;
}
export async function registerFixtureQualification(
  store: JsonStore,
  title = "가상 신규 자격",
  description = "",
  scope = "org-photo",
) {
  return store.transact(
    "operator-1",
    randomUUID(),
    randomUUID(),
    () => {},
    (s) => {
      const t = saveTemplate(s, "operator-1", undefined, {
        title,
        englishName: "",
        description,
      });
      const result = executeWorkflow(
        s,
        userView(
          s.users.find((u) => u.id === "operator-1")!,
          store.organizations.snapshot(),
        ),
        "template.import",
        "",
        { templateIds: [t.id] },
        store.organizations.snapshot(),
        scope,
      ) as { imported: string[] };
      return { id: result.imported[0]!, templateId: t.id, templateRevision: 1 };
    },
  );
}
