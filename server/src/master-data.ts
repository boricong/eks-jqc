import { classifyCourseTypes } from "./course-types.ts";
import { upgradeTemplateData } from "./template-migration.ts";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  AuditorProgramSchema,
  QualificationTemplateSchema,
  UserSchema,
  CourseSchema,
  QualificationSchema,
  OrganizationDocumentSchema,
  organizationEntries,
  clearedDataLabels,
  type State,
  type OrganizationDocument,
  type MasterPayload,
  type MasterFile,
  type MasterCounts,
  type ClearedCounts,
} from "@eks/contracts";
import { validateState } from "./integrity.ts";
import { validateOrganizations } from "./organizations.ts";
import { demand, DomainError } from "./errors.ts";

export const MASTER_LIMIT = 25 * 1024 * 1024;
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
    qualificationTemplates: p.qualificationTemplates?.length || 0,
    users: p.users.length,
    organizations: organizationEntries(p.organizations).length,
    qualifications: p.qualifications.length,
    courses: p.courses.length,
    knowledgeQuestions: p.courses.reduce((n, c) => n + c.questions.length, 0),
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
) {
  const org = validateOrganizations({
    schemaVersion: 3,
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
    {
      schemaVersion: 19,
      auditorPrograms: structuredClone(p.auditorPrograms || []),
      qualificationTemplates: structuredClone(p.qualificationTemplates),
      revision: stateRevision,
      ...arrays,
      users: structuredClone(p.users),
      courses: structuredClone(p.courses),
      qualifications: structuredClone(p.qualifications),
    },
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
    formatVersion: 9,
    stateSchemaVersion: 19,
    organizationSchemaVersion: 3,
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
    if (version < 9)
      demand(
        ((input as any)?.payload?.qualifications || []).every(
          (q: any) => q.version !== null && q.lifecycleStatus !== "Ready",
        ),
        422,
        "Ready 자격은 기본정보 JSON v9 이상에서만 사용할 수 있습니다.",
        "MASTER_FILE_INVALID",
      );
    if (version >= 4 && version <= 9) {
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
    const legacy = version === 1,
      old = version === 1 || version === 2;
    const oldQ = QualificationSchema.extend({
      templateId: z.string().optional(),
      templateRevision: z.number().int().positive().optional(),
    });
    const compatiblePayloadSchema =
      version < 8
        ? payloadSchema.extend({
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
            organizations: payloadSchema.shape.organizations.extend({
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
        : payloadSchema;
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
                          : 9,
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
                        : z.literal(19),
        organizationSchemaVersion: z.literal(version < 8 ? 2 : 3),
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
    masterCandidate(payload, 0, 0);
    const counts = masterCounts(payload);
    const previousCounts = { ...counts } as Record<string, number>;
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
      formatVersion: 9,
      stateSchemaVersion: 19,
      organizationSchemaVersion: 3,
      payload,
      sha256: contentHash(payload),
      counts,
    };
  } catch (e) {
    if (e instanceof DomainError) throw e;
    throw new DomainError(
      422,
      `설정·기준 파일을 확인해 주세요. 지원 형식은 eks-master v9(업무19·조직3), 호환 형식 v1~v8(업무10~18·조직2~3)입니다. ${e instanceof Error ? e.message : ""}`,
      "MASTER_FILE_INVALID",
    );
  }
}

export const MaintenanceDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    generation: z.string().uuid(),
    receipts: z.array(
      z
        .object({
          operationId: z.string().uuid(),
          key: z.string().min(1).max(160),
          fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
          actorId: z.string().min(1),
          kind: z.enum(["master-reset", "master-import"]),
          completedAt: z.iso.datetime(),
          generation: z.string().uuid(),
          previousGeneration: z.string().uuid(),
          stateRevision: z.number().int().nonnegative(),
          organizationRevision: z.number().int().nonnegative(),
          preserved: z.record(z.string(), z.number().int().nonnegative()),
          deleted: z.record(z.string(), z.number().int().nonnegative()),
          backups: z
            .object({ state: z.string(), organizations: z.string() })
            .strict(),
        })
        .strict(),
    ),
  })
  .strict()
  .refine(
    (v) => new Set(v.receipts.map((r) => r.key)).size === v.receipts.length,
    "실행 영수증 식별자 중복",
  );
