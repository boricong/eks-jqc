import { migratePlanning } from "./planning-migration.ts";
import { randomUUID } from "node:crypto";
import {
  QualificationTemplateSchema,
  type QualificationTemplate,
} from "@eks/contracts";
import { initialTemplates, metadata } from "./qualification-templates.ts";
import { validateState } from "./integrity.ts";
import { migrationOrganizations as validateOrganizations } from "./automatic-criteria-migration.ts";
export interface TemplateMapping {
  templates?: QualificationTemplate[];
  entities?: Record<string, string>;
}
export function upgradeTemplateData(
  input: any,
  mapping: TemplateMapping = {},
  at = new Date().toISOString(),
) {
  const next = structuredClone(input);
  const actor = next.users.find((u: any) =>
    u.roles.includes("system_operator"),
  )?.id;
  next.qualificationTemplates ??= initialTemplates(actor, at);
  for (const t of mapping.templates || []) {
    if (next.qualificationTemplates.some((v: any) => v.id === t.id))
      throw new Error(`기본자격 중복: ${t.id}`);
    next.qualificationTemplates.push(QualificationTemplateSchema.parse(t));
  }
  for (const q of next.qualifications) {
    q.templateId = mapping.entities?.[q.entityId] || q.templateId;
    const t = next.qualificationTemplates.find(
      (t: any) => t.id === q.templateId,
    );
    if (!t)
      throw new Error(
        `기본자격 연결 정보가 필요합니다: ${q.entityId} (${q.title}). --mapping 파일을 지정해 주세요.`,
      );
    q.templateRevision ??= t.revision;
  }
  for (const a of next.assignments || [])
    a.qualificationMetadata ??= metadata(
      next.qualifications.find((q: any) => q.id === a.qualificationId),
    );
  for (const p of next.plans || [])
    if (p.status === "completed")
      p.qualificationMetadata ??= metadata(
        next.qualifications.find((q: any) => q.id === p.qualificationId),
      );
  for (const c of next.certifications || [])
    c.qualificationMetadata ??= {
      ...metadata(
        next.qualifications.find((q: any) => q.id === c.qualificationId),
      ),
      ...(c.snapshot ? { title: c.snapshot.title } : {}),
    };
  return next;
}
export function migrateTemplates(
  input: unknown,
  organizationInput: unknown,
  at = new Date().toISOString(),
  mapping: TemplateMapping = {},
) {
  const raw = input as any;
  if (
    ![11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24].includes(
      raw?.schemaVersion,
    )
  )
    throw new Error("기본자격 이관에는 업무11·조직2가 필요합니다.");
  const organizations = validateOrganizations(organizationInput);
  const alreadyApplied = raw.schemaVersion >= 12;
  const next = alreadyApplied
    ? structuredClone(raw)
    : upgradeTemplateData(raw, mapping, at);
  if (!alreadyApplied) {
    next.schemaVersion = 12;
    next.revision++;
    next.audits.push({
      id: randomUUID(),
      actorId: next.users.find((u: any) => u.roles.includes("system_operator"))
        .id,
      date: at,
      action: "migration.qualification-templates",
      targetId: "qualification-templates-v12",
      reason: "공통 기본자격·팀 등록 및 당시 정보 보존 이관",
      details: {
        fromSchema: 11,
        progressReset: false,
        previousMetadata: raw.qualifications.map((q: any) => ({
          id: q.id,
          title: q.title,
          englishName: q.englishName,
          description: q.description,
        })),
      },
    });
  }
  const state = migratePlanning(next, organizations, at).state;
  return {
    state,
    organizations,
    report: {
      alreadyApplied: raw.schemaVersion === 24,
      schemaVersion: state.schemaVersion,
      revision: state.revision,
      templates: state.qualificationTemplates.length,
      needsDescription: state.qualificationTemplates.filter(
        (t) => !t.description,
      ).length,
      qualifications: state.qualifications.length,
      courses: state.courses.length,
      plans: state.plans.length,
      assignments: state.assignments.length,
      certifications: state.certifications.length,
    },
  };
}
