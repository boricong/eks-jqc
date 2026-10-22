import { createHash } from "node:crypto";
import { z } from "zod";
import {
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
    users: state.users,
    qualifications: state.qualifications,
    courses: state.courses,
    organizations: {
      roots: org.roots,
      qualificationPools: org.qualificationPools,
    },
  });
}
export function masterCounts(p: MasterPayload): MasterCounts {
  return {
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
    poolEntries: p.organizations.qualificationPools.length,
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
    schemaVersion: 2,
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
      schemaVersion: 10,
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
    formatVersion: 1,
    stateSchemaVersion: 10,
    organizationSchemaVersion: 2,
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
    users: z.array(UserSchema),
    qualifications: z.array(QualificationSchema),
    courses: z.array(CourseSchema),
    organizations: OrganizationDocumentSchema.pick({
      roots: true,
      qualificationPools: true,
    }).strict(),
  })
  .strict();
export function readMaster(input: unknown): MasterFile {
  try {
    const result = z
      .object({
        format: z.literal("eks-master"),
        formatVersion: z.literal(1),
        stateSchemaVersion: z.literal(10),
        organizationSchemaVersion: z.literal(2),
        createdAt: z.iso.datetime(),
        counts: z.record(z.string(), z.number().int().nonnegative()),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        payload: payloadSchema,
      })
      .strict()
      .parse(input);
    knownFields(input, result);
    demand(
      contentHash((input as any).payload) === result.sha256,
      422,
      "파일 내용 검증값이 일치하지 않습니다. 원래 파일을 다시 내보내 주세요.",
      "MASTER_FILE_INVALID",
    );
    masterCandidate(result.payload, 0, 0);
    const counts = masterCounts(result.payload);
    demand(
      contentHash(counts) === contentHash(result.counts),
      422,
      "파일의 항목별 건수가 실제 내용과 다릅니다.",
      "MASTER_FILE_INVALID",
    );
    return { ...result, counts };
  } catch (e) {
    if (e instanceof DomainError) throw e;
    throw new DomainError(
      422,
      `설정·기준 파일을 확인해 주세요. 지원 형식은 eks-master v1(업무10·조직2)입니다. ${e instanceof Error ? e.message : ""}`,
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
