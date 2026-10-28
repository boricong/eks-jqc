import { appendQualification } from "./releases.ts";
import { currentTeamQualifications } from "@eks/contracts";
import { auditorCriteria, auditorTemplateErrors } from "./auditor-pool.ts";
import { validateDefaultCommonCourses } from "./common-courses.ts";
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
  type TemplateDeletion,
} from "@eks/contracts";
import { demand } from "./errors.ts";
export function numberedQualificationVersion(q: Qualification): number {
  demand(
    q.version !== null && q.lifecycleStatus !== "Ready",
    409,
    "Ready 자격은 최초 기준 저장 후 사용할 수 있습니다.",
    "QUALIFICATION_READY",
  );
  return q.version;
}
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
    defaultCommonCourseIds: [] as string[],
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
  if (q.version !== null && q.releaseInfo) return q;
  return {
    ...q,
    ...(auditorCriteria(s, q)
      ? { auditorCriteria: auditorCriteria(s, q) }
      : {}),
    ...(t.purpose ? { purpose: t.purpose } : {}),
    qualificationType: t.qualificationType,
    title: t.title,
    englishName: t.englishName,
    description: t.description,
    templateRevision: t.revision,
  };
}
export function metadata(q: Qualification): QualificationMetadata {
  return {
    ...(q.purpose ? { purpose: q.purpose } : {}),
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
  demand(
    input.auditorCriteria === undefined ||
      JSON.stringify(input.auditorCriteria) ===
        JSON.stringify(current.auditorCriteria),
    422,
    "Auditor 등급·선행 조건은 팀에서 변경할 수 없습니다.",
    "AUDITOR_CRITERIA_READ_ONLY",
  );
  for (const field of [
    "purpose",
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
export function templateDeletion(s: State, id: string): TemplateDeletion {
  const t = s.qualificationTemplates.find((t) => t.id === id);
  demand(t, 404, "기본자격을 찾을 수 없습니다.");
  const qualificationVersions = s.qualifications.filter(
    (q) =>
      q.templateId === id || q.auditorCriteria?.prerequisiteTemplateId === id,
  ).length;
  const dependentTemplates = s.qualificationTemplates.filter(
    (t) => t.prerequisiteTemplateId === id,
  ).length;
  const reasons = [
    ...(t.scope === "team" ? ["이전 팀 전용 기본자격은 보존됩니다."] : []),
    ...(qualificationVersions
      ? [
          `팀 자격 ${qualificationVersions}개 버전에서 사용 중입니다. 과거·삭제 버전의 연결도 보존합니다.`,
        ]
      : []),
    ...(dependentTemplates
      ? [`다른 기본자격 ${dependentTemplates}개의 선행 자격으로 사용 중입니다.`]
      : []),
  ];
  return {
    canDelete: !reasons.length,
    reason: reasons.join(" "),
    qualificationVersions,
    dependentTemplates,
  };
}
export function deleteTemplate(
  s: State,
  actorId: string,
  id: string,
  body: unknown,
  at = new Date().toISOString(),
) {
  const input = z
    .object({ revision: z.number().int().positive() })
    .strict()
    .parse(body);
  const t = s.qualificationTemplates.find((t) => t.id === id);
  demand(t, 404, "기본자격을 찾을 수 없습니다.");
  demand(
    t.revision === input.revision,
    409,
    "기본자격이 변경되었습니다. 최신 목록을 확인한 뒤 다시 삭제해 주세요.",
    "REVISION_CONFLICT",
  );
  const impact = templateDeletion(s, id);
  demand(impact.canDelete, 409, impact.reason, "TEMPLATE_IN_USE");
  s.qualificationTemplates = s.qualificationTemplates.filter(
    (t) => t.id !== id,
  );
  s.audits.push({
    id: randomUUID(),
    actorId,
    date: at,
    action: "qualification-template.delete",
    targetId: id,
    reason: "미등록 기본자격 삭제",
    details: { before: JSON.parse(JSON.stringify(t)), after: null },
  });
  return { id, revision: t.revision, deleted: true };
}
export function saveTemplate(
  s: State,
  actorId: string,
  target: string | undefined,
  body: unknown,
) {
  const input = z
    .object({
      purpose: z.enum(["acquisition", "renewal"]).optional(),
      defaultCommonCourseIds: z
        .array(z.string().min(1).max(160))
        .max(100)
        .optional(),
      commonCourseRevisions: z
        .record(z.string(), z.number().int().positive())
        .optional(),
      revision: z.number().int().positive().optional(),
      qualificationType: QualificationTypeSchema.optional(),
      auditorLevel: z.enum(["general", "main"]).nullable().optional(),
      prerequisiteTemplateId: z.string().min(1).nullable().optional(),
      title: z.string().trim().min(1).max(300),
      englishName: z.string().trim().max(300),
      description: z.string().trim().max(20000).default(""),
    })
    .strict()
    .parse(body);
  const old = target
    ? s.qualificationTemplates.find((t) => t.id === target)
    : undefined;
  demand(!target || old, 404, "기본자격을 찾을 수 없습니다.");
  demand(
    old?.scope !== "team",
    409,
    "이전 팀 전용 기본자격은 보존됩니다. 새로운 이름·등급 관계는 시스템 기본자격을 만들어 등록해 주세요.",
    "TEAM_TEMPLATE_MANAGED",
  );
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
  const defaultCommonCourseIds =
    input.defaultCommonCourseIds ?? old?.defaultCommonCourseIds ?? [];
  validateDefaultCommonCourses(
    s,
    qualificationType,
    defaultCommonCourseIds,
    input.commonCourseRevisions,
  );
  const auditorLevel =
    input.auditorLevel === null
      ? undefined
      : (input.auditorLevel ?? old?.auditorLevel);
  const prerequisiteTemplateId =
    input.prerequisiteTemplateId === null
      ? undefined
      : (input.prerequisiteTemplateId ?? old?.prerequisiteTemplateId);
  demand(
    qualificationType === "auditor" ||
      (!auditorLevel && !prerequisiteTemplateId),
    422,
    "Auditee에는 Auditor 등급·선행 자격을 지정할 수 없습니다.",
  );
  demand(
    !prerequisiteTemplateId ||
      (auditorLevel === "main" &&
        s.qualificationTemplates.some(
          (t) =>
            t.id === prerequisiteTemplateId &&
            t.qualificationType === "auditor" &&
            t.auditorLevel === "general" &&
            t.scope !== "team",
        )),
    422,
    "선행 일반 기본자격을 확인해 주세요.",
  );
  const related = old
    ? s.qualifications.filter((q) => q.templateId === old.id)
    : [];
  if (
    old &&
    (old.auditorLevel !== auditorLevel ||
      old.prerequisiteTemplateId !== prerequisiteTemplateId) &&
    related.length
  ) {
    demand(
      !old.auditorLevel &&
        related
          .filter((q) => !q.deletedAt)
          .every((q) => q.lifecycleStatus === "Hold"),
      409,
      "등록 후 등급·선행 연결은 변경할 수 없습니다. 기존 미지정 등급의 최초 보완은 연결된 팀 자격을 모두 Hold로 전환한 뒤 가능합니다.",
      "AUDITOR_CRITERIA_LOCKED",
    );
  }
  if (
    old &&
    old.auditorLevel === "general" &&
    (qualificationType !== "auditor" || auditorLevel !== "general")
  )
    demand(
      !s.qualificationTemplates.some(
        (t) => t.prerequisiteTemplateId === old.id,
      ),
      409,
      "메인의 선행 자격으로 연결되어 있습니다.",
    );
  const purpose = input.purpose ?? old?.purpose ?? "acquisition";
  demand(
    !old ||
      purpose === (old.purpose || "acquisition") ||
      !s.qualifications.some((q) => q.templateId === old.id),
    409,
    "팀 등록 후 자격 용도는 변경할 수 없습니다.",
  );
  demand(
    purpose !== "renewal" ||
      (qualificationType === "auditee" &&
        !s.qualificationTemplates.some(
          (t) => t.id !== old?.id && t.purpose === "renewal",
        )),
    422,
    "재인증용 Auditee 기본자격은 1개만 생성할 수 있습니다.",
  );
  const at = new Date().toISOString();
  const next = QualificationTemplateSchema.parse({
    purpose,
    ...input,
    auditorLevel,
    prerequisiteTemplateId,
    ...(auditorLevel ? { auditorLevel } : {}),
    ...(prerequisiteTemplateId ? { prerequisiteTemplateId } : {}),
    defaultCommonCourseIds,
    qualificationType,
    id: old?.id || randomUUID(),
    revision: (old?.revision || 0) + 1,
    updatedAt: at,
    updatedBy: actorId,
  });
  if (old)
    s.qualificationTemplates[s.qualificationTemplates.indexOf(old)] = next;
  else s.qualificationTemplates.push(next);
  if (
    old &&
    [
      "title",
      "englishName",
      "description",
      "auditorLevel",
      "prerequisiteTemplateId",
    ].some((k) => (old as any)[k] !== (next as any)[k])
  ) {
    for (const ref of currentTeamQualifications(s)) {
      const q = s.qualifications.find((q) => q.id === ref.qualificationId)!;
      if (q.templateId !== next.id) continue;
      appendQualification(
        s,
        q,
        {
          ...q,
          title: next.title,
          englishName: next.englishName,
          description: next.description,
          templateRevision: next.revision,
          ...(auditorCriteria(s, q)
            ? { auditorCriteria: auditorCriteria(s, q) }
            : {}),
        },
        actorId,
        "기본자격 공통 정보 변경",
      );
    }
  }
  s.audits.push({
    id: randomUUID(),
    actorId,
    date: at,
    action: old
      ? "qualification-template.update"
      : "qualification-template.create",
    targetId: next.id,
    reason: "시스템 공통 기본자격 관리",
    details: JSON.parse(JSON.stringify({ before: old || null, after: next })),
  });
  return next;
}

export function templateTypeEditing(s: State, id: string) {
  const canChangeType = !s.qualifications.some((q) => q.templateId === id);
  return {
    canChangeType,
    auditorCriteriaEditable:
      canChangeType ||
      (!s.qualificationTemplates.find((t) => t.id === id)?.auditorLevel &&
        s.qualifications
          .filter((q) => q.templateId === id && !q.deletedAt)
          .every((q) => q.lifecycleStatus === "Hold")),
    auditorReadiness: auditorTemplateErrors(
      s,
      s.qualificationTemplates.find((t) => t.id === id)!,
    ),
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
