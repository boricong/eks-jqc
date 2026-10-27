// Historical JSON format reader retained only in development tests.
import {
  clearedDataLabels,
  type MasterPayload,
  type MasterFile,
  type MasterCounts,
  type ClearedCounts,
} from "./legacy-master-contracts.ts";
import { initializeReleases } from "../src/release-migration.ts";
import { CommonCourseReleaseSchema, CommonUpdateSchema } from "@eks/contracts";
import { OrganizationQualificationRequirementSchema } from "@eks/contracts";
import { classifyCourseTypes } from "../src/course-types.ts";
import { upgradeTemplateData } from "../src/template-migration.ts";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  AuditorProgramSchema,
  QualificationTemplateSchema,
  UserSchema,
  CourseSchema,
  CommonCourseSchema,
  QualificationSchema,
  OrganizationDocumentSchema,
  StateSchema,
  LegacyOrganizationNodeSchema,
  organizationEntries,
  type State,
  type OrganizationDocument,
} from "@eks/contracts";
import { validateState } from "../src/integrity.ts";
import { validateOrganizations } from "../src/organizations.ts";
import { demand, DomainError } from "../src/errors.ts";

export const MASTER_LIMIT = 64 * 1024 * 1024;
export function contentHash(value: unknown): string {
  const canonical = (v: any): any =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .filter((k) => v[k] !== undefined)
              .map((k) => [k, canonical(v[k])]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export function masterPayload(
  state: State,
  org: OrganizationDocument,
): MasterPayload {
  return structuredClone({
    organizationQualificationRequirements:
      state.organizationQualificationRequirements,
    commonCourses: state.commonCourses,
    commonCourseReleases: state.commonCourseReleases,
    commonUpdates: state.commonUpdates,
    auditorPrograms: state.auditorPrograms,
    qualificationTemplates: state.qualificationTemplates,
    users: state.users,
    qualifications: state.qualifications,
    courses: state.courses,
    organizations: {
      roots: org.roots,
    },
  });
}
export function masterCounts(p: MasterPayload): MasterCounts {
  return {
    organizationQualificationRequirements: (
      p.organizationQualificationRequirements || []
    ).reduce((n, r) => n + r.entityIds.length, 0),
    commonCourses: p.commonCourses?.length || 0,
    qualificationTemplates: p.qualificationTemplates?.length || 0,
    users: p.users.length,
    organizations: organizationEntries(p.organizations).length,
    qualifications: p.qualifications.length,
    courses: p.courses.length,
    knowledgeQuestions: p.courses.reduce((n, c) => n + c.questions.length, 0),
    subjectiveQuestions: p.courses.reduce(
      (n, c) => n + c.subjectiveQuestions.length,
      0,
    ),
    scenarioQuestions: p.courses.reduce(
      (n, c) => n + c.practicalQuestions.length,
      0,
    ),
    learningItems: p.courses.reduce((n, c) => n + c.learningItems.length, 0),
    materials: p.courses.reduce((n, c) => n + c.materials.length, 0),
    administrators: p.users.filter((u) => u.organizationAdministration).length,
  };
}
export function clearedCounts(
  s: State,
  org: OrganizationDocument,
): ClearedCounts {
  return Object.fromEntries(
    Object.keys(clearedDataLabels).map((k) => [
      k,
      k === "organizationAudits"
        ? org.audits.length
        : k === "organizationRequests"
          ? org.requests.length
          : (s[k as keyof State] as unknown[]).length,
    ]),
  ) as ClearedCounts;
}
export function masterCandidate(
  p: MasterPayload,
  stateRevision: number,
  organizationRevision: number,
  legacyCreatedAt = "1970-01-01T00:00:00.000Z",
) {
  const org = validateOrganizations({
    schemaVersion: 4,
    revision: organizationRevision,
    ...structuredClone(p.organizations),
    audits: [],
    requests: [],
  });
  const arrays = Object.fromEntries(
    Object.keys(clearedDataLabels)
      .filter((k) => !k.startsWith("organization"))
      .map((k) => [k, []]),
  );
  const state = validateState(
    initializeReleases(
      {
        schemaVersion: 25,
        organizationQualificationRequirements: structuredClone(
          p.organizationQualificationRequirements || [],
        ),
        commonCourses: structuredClone(p.commonCourses || []),
        commonCourseReleases: structuredClone(p.commonCourseReleases || []),
        commonUpdates: structuredClone(p.commonUpdates || []),
        auditorPrograms: structuredClone(p.auditorPrograms || []),
        qualificationTemplates: structuredClone(p.qualificationTemplates),
        revision: stateRevision,
        ...arrays,
        users: structuredClone(p.users),
        courses: structuredClone(p.courses),
        qualifications: structuredClone(p.qualifications),
      },
      legacyCreatedAt,
    ),
    org,
  );
  return { state, organizations: org };
}
export function exportMaster(
  s: State,
  org: OrganizationDocument,
  at: string,
): MasterFile {
  const payload = masterPayload(s, org);
  return {
    format: "eks-master",
    formatVersion: 15,
    stateSchemaVersion: 26,
    organizationSchemaVersion: 4,
    createdAt: at,
    counts: masterCounts(payload),
    sha256: contentHash(payload),
    payload,
  };
}
// Reject unknown fields at every depth instead of silently dropping historical data.
function knownFields(raw: any, parsed: any, at = "파일") {
  if (Array.isArray(raw))
    return raw.forEach((v, i) =>
      knownFields(v, parsed?.[i], `${at}[${i + 1}]`),
    );
  if (!raw || typeof raw !== "object") return;
  for (const key of Object.keys(raw)) {
    demand(
      parsed && Object.hasOwn(parsed, key),
      422,
      `${at}.${key}: 이전 파일에 허용되지 않는 항목입니다.`,
      "MASTER_FILE_INVALID",
    );
    knownFields(raw[key], parsed[key], `${at}.${key}`);
  }
}
const payloadSchema = z
  .object({
    organizationQualificationRequirements: z
      .array(OrganizationQualificationRequirementSchema)
      .default([]),
    commonCourses: z.array(CommonCourseSchema).default([]),
    commonCourseReleases: z.array(CommonCourseReleaseSchema).default([]),
    commonUpdates: z.array(CommonUpdateSchema).default([]),
    auditorPrograms: z.array(AuditorProgramSchema).default([]),
    qualificationTemplates: z.array(QualificationTemplateSchema),
    users: z.array(UserSchema),
    qualifications: z.array(QualificationSchema),
    courses: z.array(CourseSchema),
    organizations: OrganizationDocumentSchema.pick({
      roots: true,
    }).strict(),
  })
  .strict();
export function readMaster(input: unknown): MasterFile {
  try {
    const version = (input as any)?.formatVersion;
    if (version === 15) {
      const p = (input as any)?.payload;
      demand(
        Array.isArray(p?.commonCourseReleases) &&
          Array.isArray(p?.commonUpdates) &&
          (p?.courses || []).every(
            (c: any) => c.releaseVersion && c.releaseInfo,
          ) &&
          (p?.qualifications || []).every(
            (q: any) =>
              q.releaseInfo &&
              (q.version === null
                ? q.releaseVersion === null
                : q.releaseVersion),
          ) &&
          (p?.commonCourses || []).every(
            (c: any) => c.releaseVersion && c.headReleaseId,
          ),
        422,
        "JSON15의 버전 이력과 표시 번호가 누락되었습니다. 원본 파일을 다시 내보내 주세요.",
        "MASTER_FILE_INVALID",
      );
    }
    if (version < 14) {
      const p = (input as any)?.payload;
      demand(
        !(p?.qualifications || []).some((q: any) => q.auditorCriteria) &&
          !(p?.qualificationTemplates || []).some(
            (t: any) =>
              t.prerequisiteTemplateId ||
              (t.scope !== "team" && t.auditorLevel),
          ),
        422,
        "신규 Auditor 등급·선행 기준은 JSON14 이상에서만 사용할 수 있습니다.",
        "MASTER_FILE_INVALID",
      );
    }
    if (version < 13)
      demand(
        !(input as any)?.payload?.organizationQualificationRequirements?.length,
        422,
        "조직 필요자격은 JSON13 이상에서만 사용할 수 있습니다.",
        "MASTER_FILE_INVALID",
      );
    if (version < 10) {
      const p = (input as any)?.payload;
      demand(
        !p?.commonCourses?.length &&
          !(p?.courses || []).some(
            (c: any) => c.category === "common" || c.commonCourseSource,
          ) &&
          !(p?.qualifications || []).some(
            (q: any) => q.commonCourseEntityIds?.length,
          ) &&
          !(p?.qualificationTemplates || []).some(
            (t: any) => t.defaultCommonCourseIds?.length,
          ),
        422,
        "공통인증Set 정보는 기본정보 JSON10 이상에서만 사용할 수 있습니다.",
        "MASTER_FILE_INVALID",
      );
    }
    if (version < 9)
      demand(
        ((input as any)?.payload?.qualifications || []).every(
          (q: any) => q.version !== null && q.lifecycleStatus !== "Ready",
        ),
        422,
        "Ready 자격은 기본정보 JSON v9 이상에서만 사용할 수 있습니다.",
        "MASTER_FILE_INVALID",
      );
    if (version >= 4 && version <= 15) {
      const payload = (input as any)?.payload;
      for (const item of [
        ...(payload?.qualificationTemplates || []),
        ...(payload?.qualifications || []),
        ...(version >= 5 ? payload?.courses || [] : []),
      ])
        demand(
          item.qualificationType === "auditee" ||
            item.qualificationType === "auditor",
          422,
          "파일의 인증 유형이 누락되었거나 잘못되었습니다.",
          "MASTER_FILE_INVALID",
        );
    }
    if (version < 12)
      for (const c of [
        ...((input as any)?.payload?.courses || []),
        ...((input as any)?.payload?.commonCourses || []),
      ])
        demand(
          !c.subjectiveEnabled && !c.subjectiveQuestions?.length,
          422,
          "구형 파일에는 주관식 설정을 추가할 수 없습니다.",
          "MASTER_FILE_INVALID",
        );
    const legacy = version === 1,
      old = version === 1 || version === 2;
    const oldQ = QualificationSchema.extend({
      templateId: z.string().optional(),
      templateRevision: z.number().int().positive().optional(),
    });
    const basePayloadSchema =
      version < 11
        ? payloadSchema.extend({
            organizations: z
              .object({ roots: z.array(LegacyOrganizationNodeSchema) })
              .strict(),
          })
        : payloadSchema;
    const compatiblePayloadSchema =
      version < 8
        ? basePayloadSchema.extend({
            auditorPrograms: z
              .array(
                AuditorProgramSchema.extend({
                  general: z
                    .object({
                      templateId: z.string(),
                      qualificationId: z.string(),
                    })
                    .optional(),
                  main: z
                    .object({
                      templateId: z.string(),
                      qualificationId: z.string(),
                    })
                    .optional(),
                }),
              )
              .default([]),
            organizations: basePayloadSchema.shape.organizations.extend({
              qualificationPools: z
                .array(
                  z.object({
                    lv1OrganizationId: z.string(),
                    entityId: z.string(),
                    qualificationId: z.string(),
                  }),
                )
                .default([]),
            }),
          })
        : basePayloadSchema;
    const selectedSchema = old
      ? compatiblePayloadSchema.omit({ qualificationTemplates: true }).extend({
          qualifications: z.array(
            legacy
              ? oldQ.extend({
                  status: z.enum(["draft", "published"]),
                  publishedAt: z.iso.datetime().optional(),
                })
              : oldQ,
          ),
          courses: z.array(
            legacy
              ? CourseSchema.extend({
                  status: z.enum(["draft", "published"]),
                  publishedAt: z.iso.datetime().optional(),
                })
              : CourseSchema,
          ),
        })
      : compatiblePayloadSchema;
    const result = z
      .object({
        format: z.literal("eks-master"),
        formatVersion: z.literal(
          legacy
            ? 1
            : old
              ? 2
              : version === 3
                ? 3
                : version === 4
                  ? 4
                  : version === 5
                    ? 5
                    : version === 6
                      ? 6
                      : version === 7
                        ? 7
                        : version === 8
                          ? 8
                          : version === 9
                            ? 9
                            : version === 10
                              ? 10
                              : version === 11
                                ? 11
                                : version === 12
                                  ? 12
                                  : version === 13
                                    ? 13
                                    : version === 14
                                      ? 14
                                      : 15,
        ),
        stateSchemaVersion: legacy
          ? z.literal(10)
          : old
            ? z.literal(11)
            : version === 3
              ? z.union([z.literal(12), z.literal(13)])
              : version === 4
                ? z.literal(14)
                : version === 5
                  ? z.literal(15)
                  : version === 6
                    ? z.literal(16)
                    : version === 7
                      ? z.literal(17)
                      : version === 8
                        ? z.literal(18)
                        : version === 9
                          ? z.literal(19)
                          : version === 10
                            ? z.literal(20)
                            : version === 11
                              ? z.literal(21)
                              : version === 12
                                ? z.literal(22)
                                : version === 13
                                  ? z.literal(23)
                                  : version === 14
                                    ? z.union([z.literal(24), z.literal(25)])
                                    : z.literal(26),
        organizationSchemaVersion: z.literal(
          version < 8 ? 2 : version < 11 ? 3 : 4,
        ),
        createdAt: z.iso.datetime(),
        counts: z.record(z.string(), z.number().int().nonnegative()),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        payload: selectedSchema,
      })
      .strict()
      .parse(input);
    knownFields(input, result);
    if (version < 4) {
      for (const q of [
        ...result.payload.qualifications,
        ...((result.payload as any).qualificationTemplates || []),
      ])
        demand(
          q.qualificationType === "auditee",
          422,
          "구형 파일은 Auditee 유형만 지원합니다.",
          "MASTER_FILE_INVALID",
        );
    }

    demand(
      contentHash((input as any).payload) === result.sha256,
      422,
      "파일 내용 검증값이 일치하지 않습니다. 원래 파일을 다시 내보내 주세요.",
      "MASTER_FILE_INVALID",
    );
    const converted: any = old
      ? upgradeTemplateData(result.payload)
      : structuredClone(result.payload);
    if (version < 8) {
      delete converted.organizations.qualificationPools;
      for (const program of converted.auditorPrograms || [])
        for (const level of ["general", "main"]) {
          const ref = program[level];
          if (!ref) continue;
          const q = converted.qualifications.find(
            (q: any) => q.id === ref.qualificationId,
          );
          demand(
            q &&
              q.templateId === ref.templateId &&
              q.lv1OrganizationId === program.lv1OrganizationId,
            422,
            "이전 Auditor 기준 연결을 확인해 주세요.",
          );
          program[level] = { templateId: ref.templateId, entityId: q.entityId };
        }
    }
    if (version < 11) {
      const pending = [...converted.organizations.roots];
      while (pending.length) {
        const node = pending.pop();
        delete node.requiredQualifications;
        pending.push(...node.children);
      }
    }
    const payload = payloadSchema.parse(converted);
    if (version < 5) {
      for (const c of payload.courses) {
        const rawCourse = (input as any).payload.courses.find(
          (item: any) => item.id === c.id,
        );
        if (rawCourse?.qualificationType === undefined)
          delete (c as any).qualificationType;
      }
      classifyCourseTypes(payload);
    }
    if (version < 7) {
      for (const template of payload.qualificationTemplates)
        template.scope ??= "system";
      const actorId = payload.users.find((u) =>
        u.roles.includes("system_operator"),
      )?.id;
      demand(
        actorId,
        422,
        "이전 파일의 시스템 운영자를 확인해 주세요.",
        "MASTER_FILE_INVALID",
      );
      for (const user of payload.users)
        if (user.roles.includes("evaluator") && !user.auditorDesignation) {
          // The source file's hash and timestamp make repeated previews deterministic.
          user.auditorDesignation = {
            id: `migration:${result.sha256}:${user.id}`,
            actorId,
            at: result.createdAt,
            source: "migration",
          };
        }
    }
    const upgraded = masterCandidate(payload, 0, 0, result.createdAt);
    const counts = masterCounts(payload);
    const previousCounts = { ...counts } as Record<string, number>;
    if (version < 13)
      delete previousCounts.organizationQualificationRequirements;
    if (version < 12) delete previousCounts.subjectiveQuestions;
    if (version < 10) delete previousCounts.commonCourses;
    if (old) delete previousCounts.qualificationTemplates;
    if (version < 8)
      previousCounts.poolEntries = (
        result.payload.organizations as any
      ).qualificationPools.length;
    demand(
      contentHash(previousCounts) === contentHash(result.counts),
      422,
      "파일의 항목별 건수가 실제 내용과 다릅니다.",
      "MASTER_FILE_INVALID",
    );
    return {
      ...result,
      formatVersion: 15,
      stateSchemaVersion: 26,
      organizationSchemaVersion: 4,
      payload: masterPayload(upgraded.state, upgraded.organizations),
      sha256: contentHash(
        masterPayload(upgraded.state, upgraded.organizations),
      ),
      counts,
    };
  } catch (e) {
    if (e instanceof DomainError) throw e;
    throw new DomainError(
      422,
      `설정·기준 파일을 확인해 주세요. 지원 형식은 eks-master v15(업무26·조직4), 호환 형식 v1~v14입니다. ${e instanceof Error ? e.message : ""}`,
      "MASTER_FILE_INVALID",
    );
  }
}
