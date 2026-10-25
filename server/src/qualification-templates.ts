import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  QualificationTemplateSchema,
  QualificationTypeSchema,
  qualificationProcessErrors,
  type State,
  type Qualification,
  type QualificationMetadata,
} from "@eks/contracts";
import { demand } from "./errors.ts";
export const qualificationTemplates: {
  id: string;
  title: string;
  englishName: string;
}[] = JSON.parse(
  readFileSync(
    new URL("./qualification-templates.json", import.meta.url),
    "utf8",
  ),
);
export function initialTemplates(
  actorId = "operator-1",
  at = "2026-10-23T00:00:00.000Z",
) {
  return qualificationTemplates.map((t) => ({
    ...t,
    qualificationType: "auditee" as const,
    description: "",
    revision: 1,
    updatedAt: at,
    updatedBy: actorId,
  }));
}
export function currentQualification(
  s: Pick<State, "qualificationTemplates">,
  q: Qualification,
): Qualification {
  const t = s.qualificationTemplates.find((t) => t.id === q.templateId);
  demand(t, 422, "연결된 기본자격을 찾을 수 없습니다.");
  return {
    ...q,
    qualificationType: t.qualificationType,
    title: t.title,
    englishName: t.englishName,
    description: t.description,
    templateRevision: t.revision,
  };
}
export function metadata(q: Qualification): QualificationMetadata {
  return {
    qualificationType: q.qualificationType ?? "auditee",
    templateId: q.templateId,
    templateRevision: q.templateRevision,
    title: q.title,
    englishName: q.englishName,
    description: q.description,
  };
}
export function checkCommonFields(s: State, q: Qualification, input: any) {
  const current = currentQualification(s, q);
  demand(
    input.templateId === undefined || input.templateId === q.templateId,
    422,
    "기본자격 연결은 변경할 수 없습니다.",
  );
  demand(
    (input.templateRevision ?? 1) === current.templateRevision,
    409,
    "기본자격 정보가 변경되었습니다. 최신 공통 정보를 확인한 뒤 다시 저장해 주세요.",
    "TEMPLATE_CHANGED",
  );
  for (const field of [
    "title",
    "englishName",
    "description",
    "qualificationType",
  ] as const)
    demand(
      input[field] === undefined || input[field] === current[field],
      422,
      "공통 이름·설명·인증 유형은 기본자격 관리에서만 변경할 수 있습니다.",
      "COMMON_METADATA_READ_ONLY",
    );
  return current;
}
export function saveTemplate(
  s: State,
  actorId: string,
  target: string | undefined,
  body: unknown,
) {
  const input = z
    .object({
      revision: z.number().int().positive().optional(),
      qualificationType: QualificationTypeSchema.optional(),
      title: z.string().trim().min(1).max(300),
      englishName: z.string().trim().max(300),
      description: z.string().trim().max(20000),
    })
    .strict()
    .parse(body);
  const old = target
    ? s.qualificationTemplates.find((t) => t.id === target)
    : undefined;
  demand(!target || old, 404, "기본자격을 찾을 수 없습니다.");
  demand(
    !old || old.revision === input.revision,
    409,
    "기본자격이 변경되었습니다. 다시 불러와 주세요.",
    "REVISION_CONFLICT",
  );
  const qualificationType =
    input.qualificationType ?? old?.qualificationType ?? "auditee";
  demand(
    !old ||
      old.qualificationType === qualificationType ||
      templateTypeEditing(s, old.id).canChangeType,
    409,
    "팀 등록 이력이 있는 기본자격은 유형을 변경할 수 없습니다. 새 기본자격을 만들어 주세요.",
    "QUALIFICATION_TYPE_LOCKED",
  );
  const at = new Date().toISOString();
  const next = QualificationTemplateSchema.parse({
    ...input,
    qualificationType,
    id: old?.id || randomUUID(),
    revision: (old?.revision || 0) + 1,
    updatedAt: at,
    updatedBy: actorId,
  });
  if (old)
    s.qualificationTemplates[s.qualificationTemplates.indexOf(old)] = next;
  else s.qualificationTemplates.push(next);
  s.audits.push({
    id: randomUUID(),
    actorId,
    date: at,
    action: old
      ? "qualification-template.update"
      : "qualification-template.create",
    targetId: next.id,
    reason: "시스템 공통 기본자격 관리",
    details: { before: old || null, after: next },
  });
  return next;
}

export function templateTypeEditing(s: State, id: string) {
  const canChangeType = !s.qualifications.some((q) => q.templateId === id);
  return {
    canChangeType,
    typeChangeReason: canChangeType
      ? "팀 등록 전까지 유형을 변경할 수 있습니다."
      : "팀 등록 이력이 있어 유형을 변경할 수 없습니다.",
  };
}
export function requireQualificationProcess(q: Qualification) {
  const errors = qualificationProcessErrors(q);
  demand(
    !errors.length,
    409,
    errors.join(" · "),
    "QUALIFICATION_PROCESS_UNAVAILABLE",
  );
}
